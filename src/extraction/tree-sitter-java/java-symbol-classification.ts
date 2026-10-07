import type { SymbolKind } from "src/core/types";
import type { DeclaredItem } from "src/extraction/tree-sitter-common/raw-symbols";
import type Parser from "tree-sitter";

// `public` is Java's closest analogue to the other languages' `exported: boolean` - the "part of
// this type's public interface" bit, as opposed to `protected`/package-private/`private`.
function isPublic(declaration: Parser.SyntaxNode): boolean {
	const modifiers = declaration.namedChildren.find((child) => child?.type === "modifiers");
	return modifiers ? /\bpublic\b/.test(modifiers.text) : false;
}

// Only a class/interface/enum's own direct members become method Symbols - never a field,
// accessor, or a nested type's own methods.
function declaredMethods(body: Parser.SyntaxNode): DeclaredItem[] {
	return body.namedChildren.flatMap((member): DeclaredItem[] => {
		if (!member || (member.type !== "method_declaration" && member.type !== "constructor_declaration")) {
			return [];
		}
		const nameNode = member.childForFieldName("name");
		if (!nameNode) return [];
		return [
			{
				name: nameNode.text,
				symbolKind: "method",
				node: member,
				exported: isPublic(member),
			},
		];
	});
}

function declaredFromType(declaration: Parser.SyntaxNode, symbolKind: SymbolKind): DeclaredItem[] {
	const nameNode = declaration.childForFieldName("name");
	if (!nameNode) return [];
	const body = declaration.childForFieldName("body");
	return [
		{
			name: nameNode.text,
			symbolKind,
			node: declaration,
			exported: isPublic(declaration),
		},
		...(body ? declaredMethods(body) : []),
	];
}

// Only top-level (file-scope) class/interface/enum declarations and their own direct
// methods/constructors become Symbols - a nested type declared inside another type's body is out
// of scope (this slice's syntactic-fidelity bar), matching the same "no premature depth" choice
// Rust's inline-module recursion deliberately doesn't extend to.
export function collectDeclaredSymbols(sourceFile: Parser.SyntaxNode): DeclaredItem[] {
	return sourceFile.namedChildren.flatMap((declaration): DeclaredItem[] => {
		if (!declaration) return [];
		switch (declaration.type) {
			case "class_declaration":
				return declaredFromType(declaration, "class");
			case "interface_declaration":
				return declaredFromType(declaration, "interface");
			case "enum_declaration":
				return declaredFromType(declaration, "enum");
			default:
				return [];
		}
	});
}
