import type { RawCall, RawCallCandidate, RawSymbol } from "src/core/types";
import {
	type CollectedCallSite,
	candidatesNamed,
	collectCallSites,
	toRawCallsFrom,
} from "src/extraction/tree-sitter-common/call-resolution";
import type { RepoIndex } from "src/extraction/tree-sitter-common/program-index";
import type Parser from "tree-sitter";

// A call's callee is either a bare `identifier` (an unqualified call - resolved against every
// same-named module-level function in the repo, since an unqualified call site can't itself be a
// method call) or an `attribute` (`x.y()`) whose object is either one of this file's own import
// aliases (a module-qualified call) or anything else, including `self`/an instance (resolved the
// same "every same-named candidate" way an unqualified call is, per the spec's point 8).
function resolveCallCandidates(
	callee: Parser.SyntaxNode,
	index: RepoIndex,
	importAliasToFiles: Map<string, ReadonlySet<string>>,
): RawCallCandidate[] {
	if (callee.type === "identifier") {
		return candidatesNamed(index, callee.text, "function");
	}
	if (callee.type !== "attribute") return [];

	const object = callee.childForFieldName("object");
	const attribute = callee.childForFieldName("attribute");
	if (!object || !attribute) return [];

	const targetFiles = object.type === "identifier" ? importAliasToFiles.get(object.text) : undefined;

	return targetFiles
		? candidatesNamed(index, attribute.text, "function", targetFiles)
		: candidatesNamed(index, attribute.text, "method");
}

// A decorator's own expression is either a `call` (`@app.route("/x")`, whose "function" field is
// the real callee) or a bare `identifier`/`attribute` (`@logged` - no `call` node exists anywhere
// in its subtree, since there are no parens in the source to make one; Python still calls it at
// class/def-time, so this pass treats the bare reference itself as the implicit callee).
function decoratorCalleeNode(decorator: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
	const expression = decorator.namedChild(0);
	if (!expression) return undefined;
	return expression.type === "call" ? (expression.childForFieldName("function") ?? undefined) : expression;
}

// `@logged\ndef run(): ...` desugars to `run = logged(run)` - the decorator is applied once,
// against the definition it wraps, not from *inside* that definition's own body. Left to the
// generic `collectCallSites` walk, it would attribute wrongly anyway: a decorator is a preceding
// sibling of its `function_definition`/`class_definition` under `decorated_definition`, visited
// before that definition's own Symbol is pushed onto the scope stack, so it lands on whatever
// scope enclosed the definition instead (the class body, or nothing at module level). Handled as
// its own pass so every decorator - bare or parameterised - resolves against the *decorated*
// symbol as caller.
function decoratorSitesOf(
	decorated: Parser.SyntaxNode,
	bySymbolNode: Map<Parser.SyntaxNode, RawSymbol>,
): CollectedCallSite[] {
	const definition = decorated.childForFieldName("definition");
	const caller = definition && bySymbolNode.get(definition);
	if (!caller) return [];
	return decorated.namedChildren.flatMap((decorator): CollectedCallSite[] => {
		const callee = decorator?.type === "decorator" ? decoratorCalleeNode(decorator) : null;
		return callee ? [{ callerLocalId: caller.localId, callExpression: callee }] : [];
	});
}

function collectDecoratorCallSites(
	sourceFile: Parser.SyntaxNode,
	bySymbolNode: Map<Parser.SyntaxNode, RawSymbol>,
): CollectedCallSite[] {
	return sourceFile
		.descendantsOfType("decorated_definition")
		.flatMap((decorated) => decoratorSitesOf(decorated, bySymbolNode));
}

export function toRawCalls(
	sourceFile: Parser.SyntaxNode,
	bySymbolNode: Map<Parser.SyntaxNode, RawSymbol>,
	index: RepoIndex,
	importAliasToFiles: Map<string, ReadonlySet<string>>,
): RawCall[] {
	const resolve = (callee: Parser.SyntaxNode) => resolveCallCandidates(callee, index, importAliasToFiles);

	// A decorator's own top-level `call` node is excluded here - `collectDecoratorCallSites` below
	// resolves it (and the bare, call-less decorator form) against the correct caller instead.
	const sites = collectCallSites(
		sourceFile,
		bySymbolNode,
		(node) => node.type === "call" && node.parent?.type !== "decorator",
	);

	return [
		...toRawCallsFrom(sites, (call) => {
			const callee = call.childForFieldName("function");
			return callee ? resolve(callee) : [];
		}),
		...toRawCallsFrom(collectDecoratorCallSites(sourceFile, bySymbolNode), resolve),
	];
}
