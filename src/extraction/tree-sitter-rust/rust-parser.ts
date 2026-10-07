import type { ExtractedSymbols } from "src/core/types";
import type { Parser } from "src/extraction/parser";
import { memoizeManifestLookup } from "src/extraction/tree-sitter-common/program-index";
import {
	parseWithTreeSitter,
	type TreeSitterLanguage,
	type TreeSitterProgram,
} from "src/extraction/tree-sitter-common/tree-sitter-parser";
import { findNearestRustCrate } from "src/extraction/tree-sitter-rust/cargo-manifest";
import { buildImplTypeIndex, toRawCalls } from "src/extraction/tree-sitter-rust/rust-call-resolution";
import {
	buildModuleAliasToFile,
	buildReExportsByFile,
	collectModDeclarations,
	collectUseSpecs,
	toModDeclarationImports,
	toRawImports,
} from "src/extraction/tree-sitter-rust/rust-import-resolution";
import { collectDeclaredSymbols } from "src/extraction/tree-sitter-rust/rust-symbol-classification";
import Rust from "tree-sitter-rust";

function buildRustIndex({ rootDir, programFiles, index, treeByFile }: TreeSitterProgram) {
	const crateFor = memoizeManifestLookup(rootDir, findNearestRustCrate);
	return {
		crateFor,
		implTypeIndex: buildImplTypeIndex(index),
		reExportsByFile: buildReExportsByFile(programFiles, (filePath) => treeByFile.get(filePath)?.rootNode, crateFor),
	};
}

const RUST: TreeSitterLanguage<ReturnType<typeof buildRustIndex>> = {
	grammar: Rust,
	collectDeclaredSymbols,
	buildLanguageIndex: buildRustIndex,
	extractFile: ({ filePath, tree, entry }, { programFiles, index }, rust) => {
		const crate = rust.crateFor(filePath);
		const specs = collectUseSpecs(tree.rootNode);
		const modDeclarations = collectModDeclarations(tree.rootNode);
		return {
			imports: [
				...toRawImports(specs, crate, filePath, programFiles),
				...toModDeclarationImports(modDeclarations, filePath, programFiles),
			],
			calls: toRawCalls(tree.rootNode, entry.table.bySymbolNode, {
				index,
				implTypeIndex: rust.implTypeIndex,
				moduleAliasToFile: buildModuleAliasToFile(specs, modDeclarations, crate, filePath, programFiles),
				reExportsByFile: rust.reExportsByFile,
				crate,
				filePath,
				programFiles,
			}),
		};
	},
};

// Syntactic (tree-sitter, no type checker) Rust extraction - matching the fidelity ADR-0002
// earmarked for the multi-language vision, not the whole-program type-checked resolution the
// TS/JS Parser gets from the TypeScript Compiler API.
export class RustTreeSitterParser implements Parser {
	parse(rootDir: string, programFiles: string[], extractFiles: string[]): ExtractedSymbols[] {
		return parseWithTreeSitter(RUST, rootDir, programFiles, extractFiles);
	}
}
