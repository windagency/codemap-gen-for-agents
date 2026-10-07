import path from "node:path";
import { parseSourceFile } from "src/extraction/tree-sitter-common/parse-source-file";
import { type DeclaredItem, type RawSymbolTable, toRawSymbols } from "src/extraction/tree-sitter-common/raw-symbols";
import type Parser from "tree-sitter";

export interface FileSymbolIndex {
	filePath: string;
	table: RawSymbolTable;
}

// Repo-wide (built once per `parse()` call from every file in `programFiles`, not just
// `extractFiles` - a call's target is frequently in a file this run isn't even re-extracting).
export type RepoIndex = Map<string, FileSymbolIndex>;

export interface ProgramIndex {
	index: RepoIndex;
	treeByFile: Map<string, Parser.Tree>;
}

// Parses every `programFiles` entry once, classifies its top-level declarations via that
// language's own `collectDeclaredSymbols`, and keeps the tree so the per-file pass never
// re-parses it. A tree with an ERROR or MISSING node is syntactically broken and left out of
// both maps.
export function buildProgramIndex(
	parser: Parser,
	programFiles: string[],
	collectDeclaredSymbols: (root: Parser.SyntaxNode) => DeclaredItem[],
): ProgramIndex {
	const index: RepoIndex = new Map();
	const treeByFile = new Map<string, Parser.Tree>();
	for (const filePath of programFiles) {
		const tree = parseSourceFile(parser, filePath);
		if (tree.rootNode.hasError) continue;
		treeByFile.set(filePath, tree);
		const declared = collectDeclaredSymbols(tree.rootNode);
		const table = toRawSymbols(declared);
		index.set(filePath, { filePath, table });
	}
	return { index, treeByFile };
}

// Memoises a manifest lookup (`findNearestGoModule`/`findNearestRustCrate`/
// `findNearestJavaProject`/`findNearestPythonProject`) by directory, since the same directory is looked up once per file in
// it.
export function memoizeManifestLookup<Manifest>(
	rootDir: string,
	findNearest: (rootDir: string, startDir: string) => Manifest | undefined,
): (filePath: string) => Manifest | undefined {
	const cache = new Map<string, Manifest | undefined>();
	return (filePath: string): Manifest | undefined => {
		const dir = path.dirname(filePath);
		if (!cache.has(dir)) {
			cache.set(dir, findNearest(rootDir, dir));
		}
		return cache.get(dir);
	};
}
