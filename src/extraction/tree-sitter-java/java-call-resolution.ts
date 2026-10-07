import type { RawCall, RawCallCandidate, RawSymbol } from "src/core/types";
import { candidatesNamed, collectCallSites, toRawCallsFrom } from "src/extraction/tree-sitter-common/call-resolution";
import type { RepoIndex } from "src/extraction/tree-sitter-common/program-index";
import type Parser from "tree-sitter";

// `simple type name -> declaring file(s)` - more than one entry for a name means two classes with
// that same simple (non-package-qualified) name exist in the repo, a genuine ambiguity that
// naturally fans out into multiple candidates rather than guessing one.
export function buildTypeNameIndex(index: RepoIndex): Map<string, ReadonlySet<string>> {
	const byName = new Map<string, Set<string>>();
	for (const [filePath, { table }] of index) {
		for (const symbol of table.rawSymbols) {
			if (symbol.symbolKind !== "class" && symbol.symbolKind !== "interface" && symbol.symbolKind !== "enum") {
				continue;
			}
			const files = byName.get(symbol.name) ?? new Set<string>();
			files.add(filePath);
			byName.set(symbol.name, files);
		}
	}
	return byName;
}

// A `method_invocation`'s optional "object" field is either a class name (`Helper.assist()` - a
// qualified/static-style call, spec point 7) or a receiver whose type this syntactic pass can't
// know (`w.greet()`, or the implicit receiver of an unqualified `doThing()` - spec point 8).
// A class-name qualifier resolves through *this file's own* visible-type index first (its
// same-package classes and its own imports) so an imported `Helper` resolves to the specific
// class this file actually imports, not every same-named `Helper` anywhere in the repo - falling
// back to the repo-wide, genuinely-ambiguous `typeNameIndex` only when the qualifier isn't
// something this file itself can see as a type (most often because it's a variable, not a class).
function resolveCallCandidates(
	callExpression: Parser.SyntaxNode,
	index: RepoIndex,
	typeNameIndex: Map<string, ReadonlySet<string>>,
	visibleTypeIndex: Map<string, string>,
): RawCallCandidate[] {
	const nameNode = callExpression.childForFieldName("name");
	if (!nameNode) return [];

	const objectNode = callExpression.childForFieldName("object");
	if (objectNode?.type === "identifier") {
		const visibleFile = visibleTypeIndex.get(objectNode.text);
		if (visibleFile) {
			return candidatesNamed(index, nameNode.text, "method", new Set([visibleFile]));
		}
		const ambiguousFiles = typeNameIndex.get(objectNode.text);
		if (ambiguousFiles) {
			return candidatesNamed(index, nameNode.text, "method", ambiguousFiles);
		}
	}

	// Java has no free functions, so every call resolves against methods.
	return candidatesNamed(index, nameNode.text, "method");
}

export function toRawCalls(
	sourceFile: Parser.SyntaxNode,
	bySymbolNode: Map<Parser.SyntaxNode, RawSymbol>,
	index: RepoIndex,
	typeNameIndex: Map<string, ReadonlySet<string>>,
	visibleTypeIndex: Map<string, string>,
): RawCall[] {
	const sites = collectCallSites(sourceFile, bySymbolNode, (node) => node.type === "method_invocation");

	return toRawCallsFrom(sites, (callExpression) =>
		resolveCallCandidates(callExpression, index, typeNameIndex, visibleTypeIndex),
	);
}
