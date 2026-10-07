import { isFunctionDeclaration, isMethodDeclaration, type Node } from "typescript/unstable/ast";
import { type Checker, SymbolFlags, type Symbol as TsSymbol } from "typescript/unstable/sync";

// Checker-dependent node-resolution helpers shared between call resolution and nominal dispatch -
// both need to go from a reference/symbol back to its declaration node.

// `checker.getSymbolAtLocation` on a reference to an imported binding (a function, class, or
// interface name imported from another file) resolves to the *alias* symbol representing the
// import specifier itself, not the aliased declaration - a well-known classic-API quirk this
// sync API preserves. Every reference resolution in this directory (call callees, heritage-clause
// type names) goes through this helper so that quirk is handled exactly once.
export function resolveReferencedSymbol(checker: Checker, node: Node): TsSymbol | undefined {
	const symbol = checker.getSymbolAtLocation(node);
	if (!symbol) return undefined;
	if ((symbol.flags & SymbolFlags.Alias) === 0) return symbol;
	const aliased = checker.getAliasedSymbol(symbol);
	return checker.isUnknownSymbol(aliased) ? undefined : aliased;
}

function hasBody(node: Node): boolean {
	return (isFunctionDeclaration(node) || isMethodDeclaration(node)) && node.body !== undefined;
}

// A function/method symbol's `declarations` holds one entry per overload signature plus the
// final implementation, in source order - `valueDeclaration`/`declarations[0]` lands on the
// *first* one, which for an overloaded declaration is a signature with no body, never the
// implementation a call actually reaches at runtime. Only scanned when there's more than one
// declaration (an overload group, or a declaration-merging collision), so the ordinary
// single-declaration case costs no extra `resolve()` call; when none of several declarations has
// a body (a pure interface/ambient signature), falls back to the original choice unchanged.
export function resolveDeclarationNode(symbol: TsSymbol): Node | undefined {
	const declarations = symbol.declarations;
	if (declarations.length > 1) {
		for (const handle of declarations) {
			const node = handle.resolve();
			if (node && hasBody(node)) return node;
		}
	}
	const handle = symbol.valueDeclaration ?? declarations[0];
	return handle?.resolve();
}
