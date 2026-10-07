import type { RawCall, RawCallCandidate, RawSymbol } from "src/core/types";
import { candidatesNamed, collectCallSites, toRawCallsFrom } from "src/extraction/tree-sitter-common/call-resolution";
import type { RepoIndex } from "src/extraction/tree-sitter-common/program-index";
import type { RustCrate } from "src/extraction/tree-sitter-rust/cargo-manifest";
import { resolveInternalTarget } from "src/extraction/tree-sitter-rust/rust-import-resolution";
import type Parser from "tree-sitter";

// `crate::widget::Widget::new()`'s "path" field before the trailing `::new` segment is a
// `scoped_identifier`, whose own "name" field is the qualifier immediately before `new`
// ("Widget") - the piece that tells an associated-function call (`Widget::new()`) apart from a
// free-function call reached by full module path (`crate::widget::other::deep()`).
function immediateQualifier(pathNode: Parser.SyntaxNode): string {
	return pathNode.type === "scoped_identifier"
		? (pathNode.childForFieldName("name")?.text ?? pathNode.text)
		: pathNode.text;
}

// A generic impl's "type" field text is the whole generic type (`"Error<F>"`), but a call site
// naming that type (`Error::invalid_utf8()`) only ever gives the bare name - Rust call syntax
// never repeats the impl's own generic parameters at the call site. Stripped at the first `<` so
// the impl-type index is keyed the same way call sites are, regardless of how many (or which)
// generic parameters the impl declares.
function baseTypeName(typeText: string): string {
	const genericStart = typeText.indexOf("<");
	return genericStart === -1 ? typeText : typeText.slice(0, genericStart);
}

// `impl Widget { fn new() {} }` - a method's own `function_item` node's grandparent is the
// `impl_item` it's declared inside (`function_item -> declaration_list -> impl_item`), whose
// "type" field gives the plain type name text `Widget::method()` qualifies through. Never `undefined`
// for a real method Symbol (every one is only ever produced from inside an `impl_item`'s body).
function implTypeNameOf(methodNode: Parser.SyntaxNode): string | undefined {
	const implItem = methodNode.parent?.parent;
	if (implItem?.type !== "impl_item") return undefined;
	const typeText = implItem.childForFieldName("type")?.text;
	return typeText ? baseTypeName(typeText) : undefined;
}

// `implTypeName -> methodName -> candidates`, built once per `parse()` call by walking every
// already-classified method Symbol's own declaration node back up to its `impl_item` - reused
// across every associated-function call site in this run rather than rescanned per call site.
// `[implTypeName, methodName, candidate]` for every method Symbol declared in an `impl` block.
function implMethodEntries(index: RepoIndex): [string, string, RawCallCandidate][] {
	return [...index].flatMap(([filePath, { table }]) =>
		[...table.bySymbolNode].flatMap(([node, symbol]): [string, string, RawCallCandidate][] => {
			const typeName = symbol.symbolKind === "method" ? implTypeNameOf(node) : undefined;
			return typeName ? [[typeName, symbol.name, { filePath, localId: symbol.localId }]] : [];
		}),
	);
}

export function buildImplTypeIndex(index: RepoIndex): Map<string, Map<string, RawCallCandidate[]>> {
	const byType = new Map<string, Map<string, RawCallCandidate[]>>();
	for (const [typeName, methodName, candidate] of implMethodEntries(index)) {
		const byMethod = byType.get(typeName) ?? new Map();
		byMethod.set(methodName, [...(byMethod.get(methodName) ?? []), candidate]);
		byType.set(typeName, byMethod);
	}
	return byType;
}

// A module-path-qualified free-function call (`crate::util::str_to_bool()`) resolves to the file
// its path names, but that file may not declare the function itself - it may only bring the name
// into scope via its own `pub(crate) use self::str_to_bool::str_to_bool;` re-export, the standard
// way a module's `mod.rs` curates a smaller public surface over its own submodules. Followed here
// one hop at a time via each file's own `use`-derived alias map (`reExportsByFile`, built the same
// way `buildModuleAliasToFile` builds one for the *calling* file, but for every file in the repo)
// until a file that actually declares the name is found, or a cycle/dead end is hit.
function candidatesFollowingReExports(
	index: RepoIndex,
	name: string,
	startFile: string,
	reExportsByFile: ReadonlyMap<string, ReadonlyMap<string, string>>,
): RawCallCandidate[] {
	const visited = new Set<string>();
	let currentFile: string | undefined = startFile;
	while (currentFile && !visited.has(currentFile)) {
		visited.add(currentFile);
		const direct = candidatesNamed(index, name, "function", new Set([currentFile]));
		if (direct.length > 0) return direct;
		currentFile = reExportsByFile.get(currentFile)?.get(name);
	}
	return [];
}

// Everything a Rust call site in one file resolves against, bundled so the resolvers below take
// one argument instead of seven.
export interface RustCallContext {
	index: RepoIndex;
	implTypeIndex: Map<string, Map<string, RawCallCandidate[]>>;
	moduleAliasToFile: Map<string, string>;
	reExportsByFile: ReadonlyMap<string, ReadonlyMap<string, string>>;
	crate: RustCrate | undefined;
	filePath: string;
	programFiles: readonly string[];
}

// `X::y()`: an associated-function call (`Widget::new()`, resolved via the impl-type index, spec
// point 7), a call through a file-local module alias, or a module-path-qualified free-function
// call (`crate::a::b::f()`, resolved to its specific file, spec point 7).
function resolveScopedCall(callee: Parser.SyntaxNode, context: RustCallContext): RawCallCandidate[] {
	const pathNode = callee.childForFieldName("path");
	const nameNode = callee.childForFieldName("name");
	if (!pathNode || !nameNode) return [];

	const qualifier = immediateQualifier(pathNode);
	const implCandidates = context.implTypeIndex.get(qualifier)?.get(nameNode.text);
	if (implCandidates) return implCandidates;

	// `sub::do_thing()`, where `sub` came into scope via a plain `use crate::sub;` - resolved
	// through that file-local alias before falling back to treating `pathNode` as an
	// already-fully-qualified `crate::`/`self::` path in its own right. Followed through
	// `aliasedFile`'s own re-exports too: `sub` may be a `mod.rs`-style file that only curates a
	// `pub(crate) use` over its own submodule rather than declaring the name itself.
	const targetFile =
		context.moduleAliasToFile.get(qualifier) ??
		(context.crate && resolveInternalTarget(context.crate, pathNode.text, context.filePath, context.programFiles));
	return targetFile
		? candidatesFollowingReExports(context.index, nameNode.text, targetFile, context.reExportsByFile)
		: [];
}

// A call's callee is a bare `identifier` (an unqualified free-function call - matched against
// every same-named top-level function in the repo, spec point 8), a `field_expression`
// (`x.y()` - a method call on a receiver whose type this syntactic pass can't know, resolved the
// same "every same-named candidate" way, spec point 8), or a `scoped_identifier` (`X::y()`).
function resolveCallCandidates(callExpression: Parser.SyntaxNode, context: RustCallContext): RawCallCandidate[] {
	const callee = callExpression.childForFieldName("function");
	if (callee?.type === "identifier") {
		return candidatesNamed(context.index, callee.text, "function");
	}
	if (callee?.type === "field_expression") {
		const field = callee.childForFieldName("field");
		return field ? candidatesNamed(context.index, field.text, "method") : [];
	}
	if (callee?.type === "scoped_identifier") {
		return resolveScopedCall(callee, context);
	}
	return [];
}

export function toRawCalls(
	sourceFile: Parser.SyntaxNode,
	bySymbolNode: Map<Parser.SyntaxNode, RawSymbol>,
	context: RustCallContext,
): RawCall[] {
	const sites = collectCallSites(sourceFile, bySymbolNode, (node) => node.type === "call_expression");

	return toRawCallsFrom(sites, (callExpression) => resolveCallCandidates(callExpression, context));
}
