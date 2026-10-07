import type { RawCall, RawCallCandidate, RawSymbol } from "src/core/types";
import { dedupeAndSortCandidates } from "src/extraction/raw-extraction";
import { locationOf, propertyNameText } from "src/extraction/ts-compiler-api/ast-utils";
import { resolveDeclarationNode, resolveReferencedSymbol } from "src/extraction/ts-compiler-api/checker-utils";
import type {
	ExtractionContext,
	FileSymbolTable,
	NominalIndex,
	TableCache,
} from "src/extraction/ts-compiler-api/extraction-context";
import { isUnderNodeModules } from "src/extraction/ts-compiler-api/node-modules-path";
import { nominalCandidatesFor } from "src/extraction/ts-compiler-api/nominal-dispatch";
import { collectDeclaredSymbols, toRawSymbols } from "src/extraction/ts-compiler-api/symbol-classification";
import {
	type CallExpression,
	type Expression,
	isCallExpression,
	isClassDeclaration,
	isIdentifier,
	isInterfaceDeclaration,
	isMethodDeclaration,
	isMethodSignatureDeclaration,
	isPropertyAccessExpression,
	isPropertyAssignment,
	ModifierFlags,
	type Node,
	type PropertyName,
	type SourceFile,
} from "typescript/unstable/ast";
import type { Checker } from "typescript/unstable/sync";

function buildFileSymbolTable(sourceFile: SourceFile): FileSymbolTable {
	const declared = collectDeclaredSymbols(sourceFile);
	const rawSymbols = toRawSymbols(sourceFile, declared);
	const bySymbolNode = new Map<Node, RawSymbol>();
	declared.forEach(({ node }, index) => {
		const raw = rawSymbols[index];
		if (raw) bySymbolNode.set(node, raw);
	});
	return { filePath: sourceFile.fileName, rawSymbols, bySymbolNode };
}

export function getFileSymbolTable(sourceFile: SourceFile, tableCache: TableCache): FileSymbolTable {
	const cached = tableCache.get(sourceFile.fileName);
	if (cached) return cached;
	const table = buildFileSymbolTable(sourceFile);
	tableCache.set(sourceFile.fileName, table);
	return table;
}

// A call site's target declaration only ever becomes a `RawCallCandidate` when it lands on one
// of the target file's own already-classified Symbols - never a parameter, local variable, or
// any other declaration symbol classification wouldn't itself extract (the ticket's "no
// traceable declaration -> drop" rule, applied uniformly on the callee side too).
function toCandidate(declaration: Node, context: ExtractionContext): RawCallCandidate | undefined {
	const sourceFile = declaration.getSourceFile();
	// A candidate declared in a skipped file (ticket 13) has no traceable Symbol of its own -
	// that file contributes no Symbols at all - so it's dropped under the same "no traceable
	// declaration -> drop" rule ticket 12 already applies to every other unresolvable callee.
	if (context.skippedFiles.has(sourceFile.fileName)) return undefined;
	// A global (`setTimeout`, `Array.prototype.map`, ...) resolves to one of TypeScript's own
	// bundled `lib.*.d.ts` files, or a `@types/*` package's ambient declarations - both reached via
	// `node_modules` (the *tool's own* installed TypeScript, for a bundled lib file, not the
	// analysed repo's) exactly like an external package import is, per `isUnderNodeModules`'s own
	// "no first-party file at this path" meaning there. Dropped rather than turned into a `file`
	// candidate: unlike an import, a call has no External-target shape to fall back to (`RawCallCandidate`
	// is always file+localId), and pointing a candidate at a path outside the analysed repo would
	// leak whichever machine/install happens to be running this tool into the emitted graph.
	if (isUnderNodeModules(sourceFile.fileName)) return undefined;
	const table = getFileSymbolTable(sourceFile, context.tableCache);
	const raw = table.bySymbolNode.get(declaration);
	return raw ? { filePath: table.filePath, localId: raw.localId } : undefined;
}

// One entry per module-top-level function/const-function or direct class-member method (the
// same scope any of its own nested calls attribute to), matching a single, one-pass recursive
// walk against `bySymbolNode`'s declaration nodes rather than walking each Symbol's subtree
// separately - a class's own node and its methods' nodes nest, and a single walk naturally
// re-scopes at each boundary instead of double-attributing a method's calls to its class too.
interface CollectedCallSite {
	callerLocalId: string;
	callExpression: CallExpression;
}

function collectCallSites(sourceFile: SourceFile, bySymbolNode: Map<Node, RawSymbol>): CollectedCallSite[] {
	const sites: CollectedCallSite[] = [];
	const scopeStack: RawSymbol[] = [];

	function visit(node: Node): void {
		const scopeSymbol = bySymbolNode.get(node);
		if (scopeSymbol) scopeStack.push(scopeSymbol);

		if (isCallExpression(node)) {
			const innermost = scopeStack.at(-1);
			// A call with no enclosing Symbol (module-top-level code outside any declared Symbol) is
			// never extracted - the ticket's rule, applied here rather than left to GraphBuilder.
			if (innermost) {
				sites.push({ callerLocalId: innermost.localId, callExpression: node });
			}
		}

		node.forEachChild(visit);

		if (scopeSymbol) scopeStack.pop();
	}

	sourceFile.forEachChild(visit);
	return sites;
}

function calleeLocationOf(callee: Expression): Node {
	return isPropertyAccessExpression(callee) ? callee.name : callee;
}

// `{ counter: counterReducer } as const` (a reducer/route/handler map, a common object-as-registry
// idiom) makes `reducers.counter` resolve its own symbol to that object literal's `counter`
// property - a real declaration, but never one of the file's own classified Symbols, so a call
// through it would otherwise resolve to nothing. When the property's own initialiser is itself a
// bare reference to another declaration (not a new function/class expression of its own), follow
// that one hop to the thing actually being aliased, exactly as `use crate::sub;` bareword aliasing
// already does for Rust module paths.
function followPropertyAlias(checker: Checker, declaration: Node): Node {
	if (!isPropertyAssignment(declaration) || !isIdentifier(declaration.initializer)) {
		return declaration;
	}
	const aliasedSymbol = resolveReferencedSymbol(checker, declaration.initializer);
	const aliasedDeclaration = aliasedSymbol && resolveDeclarationNode(aliasedSymbol);
	return aliasedDeclaration ?? declaration;
}

// Union-typed receivers (`a: Cat | Dog`, both with a `speak()` method) enumerate candidates
// directly from the union's own constituents via `getPropertyOfType` - a distinct, simpler
// mechanism from the nominal-implementor scan in `nominal-dispatch.ts`, since the type itself
// already enumerates its members. Returns `[]` (rather than a single missing-property candidate)
// whenever the receiver isn't a union, so callers can tell "not applicable" apart from "no
// candidates found".
function resolveUnionCandidates(checker: Checker, receiverExpression: Expression, methodName: string): Node[] {
	const receiverType = checker.getTypeAtLocation(receiverExpression);
	if (!receiverType?.isUnionType()) return [];

	return receiverType.getTypes().flatMap((constituent) => {
		const propertySymbol = checker.getPropertyOfType(constituent, methodName);
		const declaration = propertySymbol && resolveDeclarationNode(propertySymbol);
		return declaration ? [declaration] : [];
	});
}

// Shared by both ambiguous-dispatch branches of `resolveCallCandidates` below (interface member
// vs. abstract class method): extract the method name, ask the caller-supplied predicate whether
// `declaration`'s container is itself a genuine dispatch point for that kind (an interface, or an
// abstract class - each guard's own kind check plus whatever else makes it a real one), and either
// resolve nominal candidates under that container's name or fall back to the caller's own default
// for "not actually dispatched nominally after all" (empty for an interface member, the
// declaration itself for an abstract method that isn't reachable through its container).
function resolveContainerDispatchCandidates(
	checker: Checker,
	declaration: { name: PropertyName; parent: Node },
	nominalIndex: NominalIndex,
	containerNameIfDispatchPoint: (container: Node) => Node | undefined,
	fallback: Node[],
): Node[] {
	const methodName = propertyNameText(declaration.name);
	if (methodName === undefined) return fallback;

	const containerName = containerNameIfDispatchPoint(declaration.parent);
	return containerName ? nominalCandidatesFor(checker, containerName, methodName, nominalIndex) : fallback;
}

// A resolved callee lands on an interface member (`MethodSignature`) or an abstract class's own
// abstract method - the two shapes `checker.getSymbolAtLocation` yields back for an ambiguous
// call, since neither carries a body of its own to be "the" answer. Anything else (a concrete
// function/method declaration) is direct resolution: exactly one candidate, the declaration
// itself.
function resolveCallCandidates(checker: Checker, call: CallExpression, nominalIndex: NominalIndex): Node[] {
	const callee = call.expression;

	if (isPropertyAccessExpression(callee) && isIdentifier(callee.name)) {
		const unionCandidates = resolveUnionCandidates(checker, callee.expression, callee.name.text);
		if (unionCandidates.length > 0) return unionCandidates;
	}

	const symbol = resolveReferencedSymbol(checker, calleeLocationOf(callee));
	if (!symbol) return [];
	const resolved = resolveDeclarationNode(symbol);
	if (!resolved) return [];
	const declaration = followPropertyAlias(checker, resolved);

	if (isMethodSignatureDeclaration(declaration)) {
		return resolveContainerDispatchCandidates(
			checker,
			declaration,
			nominalIndex,
			(container) => (isInterfaceDeclaration(container) ? container.name : undefined),
			[],
		);
	}

	if (isMethodDeclaration(declaration) && (declaration.modifierFlags & ModifierFlags.Abstract) !== 0) {
		return resolveContainerDispatchCandidates(
			checker,
			declaration,
			nominalIndex,
			(container) =>
				isClassDeclaration(container) && container.name && (container.modifierFlags & ModifierFlags.Abstract) !== 0
					? container.name
					: undefined,
			[declaration],
		);
	}

	return [declaration];
}

// `Parser` emits candidates sorted by each candidate's eventual Symbol id (lexicographic) -
// immaterial to final output (the `Transformer`'s graph-wide edge sort supersedes it), but gives
// free determinism for `Parser`'s own intermediate state (ticket 12's own repeatability concern).
export function toRawCalls(
	sourceFile: SourceFile,
	bySymbolNode: Map<Node, RawSymbol>,
	checker: Checker,
	context: ExtractionContext,
): RawCall[] {
	return collectCallSites(sourceFile, bySymbolNode).flatMap(({ callerLocalId, callExpression }): RawCall[] => {
		const declarations = [...new Set(resolveCallCandidates(checker, callExpression, context.nominalIndex))];
		const candidates = dedupeAndSortCandidates(
			declarations
				.map((declaration) => toCandidate(declaration, context))
				.filter((candidate): candidate is RawCallCandidate => !!candidate),
		);

		if (candidates.length === 0) return [];

		return [
			{
				callerLocalId,
				candidates,
				locations: [locationOf(sourceFile, callExpression)],
			},
		];
	});
}
