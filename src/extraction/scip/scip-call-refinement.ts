import type { ExtractedSymbols, RawCall, RawCallCandidate } from "src/core/types";
import { dedupeAndSortCandidates } from "src/extraction/raw-extraction";
import type { ScipDocument, ScipOccurrence } from "src/extraction/scip/scip-index";
import { lastDescriptor, parseScipSymbol } from "src/extraction/scip/scip-symbol";

// documentation/adr/0056 decision 3: replaces tree-sitter's candidate list at each call site the
// index has an occurrence for. A call site carries lines only, no columns, so an occurrence
// matches a call when it sits inside the call's lines and names the same callee.

export interface ScipDefinitionSite {
	filePath: string; // absolute, the same keying as `ExtractedSymbols.filePath` before rewriting
	line: number; // 1-based, comparable to `RawSymbol.startLine`
	name: string;
	// The defining file changed since indexing, so `line` may no longer point at the Symbol.
	stale: boolean;
}

// Every in-repo symbol the index defines, by SCIP symbol string. A symbol with no definition
// here lives outside the repo (stdlib, a dependency).
export type ScipDefinitions = ReadonlyMap<string, ScipDefinitionSite>;

export function buildDefinitionIndex(
	documentsByFile: ReadonlyMap<string, ScipDocument>,
	staleFiles: ReadonlySet<string> = new Set(),
): ScipDefinitions {
	const definitions = new Map<string, ScipDefinitionSite>();
	for (const [filePath, document] of documentsByFile) {
		for (const occurrence of document.occurrences) {
			if (!occurrence.isDefinition || definitions.has(occurrence.symbol)) continue;
			const descriptor = lastDescriptor(parseScipSymbol(occurrence.symbol));
			if (!descriptor) continue;
			definitions.set(occurrence.symbol, {
				filePath,
				line: occurrence.startLine + 1,
				name: descriptor.name,
				stale: staleFiles.has(filePath),
			});
		}
	}
	return definitions;
}

// Every candidate of one call shares the callee's name: tree-sitter gathers them by that name.
function calleeNameOf(call: RawCall, symbolsByFile: ReadonlyMap<string, ExtractedSymbols>): string | undefined {
	const [first] = call.candidates;
	if (!first) return undefined;
	return symbolsByFile.get(first.filePath)?.symbols.find((symbol) => symbol.localId === first.localId)?.name;
}

function occurrencesForCall(call: RawCall, calleeName: string, document: ScipDocument): ScipOccurrence[] {
	return document.occurrences.filter((occurrence) => {
		if (occurrence.isDefinition) return false;
		const line = occurrence.startLine + 1;
		const insideCall = call.locations.some((location) => line >= location.startLine && line <= location.endLine);
		return insideCall && lastDescriptor(parseScipSymbol(occurrence.symbol))?.name === calleeName;
	});
}

function candidateFor(
	occurrence: ScipOccurrence,
	definitions: ScipDefinitions,
	symbolsByFile: ReadonlyMap<string, ExtractedSymbols>,
): RawCallCandidate | undefined {
	const definition = definitions.get(occurrence.symbol);
	if (!definition) return undefined;
	const symbol = symbolsByFile
		.get(definition.filePath)
		?.symbols.find((candidate) => candidate.startLine === definition.line && candidate.name === definition.name);
	return symbol ? { filePath: definition.filePath, localId: symbol.localId } : undefined;
}

// A call with matching occurrences keeps only the Symbols the index resolves them to. When none
// of them is a Symbol in this map (a stdlib call, a nested function), the call is dropped: the
// index has shown tree-sitter's same-name guesses were wrong. A call with no matching occurrence,
// or one whose target is defined in a stale file, keeps tree-sitter's candidates unchanged.
export function refineCalls(
	file: ExtractedSymbols,
	document: ScipDocument,
	definitions: ScipDefinitions,
	symbolsByFile: ReadonlyMap<string, ExtractedSymbols>,
): RawCall[] {
	return file.calls.flatMap((call): RawCall[] => {
		const calleeName = calleeNameOf(call, symbolsByFile);
		if (calleeName === undefined) return [call];

		const occurrences = occurrencesForCall(call, calleeName, document);
		const targetIsStale = occurrences.some((occurrence) => definitions.get(occurrence.symbol)?.stale);
		if (occurrences.length === 0 || targetIsStale) return [call];

		const candidates = occurrences.flatMap((occurrence) => {
			const candidate = candidateFor(occurrence, definitions, symbolsByFile);
			return candidate ? [candidate] : [];
		});
		return candidates.length === 0 ? [] : [{ ...call, candidates: dedupeAndSortCandidates(candidates) }];
	});
}
