import type { SymbolKind } from "src/core/types";
import type { DeclaredItem } from "src/extraction/tree-sitter-common/raw-symbols";
import type Parser from "tree-sitter";

// Python's own visibility convention: a single leading underscore marks a name as
// internal/private (PEP 8); anything else is exported. Dunder names (`__all__`) are covered by
// the same leading-underscore check - they're module machinery, not a public declaration this
// tool should surface as "exported" anyway.
function isExported(name: string): boolean {
	return !name.startsWith("_");
}

// A decorated definition (`@dataclass\nclass Widget:`, `@staticmethod\ndef f():`) wraps its
// `function_definition`/`class_definition` behind one extra node - unwrapped here so every other
// pass only ever deals with the definition itself, the same way `attribute_item`-preceded Rust
// items still resolve to their own `function_item`/`struct_item`.
function unwrapDecorated(node: Parser.SyntaxNode): Parser.SyntaxNode {
	if (node.type !== "decorated_definition") return node;
	return node.childForFieldName("definition") ?? node;
}

// A tuple/multi-target assignment (`x, y = 1, 2`) declares every name on its left-hand side -
// mirrors Go's `const A, B = 1, 2` multi-name handling.
function declaredNamesFromTarget(target: Parser.SyntaxNode): Parser.SyntaxNode[] {
	if (target.type === "identifier") return [target];
	if (target.type === "pattern_list" || target.type === "tuple_pattern") {
		return target.namedChildren.filter(
			(child): child is Parser.SyntaxNode => child !== null && child.type === "identifier",
		);
	}
	return [];
}

function declaredFromAssignment(statement: Parser.SyntaxNode): DeclaredItem[] {
	const assignment = statement.namedChild(0);
	if (assignment?.type !== "assignment") return [];
	const target = assignment.childForFieldName("left");
	if (!target) return [];
	return declaredNamesFromTarget(target).map((nameNode) => ({
		name: nameNode.text,
		symbolKind: "const",
		node: assignment,
		exported: isExported(nameNode.text),
	}));
}

function declaredFromDef(definition: Parser.SyntaxNode, symbolKind: SymbolKind): DeclaredItem[] {
	const nameNode = definition.childForFieldName("name");
	if (!nameNode) return [];
	return [
		{
			name: nameNode.text,
			symbolKind,
			node: definition,
			exported: isExported(nameNode.text),
		},
	];
}

// Recurses into every class body, not just the module's own immediate children - a class can
// nest arbitrarily deep (a nested class, a class inside a nested class), and `insideClass` is
// what turns a `function_definition` into a "method" Symbol rather than a "function" one. Never
// descends into a function/method's own `block` - a body-local `def`/assignment is never a
// Symbol, same boundary every other language's tree-sitter Parser draws.
function declaredFromClass(classDefinition: Parser.SyntaxNode): DeclaredItem[] {
	const body = classDefinition.childForFieldName("body");
	return [...declaredFromDef(classDefinition, "class"), ...(body ? declaredFromContainer(body, true) : [])];
}

function declaredFromChild(child: Parser.SyntaxNode | null, insideClass: boolean): DeclaredItem[] {
	if (!child) return [];
	const declaration = unwrapDecorated(child);
	switch (declaration.type) {
		case "function_definition":
			return declaredFromDef(declaration, insideClass ? "method" : "function");
		case "class_definition":
			return declaredFromClass(declaration);
		case "expression_statement":
			// Module-level assignments only - a class body's own assignments are attributes, never
			// Symbols, the same "never struct fields" boundary Go/Rust draw for their own containers.
			return insideClass ? [] : declaredFromAssignment(declaration);
		default:
			return [];
	}
}

function declaredFromContainer(container: Parser.SyntaxNode, insideClass: boolean): DeclaredItem[] {
	return container.namedChildren.flatMap((child) => declaredFromChild(child, insideClass));
}

export function collectDeclaredSymbols(sourceFile: Parser.SyntaxNode): DeclaredItem[] {
	return declaredFromContainer(sourceFile, false);
}
