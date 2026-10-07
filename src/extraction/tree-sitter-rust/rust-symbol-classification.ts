import type { SymbolKind } from "src/core/types";
import type { DeclaredItem } from "src/extraction/tree-sitter-common/raw-symbols";
import type Parser from "tree-sitter";

function isExported(declaration: Parser.SyntaxNode): boolean {
	return declaration.namedChildren[0]?.type === "visibility_modifier";
}

function attributeName(attribute: Parser.SyntaxNode): string | undefined {
	return attribute.namedChild(0)?.type === "attribute" ? attribute.namedChild(0)?.namedChild(0)?.text : undefined;
}

function attributeArgsText(attribute: Parser.SyntaxNode): string {
	return attribute.namedChild(0)?.namedChild(1)?.text ?? "";
}

// `#[test]` (a test function) or `#[cfg(test)]` (conventionally an inline test module, but
// checked generically here) directly preceding `declaration` - walks every immediately-preceding
// `attribute_item` sibling, since attributes stack (`#[allow(dead_code)] #[test] fn f() {}`).
export function hasOwnTestAttribute(declaration: Parser.SyntaxNode): boolean {
	let sibling = declaration.previousNamedSibling;
	while (sibling?.type === "attribute_item") {
		const name = attributeName(sibling);
		if (name === "test") return true;
		if (name === "cfg" && /\btest\b/.test(attributeArgsText(sibling))) {
			return true;
		}
		sibling = sibling.previousNamedSibling;
	}
	return false;
}

function declaredFromImpl(implItem: Parser.SyntaxNode, isTestItem: boolean): DeclaredItem[] {
	const body = implItem.childForFieldName("body");
	if (!body) return [];
	return body.namedChildren.flatMap((member): DeclaredItem[] => {
		if (member?.type !== "function_item") return [];
		const nameNode = member.childForFieldName("name");
		if (!nameNode) return [];
		return [
			{
				name: nameNode.text,
				symbolKind: "method",
				node: member,
				exported: isExported(member),
				isTestItem: isTestItem || hasOwnTestAttribute(member),
			},
		];
	});
}

function declaredFromNamedItem(
	declaration: Parser.SyntaxNode,
	symbolKind: SymbolKind,
	isTestItem: boolean,
): DeclaredItem[] {
	const nameNode = declaration.childForFieldName("name");
	if (!nameNode) return [];
	return [
		{
			name: nameNode.text,
			symbolKind,
			node: declaration,
			exported: isExported(declaration),
			isTestItem: isTestItem || hasOwnTestAttribute(declaration),
		},
	];
}

// Recurses into every module body (`mod foo { ... }`), not just the file's own immediate
// children: a Rust file can nest arbitrarily many inline modules, and none of that nesting is
// "inside a function/method body" - the one boundary
// the spec actually draws. `insideTestModule` (true once
// an ancestor `#[cfg(test)]` module is entered) marks every item found beneath it as a test item,
// regardless of whether that specific item also carries its own `#[test]`/`#[cfg(test)]`.
function declaredFromContainer(container: Parser.SyntaxNode, insideTestModule: boolean): DeclaredItem[] {
	return container.namedChildren.flatMap((declaration): DeclaredItem[] => {
		if (!declaration) return [];
		const isTestItem = insideTestModule || hasOwnTestAttribute(declaration);

		switch (declaration.type) {
			case "function_item":
				return declaredFromNamedItem(declaration, "function", insideTestModule);
			case "struct_item":
				return declaredFromNamedItem(declaration, "type", insideTestModule);
			case "enum_item":
				return declaredFromNamedItem(declaration, "enum", insideTestModule);
			case "trait_item":
				return declaredFromNamedItem(declaration, "interface", insideTestModule);
			case "const_item":
			case "static_item":
				return declaredFromNamedItem(declaration, "const", insideTestModule);
			case "impl_item":
				return declaredFromImpl(declaration, insideTestModule);
			case "mod_item": {
				const body = declaration.childForFieldName("body");
				return body ? declaredFromContainer(body, isTestItem) : [];
			}
			default:
				return [];
		}
	});
}

export function collectDeclaredSymbols(sourceFile: Parser.SyntaxNode): DeclaredItem[] {
	return declaredFromContainer(sourceFile, false);
}
