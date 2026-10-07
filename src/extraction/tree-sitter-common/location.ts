import type { EdgeLocation } from "src/core/types";
import type Parser from "tree-sitter";

// tree-sitter's row is 0-based; the schema's lines are 1-based (mirrors
// `ts-compiler-api/ast-utils.ts`'s own `locationOf`).
export function locationOf(node: Parser.SyntaxNode): EdgeLocation {
	return {
		startLine: node.startPosition.row + 1,
		endLine: node.endPosition.row + 1,
	};
}
