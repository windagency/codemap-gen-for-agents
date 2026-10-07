import path from "node:path";
import { isTestFile } from "src/core/test-file";
import type { RawImport, ResolvedImportTarget } from "src/core/types";
import { locationOf } from "src/extraction/tree-sitter-common/location";
import type { GoModule } from "src/extraction/tree-sitter-go/go-mod";
import type Parser from "tree-sitter";

export interface GoImportSpec {
	// `undefined` for a default (last-path-segment) alias, "." (dot-import), or "_" (blank import)
	// - none of those are a usable local name a call site could qualify through.
	aliasName: string | undefined;
	importPath: string;
	node: Parser.SyntaxNode;
}

function stringLiteralText(node: Parser.SyntaxNode): string {
	// Both `interpreted_string_literal` ("...") and `raw_string_literal` (`...`) wrap their
	// content in a single quote character on each side.
	return node.text.slice(1, -1);
}

function toImportSpec(spec: Parser.SyntaxNode): GoImportSpec[] {
	const pathNode = spec.childForFieldName("path");
	if (!pathNode) return [];
	const rawAlias = spec.childForFieldName("name")?.text;
	const aliasName = rawAlias && rawAlias !== "." && rawAlias !== "_" ? rawAlias : undefined;
	return [{ aliasName, importPath: stringLiteralText(pathNode), node: spec }];
}

export function collectImportSpecs(sourceFile: Parser.SyntaxNode): GoImportSpec[] {
	return sourceFile.namedChildren
		.filter((declaration) => declaration?.type === "import_declaration")
		.flatMap((declaration) => (declaration ? declaration.descendantsOfType("import_spec") : []))
		.flatMap(toImportSpec);
}

// A Go import's unit is a whole package (a directory), not a single file - every `.go` file
// directly in that directory (`programFiles` already reflects Discovery's own test-exclusion when
// tests are excluded, so this never has to re-derive that) is a resolution target, fanned out into
// one `RawImport` per file rather than invented as a single "package" node the schema has no room
// for. `_test.go` files are excluded unconditionally, not just when Discovery already dropped them
// - a `_test.go` file is never part of the *importable* package, even under `--include-tests`
// (which puts test files into `programFiles` for their own package's sake), so it must never be
// fanned out as an import target for some other, unrelated importer of the same directory.
export function resolveInternalImportFiles(
	goModule: GoModule,
	importPath: string,
	programFiles: readonly string[],
): string[] {
	const { modulePath, rootDir } = goModule;
	let targetDir: string | undefined;
	if (importPath === modulePath) {
		targetDir = rootDir;
	} else if (importPath.startsWith(`${modulePath}/`)) {
		targetDir = path.join(rootDir, importPath.slice(modulePath.length + 1));
	}
	if (targetDir === undefined) return [];

	return programFiles.filter(
		(file) => path.extname(file) === ".go" && path.dirname(file) === targetDir && !isTestFile(file),
	);
}

function resolveExternalTarget(goModule: GoModule, importPath: string): ResolvedImportTarget {
	const matches = goModule.requires.filter(
		(req) => importPath === req.modulePath || importPath.startsWith(`${req.modulePath}/`),
	);
	// Longest modulePath match wins - a require entry for a submodule (rare, but legal in Go's
	// module system) takes precedence over its own parent module's entry.
	const best = matches.sort((a, b) => b.modulePath.length - a.modulePath.length)[0];
	return best
		? {
				kind: "external",
				packageName: best.modulePath,
				version: best.version,
				language: "go",
			}
		: { kind: "unresolved" }; // stdlib, or any dependency go.mod doesn't declare a version for
}

// A file's own alias -> resolved-internal-target-files map, used by call resolution to look up
// a namespace-qualified call's candidates - an alias resolving to zero internal files (external, or unresolved) simply yields no
// candidates through that alias, the same "no traceable declaration -> drop" outcome an
// unqualified call gets when nothing matches.
export function buildImportAliasToFiles(
	specs: GoImportSpec[],
	goModule: GoModule | undefined,
	programFiles: readonly string[],
): Map<string, ReadonlySet<string>> {
	const aliasToFiles = new Map<string, ReadonlySet<string>>();
	if (!goModule) return aliasToFiles;

	for (const spec of specs) {
		const localName = spec.aliasName ?? spec.importPath.split("/").at(-1);
		if (!localName) continue;
		const files = resolveInternalImportFiles(goModule, spec.importPath, programFiles);
		aliasToFiles.set(localName, new Set(files));
	}
	return aliasToFiles;
}

export function toRawImports(
	specs: GoImportSpec[],
	goModule: GoModule | undefined,
	programFiles: readonly string[],
): RawImport[] {
	return specs.flatMap((spec): RawImport[] => {
		const location = locationOf(spec.node);
		const base = {
			specifier: spec.importPath,
			viaReExport: false,
			locations: [location],
		};

		if (!goModule) return [{ ...base, resolvedTarget: { kind: "unresolved" } }];

		const internalFiles = resolveInternalImportFiles(goModule, spec.importPath, programFiles);
		if (internalFiles.length > 0) {
			return internalFiles.map((filePath) => ({
				...base,
				resolvedTarget: { kind: "file", filePath },
			}));
		}

		return [
			{
				...base,
				resolvedTarget: resolveExternalTarget(goModule, spec.importPath),
			},
		];
	});
}
