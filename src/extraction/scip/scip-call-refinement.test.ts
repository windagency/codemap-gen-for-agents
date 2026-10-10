import type { ExtractedSymbols, RawCall, RawSymbol } from "src/core/types";
import { buildDefinitionIndex, refineCalls } from "src/extraction/scip/scip-call-refinement";
import type { ScipDocument, ScipOccurrence } from "src/extraction/scip/scip-index";
import { describe, expect, it } from "vitest";

const SERVICE = "/repo/app/service.py";
const STORAGE = "/repo/app/storage.py";
const LEGACY = "/repo/app/legacy.py";

const STORAGE_LOAD = "scip-python python p 1 `app.storage`/load().";
const LEGACY_LOAD = "scip-python python p 1 `app.legacy`/load().";
const FILE_STORE_SAVE = "scip-python python p 1 `app.storage`/FileStore#save().";
const MEMORY_STORE_SAVE = "scip-python python p 1 `app.storage`/MemoryStore#save().";
const NESTED_HELPER = "scip-python python p 1 `app.storage`/load().helper().";
const JSON_DUMPS = "scip-python python python-stdlib 3.11 json/dumps().";

function symbol(localId: string, name: string, symbolKind: RawSymbol["symbolKind"], line: number): RawSymbol {
	return { localId, name, symbolKind, startLine: line, endLine: line + 1, exported: true };
}

function extracted(filePath: string, symbols: RawSymbol[], calls: RawCall[] = []): ExtractedSymbols {
	return { filePath, symbols, imports: [], calls };
}

function occurrence(symbolName: string, line: number, isDefinition: boolean): ScipOccurrence {
	return { symbol: symbolName, startLine: line, startCharacter: 0, endLine: line, endCharacter: 1, isDefinition };
}

function documentOf(relativePath: string, occurrences: ScipOccurrence[]): ScipDocument {
	return { relativePath, language: "", text: undefined, positionEncoding: "utf16", occurrences };
}

// 1-based lines in the RawSymbols; SCIP's are 0-based.
const storage = extracted(STORAGE, [
	symbol("save", "save", "method", 2),
	symbol("save#2", "save", "method", 7),
	symbol("load", "load", "function", 11),
]);
const legacy = extracted(LEGACY, [
	symbol("load", "load", "function", 1),
	symbol("dumps", "dumps", "method", 6),
	symbol("helper", "helper", "function", 9),
]);

const storageDocument = documentOf("app/storage.py", [
	occurrence(FILE_STORE_SAVE, 1, true),
	occurrence(MEMORY_STORE_SAVE, 6, true),
	occurrence(STORAGE_LOAD, 10, true),
	occurrence(NESTED_HELPER, 11, true),
]);
const legacyDocument = documentOf("app/legacy.py", [occurrence(LEGACY_LOAD, 0, true)]);

function call(line: number, candidates: { filePath: string; localId: string }[]): RawCall {
	return { callerLocalId: "run", candidates, locations: [{ startLine: line, endLine: line }] };
}

function refine(serviceCalls: RawCall[], serviceOccurrences: ScipOccurrence[]): RawCall[] {
	const service = extracted(SERVICE, [symbol("run", "run", "function", 6)], serviceCalls);
	const serviceDocument = documentOf("app/service.py", serviceOccurrences);
	const documents = new Map([
		[SERVICE, serviceDocument],
		[STORAGE, storageDocument],
		[LEGACY, legacyDocument],
	]);
	const symbolsByFile = new Map([
		[SERVICE, service],
		[STORAGE, storage],
		[LEGACY, legacy],
	]);
	return refineCalls(service, serviceDocument, buildDefinitionIndex(documents), symbolsByFile);
}

describe("refineCalls", () => {
	it("narrows an ambiguous unqualified call to the index's one target", () => {
		const calls = refine(
			[
				call(8, [
					{ filePath: LEGACY, localId: "load" },
					{ filePath: STORAGE, localId: "load" },
				]),
			],
			[occurrence(STORAGE_LOAD, 7, false)],
		);

		expect(calls).toStrictEqual([call(8, [{ filePath: STORAGE, localId: "load" }])]);
	});

	it("narrows a method call on an instance to the receiver's own class", () => {
		const calls = refine(
			[
				call(8, [
					{ filePath: STORAGE, localId: "save" },
					{ filePath: STORAGE, localId: "save#2" },
				]),
			],
			[occurrence(FILE_STORE_SAVE, 7, false)],
		);

		expect(calls).toStrictEqual([call(8, [{ filePath: STORAGE, localId: "save" }])]);
	});

	it("matches each call on a shared line by its own callee name", () => {
		const calls = refine(
			[
				call(8, [
					{ filePath: STORAGE, localId: "save" },
					{ filePath: STORAGE, localId: "save#2" },
				]),
				call(8, [
					{ filePath: LEGACY, localId: "load" },
					{ filePath: STORAGE, localId: "load" },
				]),
			],
			[occurrence(FILE_STORE_SAVE, 7, false), occurrence(STORAGE_LOAD, 7, false)],
		);

		expect(calls).toStrictEqual([
			call(8, [{ filePath: STORAGE, localId: "save" }]),
			call(8, [{ filePath: STORAGE, localId: "load" }]),
		]);
	});

	it("drops a call the index resolves outside the repo", () => {
		const calls = refine([call(9, [{ filePath: LEGACY, localId: "dumps" }])], [occurrence(JSON_DUMPS, 8, false)]);

		expect(calls).toStrictEqual([]);
	});

	it("drops a call whose index target is not a Symbol in the map", () => {
		const calls = refine([call(9, [{ filePath: LEGACY, localId: "helper" }])], [occurrence(NESTED_HELPER, 8, false)]);

		expect(calls).toStrictEqual([]);
	});

	it("keeps tree-sitter's candidates where the index has no occurrence for the callee", () => {
		const unmatched = call(8, [
			{ filePath: LEGACY, localId: "load" },
			{ filePath: STORAGE, localId: "load" },
		]);

		expect(refine([unmatched], [occurrence(FILE_STORE_SAVE, 7, false)])).toStrictEqual([unmatched]);
		expect(refine([unmatched], [])).toStrictEqual([unmatched]);
	});
});
