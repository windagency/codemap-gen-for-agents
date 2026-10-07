import type { EdgeLocation } from "src/core/types";
import {
	isIdentifier,
	isPrivateIdentifier,
	ModifierFlags,
	type Node,
	type PropertyName,
	type SourceFile,
} from "typescript/unstable/ast";

// Pure-syntax helpers shared across every extraction concern in this directory (symbol
// classification, import resolution, call resolution, nominal dispatch) - none of them need a
// `Checker`/`Program`.

export function locationOf(sourceFile: SourceFile, node: Node): EdgeLocation {
	// The compiler API's line/character pairs are 0-based; the schema's lines are 1-based.
	const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
	return { startLine: start.line + 1, endLine: end.line + 1 };
}

export function isExported(node: { modifierFlags: ModifierFlags }): boolean {
	return (node.modifierFlags & ModifierFlags.Export) !== 0;
}

export function propertyNameText(name: PropertyName): string | undefined {
	return isIdentifier(name) || isPrivateIdentifier(name) ? name.text : undefined;
}
