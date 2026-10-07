import type { RawSymbol, SymbolKind } from "src/core/types";
import { withLocalIds } from "src/extraction/raw-extraction";
import { isExported, locationOf, propertyNameText } from "src/extraction/ts-compiler-api/ast-utils";
import {
	type ClassDeclaration,
	isArrowFunction,
	isClassDeclaration,
	isEnumDeclaration,
	isFunctionDeclaration,
	isFunctionExpression,
	isIdentifier,
	isInterfaceDeclaration,
	isMethodDeclaration,
	isTypeAliasDeclaration,
	isVariableStatement,
	type ModifierFlags,
	type Node,
	NodeFlags,
	type SourceFile,
	type Statement,
	type VariableStatement,
} from "typescript/unstable/ast";

const ANONYMOUS_DEFAULT_EXPORT_NAME = "default";

export interface DeclaredSymbol {
	name: string;
	symbolKind: SymbolKind;
	node: Node;
	exported: boolean;
}

// interface/type/enum declarations share one shape: a required name, a fixed symbolKind, and
// exported-ness read straight off the declaration's own modifiers.
function declaredFromNamedDeclaration(
	node: (Node & { modifierFlags: ModifierFlags }) & { name: { text: string } },
	symbolKind: SymbolKind,
): DeclaredSymbol {
	return { name: node.name.text, symbolKind, node, exported: isExported(node) };
}

function declaredFromClass(statement: ClassDeclaration): DeclaredSymbol[] {
	const exported = isExported(statement);
	const classSymbol: DeclaredSymbol = {
		name: statement.name?.text ?? ANONYMOUS_DEFAULT_EXPORT_NAME,
		symbolKind: "class",
		node: statement,
		exported,
	};

	// Only direct class-member methods become Symbols - never accessors, properties, or a
	// computed/numeric member name with no static name to key on.
	const methods = statement.members.flatMap((member): DeclaredSymbol[] => {
		if (!isMethodDeclaration(member)) return [];
		const name = propertyNameText(member.name);
		if (name === undefined) return [];
		return [{ name, symbolKind: "method", node: member, exported }];
	});

	return [classSymbol, ...methods];
}

function declaredFromVariableStatement(statement: VariableStatement): DeclaredSymbol[] {
	const isConst = (statement.declarationList.flags & NodeFlags.Const) !== 0;
	if (!isConst) return []; // let/var bindings are never extracted as Symbols

	return statement.declarationList.declarations.flatMap((declaration): DeclaredSymbol[] => {
		if (!isIdentifier(declaration.name)) return []; // destructuring patterns: no single name to key on

		const { initializer } = declaration;
		const symbolKind: SymbolKind =
			initializer && (isArrowFunction(initializer) || isFunctionExpression(initializer))
				? "function" // reflects the value's shape, not the `const` binding keyword
				: "const";

		return [
			{
				name: declaration.name.text,
				symbolKind,
				node: declaration,
				exported: isExported(statement),
			},
		];
	});
}

function declaredFromStatement(statement: Statement): DeclaredSymbol[] {
	if (isFunctionDeclaration(statement)) {
		return [
			{
				name: statement.name?.text ?? ANONYMOUS_DEFAULT_EXPORT_NAME,
				symbolKind: "function",
				node: statement,
				exported: isExported(statement),
			},
		];
	}
	if (isClassDeclaration(statement)) return declaredFromClass(statement);
	if (isInterfaceDeclaration(statement)) {
		return [declaredFromNamedDeclaration(statement, "interface")];
	}
	if (isTypeAliasDeclaration(statement)) {
		return [declaredFromNamedDeclaration(statement, "type")];
	}
	if (isEnumDeclaration(statement)) {
		return [declaredFromNamedDeclaration(statement, "enum")];
	}
	if (isVariableStatement(statement)) {
		return declaredFromVariableStatement(statement);
	}
	return [];
}

// Only module-top-level declarations and direct class-member methods become Symbols - never
// function-body-local declarations - per the extraction-algorithm map's nesting-depth decision.
export function collectDeclaredSymbols(sourceFile: SourceFile): DeclaredSymbol[] {
	return sourceFile.statements.flatMap(declaredFromStatement);
}

// Overload signatures and declaration-merging collisions (a same-named `interface Foo` and
// `function Foo`) are numbered by the shared `withLocalIds` rule; `collectDeclaredSymbols`
// already walks in source order.
export function toRawSymbols(sourceFile: SourceFile, declared: DeclaredSymbol[]): RawSymbol[] {
	return withLocalIds(declared).map(({ localId, name, symbolKind, node, exported }) => ({
		localId,
		name,
		symbolKind,
		exported,
		...locationOf(sourceFile, node),
	}));
}
