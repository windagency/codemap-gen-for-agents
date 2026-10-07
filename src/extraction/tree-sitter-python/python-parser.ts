import type { ExtractedSymbols } from "src/core/types";
import type { Parser } from "src/extraction/parser";
import { memoizeManifestLookup } from "src/extraction/tree-sitter-common/program-index";
import {
	parseWithTreeSitter,
	type TreeSitterLanguage,
	type TreeSitterProgram,
} from "src/extraction/tree-sitter-common/tree-sitter-parser";
import { findNearestPythonProject } from "src/extraction/tree-sitter-python/pyproject-manifest";
import { toRawCalls } from "src/extraction/tree-sitter-python/python-call-resolution";
import {
	buildImportAliasToFiles,
	collectImportSpecs,
	toRawImports,
} from "src/extraction/tree-sitter-python/python-import-resolution";
import { collectDeclaredSymbols } from "src/extraction/tree-sitter-python/python-symbol-classification";
import Python from "tree-sitter-python";

function buildPythonIndex({ rootDir }: TreeSitterProgram) {
	return {
		projectFor: memoizeManifestLookup(rootDir, findNearestPythonProject),
	};
}

const PYTHON: TreeSitterLanguage<ReturnType<typeof buildPythonIndex>> = {
	grammar: Python,
	collectDeclaredSymbols,
	buildLanguageIndex: buildPythonIndex,
	extractFile: ({ filePath, tree, entry }, { programFiles, index }, python) => {
		const project = python.projectFor(filePath);
		const specs = collectImportSpecs(tree.rootNode);
		return {
			imports: toRawImports(filePath, specs, project, programFiles),
			calls: toRawCalls(
				tree.rootNode,
				entry.table.bySymbolNode,
				index,
				buildImportAliasToFiles(filePath, specs, project, programFiles),
			),
		};
	},
};

// Syntactic (tree-sitter, no type checker) Python extraction - matching the fidelity ADR-0002
// earmarked for the multi-language vision, not the whole-program type-checked resolution the
// TS/JS Parser gets from the TypeScript Compiler API (documentation/adr/0030).
export class PythonTreeSitterParser implements Parser {
	parse(rootDir: string, programFiles: string[], extractFiles: string[]): ExtractedSymbols[] {
		return parseWithTreeSitter(PYTHON, rootDir, programFiles, extractFiles);
	}
}
