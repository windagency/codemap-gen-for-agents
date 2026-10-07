import type { RawSymbol, SymbolKind } from "src/core/types";
import { withLocalIds } from "src/extraction/raw-extraction";
import { locationOf } from "src/extraction/tree-sitter-common/location";
import type Parser from "tree-sitter";

// One language-agnostic declared-symbol shape, produced by each tree-sitter Parser's own
// syntactic classification (Go/Rust/Java/Python each have their own `collectDeclaredSymbols`, since
// which node types count as a top-level declaration or a direct method genuinely differs per
// grammar) and fed into the one shared `toRawSymbols` below.
export interface DeclaredItem {
	name: string;
	symbolKind: SymbolKind;
	node: Parser.SyntaxNode; // the location this Symbol's startLine/endLine comes from
	exported: boolean;
	isTestItem?: boolean;
}

export interface RawSymbolTable {
	rawSymbols: RawSymbol[];
	bySymbolNode: Map<Parser.SyntaxNode, RawSymbol>;
}

// Numbers repeated names via the shared `withLocalIds` rule and keeps a node -> Symbol lookup for
// call resolution.
export function toRawSymbols(declared: DeclaredItem[]): RawSymbolTable {
	const bySymbolNode = new Map<Parser.SyntaxNode, RawSymbol>();

	const rawSymbols = withLocalIds(declared).map(({ localId, name, symbolKind, node, exported, isTestItem }) => {
		const raw: RawSymbol = {
			localId,
			name,
			symbolKind,
			exported,
			...locationOf(node),
			...(isTestItem ? { isTestItem: true } : {}),
		};
		bySymbolNode.set(node, raw);
		return raw;
	});

	return { rawSymbols, bySymbolNode };
}
