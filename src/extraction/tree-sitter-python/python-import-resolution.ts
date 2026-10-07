import path from "node:path";
import type { RawImport, ResolvedImportTarget } from "src/core/types";
import { locationOf } from "src/extraction/tree-sitter-common/location";
import type { PythonProject } from "src/extraction/tree-sitter-python/pyproject-manifest";
import type Parser from "tree-sitter";

// One entry per name actually bound into scope by an `import`/`from ... import` statement - a
// plain `import a.b, c as d` or `from x import y, z as w` fans out into one spec per bound name,
// the same "one RawImport per resolved target" shape Go's directory-package fan-out uses.
export interface PythonImportSpec {
	kind: "import" | "from";
	relativeLevel: number; // number of leading dots on a `from` import's module; always 0 for "import"
	modulePath: string[]; // dotted segments before any `from`-imported name; the whole path for "import"
	importedName: string | undefined; // `from` only: the specific name imported; undefined for a wildcard
	isWildcard: boolean;
	aliasName: string | undefined; // local binding name, only when explicitly `as`-aliased
	node: Parser.SyntaxNode;
}

function dottedNameSegments(node: Parser.SyntaxNode): string[] {
	return node.text.split(".");
}

// `from ..pkg.sub import x`: the leading-dot count and the dotted module segments.
function fromImportModule(moduleNameNode: Parser.SyntaxNode | null): {
	relativeLevel: number;
	modulePath: string[];
} {
	if (moduleNameNode?.type === "dotted_name") {
		return { relativeLevel: 0, modulePath: dottedNameSegments(moduleNameNode) };
	}
	if (moduleNameNode?.type !== "relative_import") {
		return { relativeLevel: 0, modulePath: [] };
	}
	const childOfType = (type: string) => moduleNameNode.namedChildren.find((child) => child?.type === type);
	const dottedNode = childOfType("dotted_name");
	return {
		relativeLevel: childOfType("import_prefix")?.text.length ?? 0,
		modulePath: dottedNode ? dottedNameSegments(dottedNode) : [],
	};
}

// The imported name, its `as` alias, and whether it's a `*`, for one name node of a `from`
// import. `undefined` for a node that binds nothing.
function fromImportedName(
	nameNode: Parser.SyntaxNode,
): Pick<PythonImportSpec, "importedName" | "aliasName" | "isWildcard"> | undefined {
	switch (nameNode.type) {
		case "wildcard_import":
			return {
				importedName: undefined,
				aliasName: undefined,
				isWildcard: true,
			};
		case "aliased_import": {
			const importedName = nameNode.childForFieldName("name")?.text;
			return importedName
				? {
						importedName,
						aliasName: nameNode.childForFieldName("alias")?.text,
						isWildcard: false,
					}
				: undefined;
		}
		case "dotted_name":
			return {
				importedName: nameNode.text,
				aliasName: undefined,
				isWildcard: false,
			};
		default:
			return undefined;
	}
}

function collectFromImportStatement(statement: Parser.SyntaxNode): PythonImportSpec[] {
	const moduleNameNode = statement.childForFieldName("module_name");
	const module = fromImportModule(moduleNameNode);
	return statement.namedChildren.flatMap((nameNode): PythonImportSpec[] => {
		if (!nameNode || nameNode === moduleNameNode) return [];
		const imported = fromImportedName(nameNode);
		return imported ? [{ kind: "from", ...module, ...imported, node: nameNode }] : [];
	});
}

function collectPlainImportStatement(statement: Parser.SyntaxNode): PythonImportSpec[] {
	return statement.namedChildren.flatMap((child): PythonImportSpec[] => {
		if (!child) return [];
		if (child.type === "dotted_name") {
			return [
				{
					kind: "import",
					relativeLevel: 0,
					modulePath: dottedNameSegments(child),
					importedName: undefined,
					isWildcard: false,
					aliasName: undefined,
					node: child,
				},
			];
		}
		if (child.type === "aliased_import") {
			const dottedNode = child.childForFieldName("name");
			const alias = child.childForFieldName("alias")?.text;
			if (!dottedNode) return [];
			return [
				{
					kind: "import",
					relativeLevel: 0,
					modulePath: dottedNameSegments(dottedNode),
					importedName: undefined,
					isWildcard: false,
					aliasName: alias,
					node: child,
				},
			];
		}
		return [];
	});
}

// Not just `sourceFile.namedChildren`: real Python routinely imports from inside a `try`/`except`
// (the standard optional-dependency idiom) or an `if TYPE_CHECKING:` block, not only at module top
// level. `descendantsOfType` finds every import statement anywhere in the file regardless of how
// deeply it's nested under those (or a function body, a `with`, ...), matching Go's own
// `collectImportSpecs`'s use of the same API for import specs nested inside a grouped `import (
// ... )` declaration.
export function collectImportSpecs(sourceFile: Parser.SyntaxNode): PythonImportSpec[] {
	return sourceFile
		.descendantsOfType(["import_statement", "import_from_statement"])
		.flatMap((declaration): PythonImportSpec[] => {
			if (!declaration) return [];
			if (declaration.type === "import_statement") {
				return collectPlainImportStatement(declaration);
			}
			return collectFromImportStatement(declaration);
		});
}

function specifierOf(spec: PythonImportSpec): string {
	if (spec.kind === "import") return spec.modulePath.join(".");
	const dots = ".".repeat(spec.relativeLevel);
	const parts = [...spec.modulePath];
	if (spec.isWildcard) parts.push("*");
	else if (spec.importedName !== undefined) parts.push(spec.importedName);
	return dots + parts.join(".");
}

// A relative import's root is computed purely from the importing file's own directory (level 1 =
// that directory itself, level 2 = its parent, ...); an absolute import tries the project's own
// root directory (a flat layout) and `${projectRootDir}/src` (a src layout) - no declared "root
// import name" exists in pyproject.toml the way go.mod's `module` directive gives Go one
// (documentation/adr/0030's disclosed fidelity gap).
function rootDirsFor(filePath: string, project: PythonProject | undefined, relativeLevel: number): string[] {
	if (relativeLevel > 0) {
		let dir = path.dirname(filePath);
		for (let i = 1; i < relativeLevel; i++) dir = path.dirname(dir);
		return [dir];
	}
	return project ? [project.projectRootDir, path.join(project.projectRootDir, "src")] : [];
}

function resolveModulePathToFile(
	root: string,
	segments: string[],
	programFiles: readonly string[],
): string | undefined {
	if (segments.length === 0) {
		const initFile = path.join(root, "__init__.py");
		return programFiles.includes(initFile) ? initFile : undefined;
	}
	const relative = segments.join("/");
	const candidates = [path.join(root, `${relative}.py`), path.join(root, relative, "__init__.py")];
	return candidates.find((candidate) => programFiles.includes(candidate));
}

// `from pkg.sub import thing`'s last segment is ambiguous between "a submodule named thing" and
// "a symbol declared inside sub.py" without a full symbol table - tried here in that order,
// mirroring Rust's own `resolveInternalTarget` disambiguation for the same "use ...::last_segment"
// ambiguity.
function segmentCandidatesFor(spec: PythonImportSpec): string[][] {
	if (spec.kind === "import" || spec.isWildcard) return [spec.modulePath];
	if (spec.importedName === undefined) return [spec.modulePath];
	return [[...spec.modulePath, spec.importedName], spec.modulePath];
}

function resolveInternalTarget(
	filePath: string,
	spec: PythonImportSpec,
	project: PythonProject | undefined,
	programFiles: readonly string[],
): string | undefined {
	const roots = rootDirsFor(filePath, project, spec.relativeLevel);
	const segmentCandidates = segmentCandidatesFor(spec);
	for (const root of roots) {
		for (const segments of segmentCandidates) {
			const found = resolveModulePathToFile(root, segments, programFiles);
			if (found) return found;
		}
	}
	return undefined;
}

// PyPI distribution names and Python import names are frequently unrelated altogether (PyPI
// "Pillow" imports as "PIL", "beautifulsoup4" as "bs4") - no general mapping exists without
// installed package metadata this syntactic pass never has. This normalises both sides
// (lowercase, `-`/`_`/`.` treated as equivalent, per PEP 503) and matches on that, which resolves
// the common case where the import name and the distribution name genuinely agree, and simply
// leaves the irregular cases unresolved (documentation/adr/0030's disclosed fidelity gap).
function normalizePackageName(name: string): string {
	return name.toLowerCase().replace(/[-_.]+/g, "_");
}

function resolveExternalTarget(project: PythonProject | undefined, topSegment: string): ResolvedImportTarget {
	if (!project) return { kind: "unresolved" };
	const normalizedTop = normalizePackageName(topSegment);
	const dependency = project.dependencies.find((dep) => normalizePackageName(dep.name) === normalizedTop);
	return dependency
		? {
				kind: "external",
				packageName: dependency.name,
				version: dependency.version,
				language: "python",
			}
		: { kind: "unresolved" }; // stdlib, or a name this pass can't match to a declared dependency
}

export function toRawImports(
	filePath: string,
	specs: PythonImportSpec[],
	project: PythonProject | undefined,
	programFiles: readonly string[],
): RawImport[] {
	return specs.map((spec): RawImport => {
		const base = {
			specifier: specifierOf(spec),
			viaReExport: false,
			locations: [locationOf(spec.node)],
		};

		const internalFile = resolveInternalTarget(filePath, spec, project, programFiles);
		if (internalFile) {
			return {
				...base,
				resolvedTarget: { kind: "file", filePath: internalFile },
			};
		}

		// A relative import (or a `from .` with no module segment at all) is never external - there's
		// nothing left to try once its own package-relative lookup fails.
		if (spec.relativeLevel > 0) {
			return { ...base, resolvedTarget: { kind: "unresolved" } };
		}

		const topSegment = spec.modulePath[0];
		return {
			...base,
			resolvedTarget: topSegment ? resolveExternalTarget(project, topSegment) : { kind: "unresolved" },
		};
	});
}

// A file's own bound-name -> resolved-file map, used by call resolution to look up a
// namespace-qualified call's candidates (`x.y()`) - mirrors Go's `buildImportAliasToFiles`. An
// unaliased `import a.b.c` binds only `a` in scope (real Python semantics), so it resolves against
// just `a`'s own file, never the deeper `a.b.c` path a later `.b.c` attribute chain would need
// (that chain falls through to the generic same-named-method heuristic instead, the same "no
// nested-qualifier tracking" limitation Go's own alias map has).
// The local name one import binds, and the file it resolves to. A wildcard binds no single name.
function boundImport(
	filePath: string,
	spec: PythonImportSpec,
	project: PythonProject | undefined,
	programFiles: readonly string[],
): [string, string | undefined] | undefined {
	if (spec.isWildcard) return undefined;
	if (spec.kind === "from") {
		const boundName = spec.aliasName ?? spec.importedName;
		return boundName ? [boundName, resolveInternalTarget(filePath, spec, project, programFiles)] : undefined;
	}
	const boundName = spec.aliasName ?? spec.modulePath[0];
	if (!boundName) return undefined;
	const segments = spec.aliasName ? spec.modulePath : spec.modulePath.slice(0, 1);
	const file = rootDirsFor(filePath, project, 0)
		.map((root) => resolveModulePathToFile(root, segments, programFiles))
		.find((candidate): candidate is string => candidate !== undefined);
	return [boundName, file];
}

export function buildImportAliasToFiles(
	filePath: string,
	specs: PythonImportSpec[],
	project: PythonProject | undefined,
	programFiles: readonly string[],
): Map<string, ReadonlySet<string>> {
	return new Map(
		specs.flatMap((spec): [string, ReadonlySet<string>][] => {
			const bound = boundImport(filePath, spec, project, programFiles);
			if (!bound) return [];
			const [boundName, file] = bound;
			return [[boundName, new Set(file ? [file] : [])]];
		}),
	);
}
