import type { RawCall, RawCallCandidate, RawSymbol } from "src/core/types";
import { dedupeAndSortCandidates } from "src/extraction/raw-extraction";
import { locationOf } from "src/extraction/tree-sitter-common/location";
import type { RepoIndex } from "src/extraction/tree-sitter-common/program-index";
import type Parser from "tree-sitter";

// Repo-wide same-name lookup shared by Go/Rust/Java/Python's own `resolveCallCandidates` - the
// "every same-named top-level declaration" fallback the spec requires when a call can't be
// resolved to one specific target (namespace-qualified calls resolve elsewhere, before this).
export function candidatesNamed(
	index: RepoIndex,
	name: string,
	symbolKind: RawSymbol["symbolKind"],
	onlyFiles?: ReadonlySet<string>,
): RawCallCandidate[] {
	const candidates: RawCallCandidate[] = [];
	for (const [filePath, { table }] of index) {
		if (onlyFiles && !onlyFiles.has(filePath)) continue;
		for (const symbol of table.rawSymbols) {
			if (symbol.symbolKind === symbolKind && symbol.name === name) {
				candidates.push({ filePath, localId: symbol.localId });
			}
		}
	}
	return candidates;
}

export interface CollectedCallSite {
	callerLocalId: string;
	callExpression: Parser.SyntaxNode;
}

// One entry per top-level function/method declaration (the same scope any of its own nested
// calls attribute to) - a single recursive walk re-scopes at each declaration boundary, mirroring
// `ts-compiler-api/call-resolution.ts`'s `collectCallSites`. `isCallNode` is the one thing that
// differs per language (Go/Rust's `call_expression` vs Java's `method_invocation`).
export function collectCallSites(
	sourceFile: Parser.SyntaxNode,
	bySymbolNode: Map<Parser.SyntaxNode, RawSymbol>,
	isCallNode: (node: Parser.SyntaxNode) => boolean,
): CollectedCallSite[] {
	const sites: CollectedCallSite[] = [];

	// `caller` is the innermost enclosing Symbol, or undefined outside any.
	function visit(node: Parser.SyntaxNode, caller: RawSymbol | undefined): void {
		const scope = bySymbolNode.get(node) ?? caller;
		if (scope && isCallNode(node)) {
			sites.push({ callerLocalId: scope.localId, callExpression: node });
		}
		for (const child of node.namedChildren) {
			if (child) visit(child, scope);
		}
	}

	visit(sourceFile, undefined);
	return sites;
}

// Shared tail of every language's own `toRawCalls`: turn each collected call site into a `RawCall`
// once its candidates are resolved, dropping sites that resolved to nothing.
export function toRawCallsFrom(
	sites: CollectedCallSite[],
	resolveCandidates: (callExpression: Parser.SyntaxNode) => RawCallCandidate[],
): RawCall[] {
	return sites.flatMap(({ callerLocalId, callExpression }): RawCall[] => {
		const candidates = dedupeAndSortCandidates(resolveCandidates(callExpression));
		if (candidates.length === 0) return [];

		return [
			{
				callerLocalId,
				candidates,
				locations: [locationOf(callExpression)],
			},
		];
	});
}
