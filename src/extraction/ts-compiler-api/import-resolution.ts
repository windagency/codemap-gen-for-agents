import path from "node:path";
import { findNearestManifest } from "src/core/find-nearest-manifest";
import { parseDeclaredDependencies, parseInstalledPackageJson } from "src/core/manifest-schema";
import { readPackageJson } from "src/core/read-package-json";
import type { RawImport, ResolvedImportTarget } from "src/core/types";
import { locationOf } from "src/extraction/ts-compiler-api/ast-utils";
import type {
	DeclaredDependenciesCache,
	ExtractionContext,
	ManifestCache,
	PackageManifest,
} from "src/extraction/ts-compiler-api/extraction-context";
import { isUnderNodeModules } from "src/extraction/ts-compiler-api/node-modules-path";
import {
	type Expression,
	isExportDeclaration,
	isImportDeclaration,
	isSourceFile,
	isStringLiteral,
	type Node,
	type SourceFile,
} from "typescript/unstable/ast";
import type { Checker, Project } from "typescript/unstable/sync";

// Missing/malformed package.json - treated exactly like an unresolved import (spec's decision).
function readPackageManifest(dir: string): PackageManifest | undefined {
	return readPackageJson(dir, parseInstalledPackageJson);
}

function resolveExternalManifest(packageJsonDirectory: string, cache: ManifestCache): PackageManifest | undefined {
	if (cache.has(packageJsonDirectory)) return cache.get(packageJsonDirectory);
	const manifest = readPackageManifest(packageJsonDirectory);
	cache.set(packageJsonDirectory, manifest);
	return manifest;
}

// The package-name portion of a bare (non-relative) module specifier - `"lodash"` from
// `"lodash/fp"`, `"@scope/pkg"` from `"@scope/pkg/sub"` - or `undefined` for a relative
// (`"./x"`/`"../x"`) specifier, which is never a package name. Ground truth for "what package did
// the author actually write an import for", independent of whatever file the type checker resolved
// the specifier to.
function packageNameFromSpecifier(specifier: string): string | undefined {
	if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
	const segments = specifier.split("/");
	if (specifier.startsWith("@")) {
		return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined;
	}
	return segments[0];
}

// Classic Node resolution's directory walk, filesystem-only: from the importing file's directory
// upward, look for `<dir>/node_modules/<packageName>/package.json`. This is ground truth for
// "what installed package does this specifier actually resolve to at runtime", independent of
// whether the TypeScript compiler could resolve a *type* for it - used both to correct a
// `@types/*`-only type resolution back to the real runtime package (a `@types/*` package is never
// itself the dependency an import is for) and as a fallback when the checker can't resolve the
// specifier to anything at all (a plain CommonJS package with no bundled and no DefinitelyTyped
// declarations).
function findInstalledPackage(
	importerFilePath: string,
	packageName: string,
	cache: ManifestCache,
): PackageManifest | undefined {
	let dir = path.dirname(importerFilePath);
	for (;;) {
		const manifest = resolveExternalManifest(path.join(dir, "node_modules", packageName), cache);
		if (manifest) return manifest;
		const parent = path.dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

// Specs that name no registry version: a workspace sibling, a local path, a git or tarball URL,
// or GitHub `owner/repo` shorthand.
const NON_REGISTRY_SPEC = /^(workspace|file|link|portal|git|git\+\w+|github|gitlab|bitbucket|https?):|\//;

// The registry package and version a declared spec points at. An `npm:bar@^1` alias names the
// real upstream package, so the External is named `bar`, not the local alias (ADR-0024).
function registryCoordinate(packageName: string, spec: string): { packageName: string; version: string } | undefined {
	if (spec.startsWith("npm:")) {
		const aliased = spec.slice("npm:".length);
		const versionAt = aliased.lastIndexOf("@");
		const version = aliased.slice(versionAt + 1);
		return versionAt > 0 && version ? { packageName: aliased.slice(0, versionAt), version } : undefined;
	}
	return NON_REGISTRY_SPEC.test(spec) ? undefined : { packageName, version: spec };
}

function declaredDependenciesAt(dir: string, cache: DeclaredDependenciesCache): Record<string, string> | undefined {
	if (!cache.has(dir)) {
		cache.set(dir, readPackageJson(dir, parseDeclaredDependencies));
	}
	return cache.get(dir);
}

// The declared (not installed) version of a dependency `node_modules` doesn't hold, from the
// nearest package.json at or above the importer, within the repo, that declares it. This is the
// same manifest-only fidelity Go/Rust/Java/Python already get (ADR-0032): without it, an npm
// import in a repo where `npm install` never ran produces no External node and no warning.
function declaredExternalTarget(
	importerFilePath: string,
	packageName: string,
	context: ExtractionContext,
): ResolvedImportTarget | undefined {
	const spec = findNearestManifest(
		context.rootDir,
		path.dirname(importerFilePath),
		(dir) => declaredDependenciesAt(dir, context.declaredDependenciesCache)?.[packageName],
	);
	const coordinate = spec && registryCoordinate(packageName, spec);
	return coordinate ? { kind: "external", ...coordinate, language: "typescript" } : undefined;
}

// typescript@7's sync API exposes no `ts.resolveModuleName`/classic `TypeChecker` at all (see
// `ts-compiler-api-parser.ts`'s top comment) - the spec's literal "resolve via
// `ts.resolveModuleName`" text predates that discovery. The equivalent here:
// `checker.getSymbolAtLocation` on the specifier's string-literal node resolves it exactly the way
// the program itself resolved the import, always yielding the *real* (symlink-resolved) target
// path - verified against a pnpm-style workspace symlink.
function externalTarget(manifest: PackageManifest): ResolvedImportTarget {
	return {
		kind: "external",
		packageName: manifest.name,
		version: manifest.version,
		language: "typescript",
	};
}

// A bare specifier the checker couldn't resolve: typically a package with no bundled and no
// DefinitelyTyped declarations. Tries the installed package on disk, then (a repo where
// `npm install` never ran) the declared version in package.json.
function resolveUncheckedPackage(
	importerFilePath: string,
	packageName: string | undefined,
	context: ExtractionContext,
): ResolvedImportTarget {
	if (!packageName) return { kind: "unresolved" };
	const installed = findInstalledPackage(importerFilePath, packageName, context.manifestCache);
	if (installed) return externalTarget(installed);
	return (
		declaredExternalTarget(importerFilePath, packageName, context) ?? {
			kind: "unresolved",
		}
	);
}

// A checker-resolved file under `node_modules`. Prefers filesystem ground truth over whatever
// package the checker's type resolution landed in: when an import's types come from a separate
// `@types/*` package (DefinitelyTyped), the checker resolves into `node_modules/@types/<name>/...`
// - an accurate *type* resolution, but the wrong *runtime* identity. Re-resolving the package
// name as written via a plain Node walk finds the real runtime package whenever one is installed.
// Falls through to the checker-resolved package only for a genuinely types-only dependency
// (e.g. `@types/node`).
function resolveExternalFile(
	project: Project,
	resolvedFileName: string,
	importerFilePath: string,
	packageName: string | undefined,
	context: ExtractionContext,
): ResolvedImportTarget {
	const installed = packageName && findInstalledPackage(importerFilePath, packageName, context.manifestCache);
	if (installed) return externalTarget(installed);

	const packageJsonDirectory = project.program.getSourceFileMetadata(resolvedFileName)?.packageJsonDirectory;
	const manifest = packageJsonDirectory && resolveExternalManifest(packageJsonDirectory, context.manifestCache);
	return manifest ? externalTarget(manifest) : { kind: "unresolved" };
}

function resolveImportTarget(
	checker: Checker,
	project: Project,
	specifierNode: Expression,
	importerFilePath: string,
	context: ExtractionContext,
): ResolvedImportTarget {
	const packageName = isStringLiteral(specifierNode) ? packageNameFromSpecifier(specifierNode.text) : undefined;

	const symbol = checker.getSymbolAtLocation(specifierNode);
	const declaration = symbol?.valueDeclaration ?? symbol?.declarations[0];
	const resolvedNode = declaration?.resolve();

	if (!resolvedNode || !isSourceFile(resolvedNode)) {
		return resolveUncheckedPackage(importerFilePath, packageName, context);
	}

	// A target that's itself in this run's skip-set (ticket 13's unparseable-file policy) is
	// treated exactly like an unresolvable specifier - it produces no `FileNode`, so a `file`-kind
	// target here would otherwise be a dangling edge with no node to point at.
	if (context.skippedFiles.has(resolvedNode.fileName)) {
		return { kind: "unresolved" };
	}

	return isUnderNodeModules(resolvedNode.fileName)
		? resolveExternalFile(project, resolvedNode.fileName, importerFilePath, packageName, context)
		: { kind: "file", filePath: resolvedNode.fileName };
}

interface ImportLikeStatement {
	moduleSpecifier: Expression;
	viaReExport: boolean;
	node: Node;
}

// One entry per `ImportDeclaration` (including bare side-effect imports) and per re-export
// `ExportDeclaration` that names a module. A wildcard-only re-export (`export * from "./x"`, no
// `exportClause`) is fully resolved through and produces no entry at all; a named or namespace
// re-export (`export { x } from "./x"` / `export * as ns from "./x"`) stays a visible hop.
function collectImportLikeStatements(sourceFile: SourceFile): ImportLikeStatement[] {
	return sourceFile.statements.flatMap((statement): ImportLikeStatement[] => {
		if (isImportDeclaration(statement)) {
			return [
				{
					moduleSpecifier: statement.moduleSpecifier,
					viaReExport: false,
					node: statement,
				},
			];
		}
		if (isExportDeclaration(statement) && statement.moduleSpecifier) {
			if (!statement.exportClause) return []; // bare `export * from` - resolved through
			return [
				{
					moduleSpecifier: statement.moduleSpecifier,
					viaReExport: true,
					node: statement,
				},
			];
		}
		return [];
	});
}

export function toRawImports(sourceFile: SourceFile, project: Project, context: ExtractionContext): RawImport[] {
	const { checker } = project;
	return collectImportLikeStatements(sourceFile).flatMap(({ moduleSpecifier, viaReExport, node }): RawImport[] => {
		if (!isStringLiteral(moduleSpecifier)) return [];
		return [
			{
				specifier: moduleSpecifier.text,
				viaReExport,
				resolvedTarget: resolveImportTarget(checker, project, moduleSpecifier, sourceFile.fileName, context),
				locations: [locationOf(sourceFile, node)],
			},
		];
	});
}
