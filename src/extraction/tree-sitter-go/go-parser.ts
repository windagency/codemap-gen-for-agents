import { createRequire } from "node:module";
import type { ExtractedSymbols } from "src/core/types";
import type { Parser } from "src/extraction/parser";
import { memoizeManifestLookup } from "src/extraction/tree-sitter-common/program-index";
import {
	parseWithTreeSitter,
	type TreeSitterLanguage,
	type TreeSitterProgram,
} from "src/extraction/tree-sitter-common/tree-sitter-parser";
import { toRawCalls } from "src/extraction/tree-sitter-go/go-call-resolution";
import {
	buildImportAliasToFiles,
	collectImportSpecs,
	toRawImports,
} from "src/extraction/tree-sitter-go/go-import-resolution";
import { findNearestGoModule } from "src/extraction/tree-sitter-go/go-mod";
import { collectDeclaredSymbols } from "src/extraction/tree-sitter-go/go-symbol-classification";

const require = createRequire(import.meta.url);

function buildGoIndex({ rootDir }: TreeSitterProgram) {
	return { goModuleFor: memoizeManifestLookup(rootDir, findNearestGoModule) };
}

const GO: TreeSitterLanguage<ReturnType<typeof buildGoIndex>> = {
	loadGrammar: () => require("tree-sitter-go") as typeof import("tree-sitter-go"),
	collectDeclaredSymbols,
	buildLanguageIndex: buildGoIndex,
	extractFile: ({ filePath, tree, entry }, { programFiles, index }, go) => {
		const goModule = go.goModuleFor(filePath);
		const specs = collectImportSpecs(tree.rootNode);
		return {
			imports: toRawImports(specs, goModule, programFiles),
			calls: toRawCalls(
				tree.rootNode,
				entry.table.bySymbolNode,
				index,
				buildImportAliasToFiles(specs, goModule, programFiles),
			),
		};
	},
};

// Syntactic (tree-sitter, no type checker) Go extraction - matching the fidelity ADR-0002
// earmarked for the multi-language vision, not the whole-program type-checked resolution the
// TS/JS Parser gets from the TypeScript Compiler API.
export class GoTreeSitterParser implements Parser {
	parse(rootDir: string, programFiles: string[], extractFiles: string[]): ExtractedSymbols[] {
		return parseWithTreeSitter(GO, rootDir, programFiles, extractFiles);
	}
}
