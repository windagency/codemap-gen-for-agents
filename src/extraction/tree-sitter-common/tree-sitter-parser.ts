import type { ExtractedSymbols, RawCall, RawImport } from "src/core/types";
import {
	buildProgramIndex,
	type FileSymbolIndex,
	type RepoIndex,
} from "src/extraction/tree-sitter-common/program-index";
import type { DeclaredItem } from "src/extraction/tree-sitter-common/raw-symbols";
import TreeSitterParser from "tree-sitter";

// Whole-program state every language's per-file pass can read.
export interface TreeSitterProgram {
	rootDir: string;
	// Every parseable program file. A syntactically broken file is left out, so an import into it
	// resolves as unresolved rather than to a file that produces no node.
	programFiles: string[];
	index: RepoIndex;
	treeByFile: Map<string, TreeSitterParser.Tree>;
}

export interface TreeSitterFile {
	filePath: string;
	tree: TreeSitterParser.Tree;
	entry: FileSymbolIndex;
}

// What one language contributes to the shared Go/Rust/Java/Python `Parser.parse()` skeleton:
// its grammar loader, its declaration classifier, any extra whole-program index it needs, and its
// per-file import/call resolution.
export interface TreeSitterLanguage<LanguageIndex> {
	// Called only once there are files to extract, so a grammar whose native binding fails to load
	// (`tree-sitter-java` on Linux arm64 without a build toolchain) only fails runs that contain
	// that language.
	loadGrammar: () => TreeSitterParser.Language;
	collectDeclaredSymbols: (root: TreeSitterParser.SyntaxNode) => DeclaredItem[];
	buildLanguageIndex: (program: TreeSitterProgram) => LanguageIndex;
	extractFile: (
		file: TreeSitterFile,
		program: TreeSitterProgram,
		languageIndex: LanguageIndex,
	) => { imports: RawImport[]; calls: RawCall[] };
}

// Parses every program file once, builds the repo-wide index from `programFiles` (not just
// `extractFiles`: a call's target is often a file this run isn't re-extracting, documentation/adr/0003),
// then extracts each requested file. A file whose tree holds an ERROR or MISSING node produces
// no entry at all, the same unparseable-file policy `TsCompilerApiParser` applies.
export function parseWithTreeSitter<LanguageIndex>(
	language: TreeSitterLanguage<LanguageIndex>,
	rootDir: string,
	programFiles: string[],
	extractFiles: string[],
): ExtractedSymbols[] {
	if (extractFiles.length === 0) return [];

	const parser = new TreeSitterParser();
	parser.setLanguage(language.loadGrammar());

	const parsed = buildProgramIndex(parser, programFiles, language.collectDeclaredSymbols);
	const program: TreeSitterProgram = {
		rootDir,
		programFiles: programFiles.filter((filePath) => parsed.index.has(filePath)),
		index: parsed.index,
		treeByFile: parsed.treeByFile,
	};
	const languageIndex = language.buildLanguageIndex(program);

	return extractFiles.flatMap((filePath): ExtractedSymbols[] => {
		const entry = program.index.get(filePath);
		const tree = program.treeByFile.get(filePath);
		if (!entry || !tree) return [];

		const { imports, calls } = language.extractFile({ filePath, tree, entry }, program, languageIndex);
		return [{ filePath, symbols: entry.table.rawSymbols, imports, calls }];
	});
}
