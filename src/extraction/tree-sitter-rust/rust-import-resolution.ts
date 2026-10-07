import path from "node:path";
import type { RawImport, ResolvedImportTarget } from "src/core/types";
import { locationOf } from "src/extraction/tree-sitter-common/location";
import type { RustCrate } from "src/extraction/tree-sitter-rust/cargo-manifest";
import { hasOwnTestAttribute } from "src/extraction/tree-sitter-rust/rust-symbol-classification";
import type Parser from "tree-sitter";

export interface RustUseSpec {
	fullPath: string; // "::"-separated, e.g. "crate::widget::helper" or "std::collections::HashMap"
	node: Parser.SyntaxNode;
}

// A `use` argument can nest a grouped list (`use std::{fmt, io::Read}`), a `use ... as` alias, or
// a glob (`use std::io::*`) arbitrarily - flattened here into one entry per concrete imported
// path, `prefix`-qualified as the recursion descends into a group.
function flattenUseArgument(node: Parser.SyntaxNode, prefix: string | undefined): string[] {
	const qualify = (segment: string) => (prefix ? `${prefix}::${segment}` : segment);

	switch (node.type) {
		case "scoped_identifier":
		case "identifier":
		case "crate":
		case "self":
		case "super":
			return [qualify(node.text)];
		case "use_as_clause": {
			const pathNode = node.childForFieldName("path");
			return pathNode ? [qualify(pathNode.text)] : [];
		}
		case "use_wildcard": {
			const pathNode = node.childForFieldName("path");
			return pathNode ? [qualify(pathNode.text)] : [];
		}
		case "scoped_use_list": {
			const pathNode = node.childForFieldName("path");
			const listNode = node.childForFieldName("list");
			if (!listNode) return [];
			const newPrefix = pathNode ? qualify(pathNode.text) : prefix;
			return listNode.namedChildren.flatMap((child) => (child ? flattenUseArgument(child, newPrefix) : []));
		}
		case "use_list":
			return node.namedChildren.flatMap((child) => (child ? flattenUseArgument(child, prefix) : []));
		default:
			return [];
	}
}

// Recurses into every inline module body (`mod foo { ... }`), not just the file's own immediate
// children - mirrors `rust-symbol-classification.ts`'s own `declaredFromContainer` recursion, so a
// `use` declared inside an inline module is seen exactly as reliably as the symbols declared
// alongside it are. A `#[cfg(test)]` inline module is skipped rather than recursed into: unlike a
// Symbol, a `RawImport` carries no `isTestItem` tag for `generate-map.ts` to strip by default, so
// collecting a test-only `use` here would leak a test-only import edge into every run regardless
// of `--include-tests` - the same file-level edge a `_test.go`/`tests/*.rs` *file* already avoids.
function useSpecsOf(declaration: Parser.SyntaxNode | null): RustUseSpec[] {
	if (declaration?.type === "mod_item") {
		const body = declaration.childForFieldName("body");
		return body && !hasOwnTestAttribute(declaration) ? collectUseSpecsFrom(body) : [];
	}
	const argument = declaration?.type === "use_declaration" ? declaration.childForFieldName("argument") : null;
	if (!declaration || !argument) return [];
	return flattenUseArgument(argument, undefined).map((fullPath) => ({
		fullPath,
		node: declaration,
	}));
}

function collectUseSpecsFrom(container: Parser.SyntaxNode): RustUseSpec[] {
	return container.namedChildren.flatMap(useSpecsOf);
}

export function collectUseSpecs(sourceFile: Parser.SyntaxNode): RustUseSpec[] {
	return collectUseSpecsFrom(sourceFile);
}

// `super`/other module-relative paths aren't tracked (this pass doesn't know which module a given
// file itself represents), a disclosed fidelity gap alongside this slice's other syntactic-only
// limitations (documentation/USER_GUIDE.md).

// `baseDir`-relative rather than always crate-root-relative: `crate::`'s base is always the
// crate's own `src/`, but `self::`'s base is the *referencing file's own module directory*
// (`modDeclarationContainerDir`, below) - the same directory a `mod foo;` declared in that same
// file would resolve `foo` against. Folding both onto one crate-root-relative lookup (the
// pre-existing bug this replaces) only ever happened to work when the `self::`-qualified
// reference lived in the crate root file (`lib.rs`/`main.rs`), where the two bases coincide.
function resolveModulePathToFile(
	baseDir: string,
	segments: string[],
	programFiles: readonly string[],
): string | undefined {
	const relative = segments.join("/");
	const candidates = relative
		? [path.join(baseDir, `${relative}.rs`), path.join(baseDir, relative, "mod.rs")]
		: [path.join(baseDir, "lib.rs"), path.join(baseDir, "main.rs"), path.join(baseDir, "mod.rs")];
	return candidates.find((candidate) => programFiles.includes(candidate));
}

// `use crate::widget::Widget;`'s last segment is ambiguous between "a module named Widget" and
// "an item named Widget declared inside widget.rs" without a full symbol table - resolved here by
// trying the full path as a module file first, then falling back to the path with its last
// segment dropped (treating it as the item's *declaring* file) exactly as real `mod`/item
// resolution would disambiguate given a real filesystem to check against.
//
// `crate::` is always root-relative, but `self::` means "starting from my own module" - when its
// segments don't correspond to any file-backed module (`resolveModulePathToFile` comes up empty),
// they name something declared inline (a `mod foo { ... }` block, not its own file) rather than
// nonexistent, and an inline module's contents live in the same file as the `self::`-qualified
// reference itself, so that file is the correct resolution rather than no edge at all.
export function resolveInternalTarget(
	crate: RustCrate,
	fullPath: string,
	filePath: string,
	programFiles: readonly string[],
): string | undefined {
	const segments = fullPath.split("::");
	const [first, ...rest] = segments;
	if (first !== "crate" && first !== "self") return undefined;

	const baseDir = first === "crate" ? path.join(crate.crateRootDir, "src") : modDeclarationContainerDir(filePath);

	const asModule = resolveModulePathToFile(baseDir, rest, programFiles);
	if (asModule) return asModule;

	const asDeclaringFile = resolveModulePathToFile(baseDir, rest.slice(0, -1), programFiles);
	if (asDeclaringFile) return asDeclaringFile;

	return first === "self" ? filePath : undefined;
}

function resolveExternalTarget(crate: RustCrate, fullPath: string): ResolvedImportTarget {
	const externCrateName = fullPath.split("::")[0];
	const dependency = crate.dependencies.find((dep) => dep.externCrateName === externCrateName);
	return dependency
		? {
				kind: "external",
				packageName: dependency.name,
				version: dependency.version,
				language: "rust",
			}
		: { kind: "unresolved" }; // stdlib (`std`/`core`/`alloc`), or an undeclared/path/git dependency
}

// `use crate::sub;` brings the *module* `sub` into local scope under that name - a later
// `sub::do_thing()` call site names it bareword, with no `crate::`/`self::` prefix of its own.
// This is call resolution's counterpart to `buildImportAliasToFiles` in the Go Parser: a file's
// own alias -> resolved-file map, consulted only when a call's qualifier isn't itself already a
// `crate::`/`self::`-rooted path.
export function buildModuleAliasToFile(
	specs: RustUseSpec[],
	modDeclarations: RustModDeclaration[],
	crate: RustCrate | undefined,
	filePath: string,
	programFiles: readonly string[],
): Map<string, string> {
	const aliasToFile = new Map<string, string>();

	// A bodiless `mod foo;` binds `foo` as a bareword module path segment usable unqualified in
	// this same file - no `use` required - the same binding a later `foo::bar()` call site (the
	// single most common way ordinary, non-deeply-nested Rust code calls into a sibling module)
	// relies on. Registered before the `use`-derived aliases below and independent of `crate`
	// (mirrors `toModDeclarationImports`, which resolves the same way).
	for (const declaration of modDeclarations) {
		const resolvedFile = resolveModDeclarationFile(filePath, declaration.name, programFiles);
		if (resolvedFile) aliasToFile.set(declaration.name, resolvedFile);
	}

	if (!crate) return aliasToFile;
	for (const spec of specs) {
		const resolvedFile = resolveInternalTarget(crate, spec.fullPath, filePath, programFiles);
		const alias = spec.fullPath.split("::").at(-1);
		if (resolvedFile && alias) aliasToFile.set(alias, resolvedFile);
	}
	return aliasToFile;
}

// Repo-wide counterpart to `buildModuleAliasToFile`: every program file's own `use`-derived
// alias map, keyed by that file's path, so call resolution can look up *any* file's re-exports -
// not just the file currently being extracted - when following a `pub(crate) use` chain
// (`rust-call-resolution.ts`'s `candidatesFollowingReExports`).
export function buildReExportsByFile(
	programFiles: readonly string[],
	rootNodeFor: (filePath: string) => Parser.SyntaxNode | undefined,
	crateFor: (filePath: string) => RustCrate | undefined,
): Map<string, Map<string, string>> {
	const byFile = new Map<string, Map<string, string>>();
	for (const filePath of programFiles) {
		const rootNode = rootNodeFor(filePath);
		if (!rootNode) continue;
		const specs = collectUseSpecs(rootNode);
		const modDeclarations = collectModDeclarations(rootNode);
		const aliasToFile = buildModuleAliasToFile(specs, modDeclarations, crateFor(filePath), filePath, programFiles);
		byFile.set(filePath, aliasToFile);
	}
	return byFile;
}

export function toRawImports(
	specs: RustUseSpec[],
	crate: RustCrate | undefined,
	filePath: string,
	programFiles: readonly string[],
): RawImport[] {
	return specs.map((spec): RawImport => {
		const base = {
			specifier: spec.fullPath,
			viaReExport: false,
			locations: [locationOf(spec.node)],
		};
		if (!crate) return { ...base, resolvedTarget: { kind: "unresolved" } };

		const internalFile = resolveInternalTarget(crate, spec.fullPath, filePath, programFiles);
		return {
			...base,
			resolvedTarget: internalFile
				? { kind: "file", filePath: internalFile }
				: resolveExternalTarget(crate, spec.fullPath),
		};
	});
}

export interface RustModDeclaration {
	name: string;
	node: Parser.SyntaxNode;
}

// A bodiless `mod foo;` (as opposed to an inline `mod foo { ... }`) is Rust's own declaration that
// a sibling file is part of this module tree - the single mechanism that composes a multi-file
// crate in the first place, more fundamental than any `use`. Only top-level (file-scope)
// declarations are collected: a `mod foo;` nested inside another inline module is vanishingly rare
// and would need that ancestor module's own file-path convention to resolve correctly, out of
// scope here.
export function collectModDeclarations(sourceFile: Parser.SyntaxNode): RustModDeclaration[] {
	const declarations: RustModDeclaration[] = [];
	for (const declaration of sourceFile.namedChildren) {
		if (declaration?.type !== "mod_item") continue;
		if (declaration.childForFieldName("body")) continue; // inline body, not a file reference
		const nameNode = declaration.childForFieldName("name");
		if (nameNode) declarations.push({ name: nameNode.text, node: declaration });
	}
	return declarations;
}

// A crate-root file (`lib.rs`/`main.rs`/`mod.rs`) declares its direct submodules as siblings in
// its own directory; any other file `foo.rs` declares its submodules inside a `foo/` directory
// next to it - the same convention `rustc` itself resolves `mod` declarations against.
function modDeclarationContainerDir(filePath: string): string {
	const dir = path.dirname(filePath);
	const stem = path.basename(filePath, ".rs");
	return stem === "lib" || stem === "main" || stem === "mod" ? dir : path.join(dir, stem);
}

function resolveModDeclarationFile(
	filePath: string,
	modName: string,
	programFiles: readonly string[],
): string | undefined {
	const containerDir = modDeclarationContainerDir(filePath);
	const candidates = [path.join(containerDir, `${modName}.rs`), path.join(containerDir, modName, "mod.rs")];
	return candidates.find((candidate) => programFiles.includes(candidate));
}

// Emits one `RawImport` per bodiless `mod foo;` declaration whose target file was actually found -
// "no edge rather than a wrong one" for a nonstandard layout this convention doesn't cover, matching
// this generator's own stated philosophy for every other syntactic-only resolution gap.
export function toModDeclarationImports(
	declarations: RustModDeclaration[],
	filePath: string,
	programFiles: readonly string[],
): RawImport[] {
	return declarations.flatMap((declaration): RawImport[] => {
		const target = resolveModDeclarationFile(filePath, declaration.name, programFiles);
		if (!target) return [];
		return [
			{
				specifier: declaration.name,
				viaReExport: false,
				locations: [locationOf(declaration.node)],
				resolvedTarget: { kind: "file", filePath: target },
			},
		];
	});
}
