import type { ExtractedSymbols } from "src/core/types";
import type { Parser } from "src/extraction/parser";
import { memoizeManifestLookup } from "src/extraction/tree-sitter-common/program-index";
import {
	parseWithTreeSitter,
	type TreeSitterLanguage,
	type TreeSitterProgram,
} from "src/extraction/tree-sitter-common/tree-sitter-parser";
import { buildTypeNameIndex, toRawCalls } from "src/extraction/tree-sitter-java/java-call-resolution";
import {
	buildFqcnIndex,
	buildVisibleTypeIndex,
	collectImportSpecs,
	collectSupertypeReferences,
	toRawImports,
	toSupertypeImports,
} from "src/extraction/tree-sitter-java/java-import-resolution";
import { findNearestJavaProject } from "src/extraction/tree-sitter-java/java-project";
import { collectDeclaredSymbols } from "src/extraction/tree-sitter-java/java-symbol-classification";
import Java from "tree-sitter-java";

function buildJavaIndex({ rootDir, programFiles, index, treeByFile }: TreeSitterProgram) {
	return {
		projectFor: memoizeManifestLookup(rootDir, findNearestJavaProject),
		typeNameIndex: buildTypeNameIndex(index),
		fqcnIndex: buildFqcnIndex(
			programFiles.flatMap((filePath) => {
				const tree = treeByFile.get(filePath);
				return tree ? [{ filePath, sourceFile: tree.rootNode }] : [];
			}),
		),
	};
}

const JAVA: TreeSitterLanguage<ReturnType<typeof buildJavaIndex>> = {
	grammar: Java,
	collectDeclaredSymbols,
	buildLanguageIndex: buildJavaIndex,
	extractFile: ({ filePath, tree, entry }, { index }, java) => {
		const specs = collectImportSpecs(tree.rootNode);
		const visibleTypeIndex = buildVisibleTypeIndex(tree.rootNode, specs, java.fqcnIndex);
		return {
			imports: [
				...toRawImports(specs, java.fqcnIndex, java.projectFor(filePath)),
				...toSupertypeImports(collectSupertypeReferences(tree.rootNode), visibleTypeIndex),
			],
			calls: toRawCalls(tree.rootNode, entry.table.bySymbolNode, index, java.typeNameIndex, visibleTypeIndex),
		};
	},
};

// Syntactic (tree-sitter, no type checker) Java extraction - matching the fidelity ADR-0002
// earmarked for the multi-language vision, not the whole-program type-checked resolution the
// TS/JS Parser gets from the TypeScript Compiler API.
export class JavaTreeSitterParser implements Parser {
	parse(rootDir: string, programFiles: string[], extractFiles: string[]): ExtractedSymbols[] {
		return parseWithTreeSitter(JAVA, rootDir, programFiles, extractFiles);
	}
}
