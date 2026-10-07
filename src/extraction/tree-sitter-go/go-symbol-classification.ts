import type { SymbolKind } from "src/core/types";
import type { DeclaredItem } from "src/extraction/tree-sitter-common/raw-symbols";
import type Parser from "tree-sitter";

// Go's own visibility convention: an identifier is exported iff its first rune is an uppercase
// letter (`unicode.IsUpper`) - this checks the common ASCII case only, an accepted syntactic
// simplification consistent with this whole slice's lower (tree-sitter-only) fidelity bar.
function isExported(name: string): boolean {
	return /^[A-Z]/.test(name);
}

// `const`/`var` specs can declare several names on one line (`const A, B = 1, 2`) as sibling
// `identifier` children of the spec node, all sharing field name "name" - `childForFieldName`
// only ever returns the first, so every declared name needs a direct-children scan instead.
function declaredNames(specNode: Parser.SyntaxNode): Parser.SyntaxNode[] {
	return specNode.namedChildren.filter(
		(child): child is Parser.SyntaxNode => child !== null && child.type === "identifier",
	);
}

function declaredFromConstOrVar(declaration: Parser.SyntaxNode, symbolKind: SymbolKind): DeclaredItem[] {
	return declaration.namedChildren.flatMap((spec) => {
		if (!spec || (spec.type !== "const_spec" && spec.type !== "var_spec")) {
			return [];
		}
		return declaredNames(spec).map((nameNode) => ({
			name: nameNode.text,
			symbolKind,
			node: nameNode,
			exported: isExported(nameNode.text),
		}));
	});
}

// `type Foo struct{}` / `type Bar interface{}` (`type_spec`) and `type Baz = string` (a distinct
// `type_alias` node) share the same "name"/"type" field names, so both are handled uniformly here.
function declaredFromTypeDeclaration(declaration: Parser.SyntaxNode): DeclaredItem[] {
	return declaration.namedChildren.flatMap((spec) => {
		if (!spec || (spec.type !== "type_spec" && spec.type !== "type_alias")) {
			return [];
		}
		const nameNode = spec.childForFieldName("name");
		if (!nameNode) return [];
		const typeNode = spec.childForFieldName("type");
		const symbolKind: SymbolKind = typeNode?.type === "interface_type" ? "interface" : "type";
		return [
			{
				name: nameNode.text,
				symbolKind,
				node: spec,
				exported: isExported(nameNode.text),
			},
		];
	});
}

function declaredFromFunctionOrMethod(declaration: Parser.SyntaxNode, symbolKind: SymbolKind): DeclaredItem[] {
	const nameNode = declaration.childForFieldName("name");
	if (!nameNode) return [];
	return [
		{
			name: nameNode.text,
			symbolKind,
			node: declaration,
			exported: isExported(nameNode.text),
		},
	];
}

// Only module-top-level declarations and direct receiver methods become Symbols - never a
// function-body-local declaration, never a struct field.
export function collectDeclaredSymbols(sourceFile: Parser.SyntaxNode): DeclaredItem[] {
	return sourceFile.namedChildren.flatMap((declaration) => {
		if (!declaration) return [];
		switch (declaration.type) {
			case "function_declaration":
				return declaredFromFunctionOrMethod(declaration, "function");
			case "method_declaration":
				return declaredFromFunctionOrMethod(declaration, "method");
			case "type_declaration":
				return declaredFromTypeDeclaration(declaration);
			case "const_declaration":
				return declaredFromConstOrVar(declaration, "const");
			case "var_declaration":
				return declaredFromConstOrVar(declaration, "const");
			default:
				return [];
		}
	});
}
