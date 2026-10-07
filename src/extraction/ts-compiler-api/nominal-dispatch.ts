import { propertyNameText } from "src/extraction/ts-compiler-api/ast-utils";
import { resolveDeclarationNode, resolveReferencedSymbol } from "src/extraction/ts-compiler-api/checker-utils";
import type { NominalIndex } from "src/extraction/ts-compiler-api/extraction-context";
import {
	type ClassDeclaration,
	type HeritageClause,
	isClassDeclaration,
	isInterfaceDeclaration,
	isMethodDeclaration,
	ModifierFlags,
	type Node,
	type SourceFile,
} from "typescript/unstable/ast";
import type { Checker, Program, Project, Symbol as TsSymbol } from "typescript/unstable/sync";

function heritageClausesOf(node: Node): readonly HeritageClause[] {
	if (isClassDeclaration(node) || isInterfaceDeclaration(node)) {
		return node.heritageClauses ?? [];
	}
	return [];
}

function heritageTargetSymbols(node: Node, checker: Checker): TsSymbol[] {
	return heritageClausesOf(node).flatMap((clause) =>
		clause.types.flatMap((type) => {
			const symbol = resolveReferencedSymbol(checker, type.expression);
			return symbol ? [symbol] : [];
		}),
	);
}

// Nominal dispatch is restricted to interface declarations and *abstract* class declarations -
// a heritage target resolving to a concrete class needs no enumeration at all, since a
// concrete-typed receiver's call already resolves directly to that class's own declaration
// (`checker.getSymbolAtLocation`), overrides notwithstanding (out of scope per the spec).
function isDispatchPoint(symbol: TsSymbol): boolean {
	const declaration = resolveDeclarationNode(symbol);
	if (!declaration) return false;
	if (isInterfaceDeclaration(declaration)) return true;
	return isClassDeclaration(declaration) && (declaration.modifierFlags & ModifierFlags.Abstract) !== 0;
}

// Transitive closure of a dispatch point's own ancestor dispatch points (an interface extending
// another interface, or an abstract class implementing an interface) - so a class implementing
// only the most-derived interface/abstract class still registers under every ancestor a call
// might have resolved its callee against. `visited` is shared across one class's own immediate
// heritage targets (scoped per class-statement by the caller), so a diamond within that one
// class's heritage - two targets sharing a common further ancestor - walks that ancestor once.
function dispatchAncestorClosure(symbol: TsSymbol, checker: Checker, visited: Set<number>): TsSymbol[] {
	if (visited.has(symbol.id)) return [];
	visited.add(symbol.id);

	const declaration = resolveDeclarationNode(symbol);
	if (!declaration) return [symbol];

	const parents = heritageTargetSymbols(declaration, checker).filter(isDispatchPoint);
	return [symbol, ...parents.flatMap((parent) => dispatchAncestorClosure(parent, checker, visited))];
}

function addImplementor(index: NominalIndex, symbolId: number, methodName: string, node: Node): void {
	let byName = index.get(symbolId);
	if (!byName) {
		byName = new Map();
		index.set(symbolId, byName);
	}
	const implementors = byName.get(methodName);
	if (implementors) implementors.push(node);
	else byName.set(methodName, [node]);
}

// Every interface/abstract-class Symbol a class ultimately implements or extends, through any
// number of intermediate dispatch points.
function dispatchAncestorIds(classDeclaration: ClassDeclaration, checker: Checker): Set<number> {
	const visited = new Set<number>();
	const targets = heritageTargetSymbols(classDeclaration, checker).filter(isDispatchPoint);
	return new Set(
		targets.flatMap((target) => dispatchAncestorClosure(target, checker, visited).map((ancestor) => ancestor.id)),
	);
}

// Only a *concrete* method counts as an implementor - a class's own bodiless abstract
// re-declaration of the same method is itself just another dispatch point, not an answer.
function concreteMethodNames(classDeclaration: ClassDeclaration): [string, Node][] {
	return classDeclaration.members.flatMap((member): [string, Node][] => {
		if (!isMethodDeclaration(member) || (member.modifierFlags & ModifierFlags.Abstract) !== 0) {
			return [];
		}
		const methodName = propertyNameText(member.name);
		return methodName === undefined ? [] : [[methodName, member]];
	});
}

function isRepoSourceFile(program: Program, sourceFile: SourceFile): boolean {
	return !program.isSourceFileFromExternalLibrary(sourceFile) && !program.isSourceFileDefaultLibrary(sourceFile);
}

function indexClass(index: NominalIndex, classDeclaration: ClassDeclaration, checker: Checker): void {
	const ancestorIds = dispatchAncestorIds(classDeclaration, checker);
	if (ancestorIds.size === 0) return;
	for (const [methodName, member] of concreteMethodNames(classDeclaration)) {
		for (const ancestorId of ancestorIds) {
			addImplementor(index, ancestorId, methodName, member);
		}
	}
}

// Whole-program (never per-file), scoped to `rootProject` alone: with no root tsconfig (a plain-JS
// repo falling back to a per-file inferred project per `TsCompilerApiParser.parse`), there's no
// single program to index across, so ambiguous dispatch simply resolves no candidates in that
// fallback path - an accepted, documented limitation; see documentation/adr/0023 for why this isn't fixed
// here.
export function buildNominalIndex(rootProject: Project | undefined): NominalIndex {
	const index: NominalIndex = new Map();
	if (!rootProject) return index;

	const { program, checker } = rootProject;
	const sourceFiles = program
		.getSourceFileNames()
		.flatMap((fileName) => program.getSourceFile(fileName) ?? [])
		.filter((sourceFile) => isRepoSourceFile(program, sourceFile));

	for (const sourceFile of sourceFiles) {
		for (const statement of sourceFile.statements) {
			if (isClassDeclaration(statement)) indexClass(index, statement, checker);
		}
	}
	return index;
}

// Shared final step once a declaration's container has already passed its own kind-specific
// dispatch-point guard (interface vs. abstract class, checked by each caller in call resolution):
// resolve the container's own Symbol and read the nominal index's implementors for `methodName`
// under it.
export function nominalCandidatesFor(
	checker: Checker,
	containerName: Node,
	methodName: string,
	nominalIndex: NominalIndex,
): Node[] {
	const containerSymbol = checker.getSymbolAtLocation(containerName);
	return containerSymbol ? (nominalIndex.get(containerSymbol.id)?.get(methodName) ?? []) : [];
}
