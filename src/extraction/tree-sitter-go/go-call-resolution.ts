import type { RawCall, RawCallCandidate, RawSymbol } from "src/core/types";
import { candidatesNamed, collectCallSites, toRawCallsFrom } from "src/extraction/tree-sitter-common/call-resolution";
import type { RepoIndex } from "src/extraction/tree-sitter-common/program-index";
import type Parser from "tree-sitter";

// A call's callee is either a bare `identifier` (an unqualified call - always a function, since
// Go has no unqualified method calls) or a `selector_expression` (`x.Y()`) whose operand is
// either one of this file's own import aliases (a namespace-qualified package call) or anything
// else (a method call on a receiver whose type this syntactic pass can't know - resolved the same
// "every same-named candidate" way an unqualified call is, per the spec's point 8).
function resolveCallCandidates(
	callee: Parser.SyntaxNode,
	index: RepoIndex,
	importAliasToFiles: Map<string, ReadonlySet<string>>,
): RawCallCandidate[] {
	if (callee.type === "identifier") {
		return candidatesNamed(index, callee.text, "function");
	}
	if (callee.type !== "selector_expression") return [];

	const operand = callee.childForFieldName("operand");
	const field = callee.childForFieldName("field");
	if (!operand || !field) return [];

	const targetFiles = operand.type === "identifier" ? importAliasToFiles.get(operand.text) : undefined;

	return targetFiles
		? candidatesNamed(index, field.text, "function", targetFiles)
		: candidatesNamed(index, field.text, "method");
}

export function toRawCalls(
	sourceFile: Parser.SyntaxNode,
	bySymbolNode: Map<Parser.SyntaxNode, RawSymbol>,
	index: RepoIndex,
	importAliasToFiles: Map<string, ReadonlySet<string>>,
): RawCall[] {
	const sites = collectCallSites(sourceFile, bySymbolNode, (node) => node.type === "call_expression");

	return toRawCallsFrom(sites, (callExpression) => {
		const callee = callExpression.childForFieldName("function");
		if (!callee) return [];
		return resolveCallCandidates(callee, index, importAliasToFiles);
	});
}
