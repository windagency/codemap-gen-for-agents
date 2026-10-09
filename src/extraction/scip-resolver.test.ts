import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtractedSymbols } from "src/core/types";
import { createScipIndexResolver } from "src/extraction/scip-resolver";
import { GoTreeSitterParser } from "src/extraction/tree-sitter-go/go-parser";
import { PythonTreeSitterParser } from "src/extraction/tree-sitter-python/python-parser";
import { describe, expect, it } from "vitest";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "..", "fixtures");

// A throwaway copy, so a test can edit a file or drop the index without touching the fixture.
function copyFixture(name = "python-scip"): string {
	const copy = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-scip-resolver-"));
	fs.cpSync(path.join(FIXTURES_DIR, name), copy, { recursive: true });
	return fs.realpathSync(copy);
}

function pythonFiles(rootDir: string): string[] {
	return ["__init__.py", "legacy.py", "service.py", "storage.py"].map((name) => path.join(rootDir, "app", name));
}

function extract(rootDir: string): { fresh: ExtractedSymbols[]; symbolsByFile: Map<string, ExtractedSymbols> } {
	const files = pythonFiles(rootDir);
	const fresh = new PythonTreeSitterParser().parse(rootDir, files, files);
	return { fresh, symbolsByFile: new Map(fresh.map((extracted) => [extracted.filePath, extracted])) };
}

function resolveFixture(rootDir: string, indexPath = path.join(rootDir, "index.scip")) {
	const { fresh, symbolsByFile } = extract(rootDir);
	return createScipIndexResolver().resolve([{ language: "python", indexPath }], fresh, symbolsByFile);
}

function serviceOf(symbols: ExtractedSymbols[], rootDir: string): ExtractedSymbols | undefined {
	return symbols.find((extracted) => extracted.filePath === path.join(rootDir, "app", "service.py"));
}

describe("createScipIndexResolver", () => {
	it("narrows the fixture's ambiguous calls and drops the one the index resolves outside the repo", () => {
		const rootDir = copyFixture();
		const storage = path.join(rootDir, "app", "storage.py");

		const before = serviceOf(extract(rootDir).fresh, rootDir)?.calls;
		const { symbols, unreadableIndexes } = resolveFixture(rootDir);

		expect(before?.map((call) => call.candidates.length)).toStrictEqual([2, 2, 1]);
		expect(unreadableIndexes).toStrictEqual([]);
		expect(serviceOf(symbols, rootDir)?.calls).toStrictEqual([
			{
				callerLocalId: "run",
				candidates: [{ filePath: storage, localId: "save" }],
				locations: [{ startLine: 6, endLine: 6 }],
			},
			{
				callerLocalId: "run",
				candidates: [{ filePath: storage, localId: "load" }],
				locations: [{ startLine: 6, endLine: 6 }],
			},
		]);
		expect(symbols.some((extracted) => extracted.indexFallback !== undefined)).toBe(false);
	});

	it("keeps tree-sitter's output for a file edited since indexing, and marks it stale", () => {
		const rootDir = copyFixture();
		const servicePath = path.join(rootDir, "app", "service.py");
		fs.writeFileSync(servicePath, `# edited\n${fs.readFileSync(servicePath, "utf8")}`);

		const { fresh } = extract(rootDir);
		const { symbols } = resolveFixture(rootDir);

		expect(serviceOf(symbols, rootDir)).toStrictEqual({ ...serviceOf(fresh, rootDir), indexFallback: "index-stale" });
	});

	it("keeps tree-sitter's candidates for a call whose target's file went stale", () => {
		const rootDir = copyFixture();
		const storagePath = path.join(rootDir, "app", "storage.py");
		fs.writeFileSync(storagePath, `# edited\n${fs.readFileSync(storagePath, "utf8")}`);

		const { fresh } = extract(rootDir);
		const { symbols } = resolveFixture(rootDir);

		expect(serviceOf(symbols, rootDir)?.calls.slice(0, 2)).toStrictEqual(serviceOf(fresh, rootDir)?.calls.slice(0, 2));
		expect(symbols.find((extracted) => extracted.filePath === storagePath)?.indexFallback).toBe("index-stale");
	});

	it("marks a Python file the index does not cover", () => {
		const rootDir = copyFixture();
		const extraPath = path.join(rootDir, "app", "extra.py");
		fs.writeFileSync(extraPath, "def extra():\n    return 1\n");

		const files = [...pythonFiles(rootDir), extraPath];
		const fresh = new PythonTreeSitterParser().parse(rootDir, files, files);
		const { symbols } = createScipIndexResolver().resolve(
			[{ language: "python", indexPath: path.join(rootDir, "index.scip") }],
			fresh,
			new Map(fresh.map((extracted) => [extracted.filePath, extracted])),
		);

		expect(symbols.find((extracted) => extracted.filePath === extraPath)?.indexFallback).toBe("index-uncovered");
	});

	it("reports an index it cannot read and leaves every file untouched", () => {
		const rootDir = copyFixture();
		const missing = path.join(rootDir, "missing.scip");
		const { fresh } = extract(rootDir);

		const { symbols, unreadableIndexes } = resolveFixture(rootDir, missing);

		expect(symbols).toStrictEqual(fresh);
		expect(unreadableIndexes).toMatchObject([{ indexPath: missing }]);
	});

	it("never touches a file of a language with no index source", () => {
		const tsFile: ExtractedSymbols = { filePath: "/repo/a.ts", symbols: [], imports: [], calls: [] };

		const { symbols } = createScipIndexResolver().resolve([], [tsFile], new Map([[tsFile.filePath, tsFile]]));

		expect(symbols).toStrictEqual([tsFile]);
	});

	it("judges a file by the content hash recorded when the generator indexed it", () => {
		const rootDir = copyFixture();
		const servicePath = path.join(rootDir, "app", "service.py");
		const storagePath = path.join(rootDir, "app", "storage.py");
		fs.writeFileSync(servicePath, `# edited\n${fs.readFileSync(servicePath, "utf8")}`);
		const sha256 = (filePath: string) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
		const { fresh, symbolsByFile } = extract(rootDir);

		const { symbols } = createScipIndexResolver().resolve(
			[
				{
					language: "python",
					indexPath: path.join(rootDir, "index.scip"),
					fileHashes: { [servicePath]: sha256(servicePath), [storagePath]: "not the current hash" },
				},
			],
			fresh,
			symbolsByFile,
		);

		expect(serviceOf(symbols, rootDir)?.indexFallback).toBeUndefined();
		expect(symbols.find((extracted) => extracted.filePath === storagePath)?.indexFallback).toBe("index-stale");
	});
});

describe("createScipIndexResolver with a scip-go index", () => {
	const goFiles = (rootDir: string) =>
		["app/normalize.go", "app/service.go", "legacy/legacy.go", "storage/storage.go"].map((file) =>
			path.join(rootDir, ...file.split("/")),
		);

	it("narrows a method call and an unqualified call to the targets the index names", () => {
		const rootDir = copyFixture("go-scip");
		const files = goFiles(rootDir);
		const fresh = new GoTreeSitterParser().parse(rootDir, files, files);
		const storage = path.join(rootDir, "storage", "storage.go");
		const legacy = path.join(rootDir, "legacy", "legacy.go");
		const service = path.join(rootDir, "app", "service.go");

		const { symbols, unreadableIndexes } = createScipIndexResolver().resolve(
			[{ language: "go", indexPath: path.join(rootDir, "index.scip") }],
			fresh,
			new Map(fresh.map((extracted) => [extracted.filePath, extracted])),
		);

		expect(
			fresh.find((extracted) => extracted.filePath === service)?.calls.map((call) => call.candidates.length),
		).toStrictEqual([2, 1, 2, 1]);
		expect(unreadableIndexes).toStrictEqual([]);
		// scip-go records no occurrence for a standard-library member, so `Encode` on a
		// `*json.Encoder` keeps tree-sitter's same-name guess.
		expect(symbols.find((extracted) => extracted.filePath === service)?.calls).toStrictEqual([
			{
				callerLocalId: "Run",
				candidates: [{ filePath: storage, localId: "Save" }],
				locations: [{ startLine: 12, endLine: 12 }],
			},
			{
				callerLocalId: "Run",
				candidates: [{ filePath: storage, localId: "Load" }],
				locations: [{ startLine: 12, endLine: 12 }],
			},
			{
				callerLocalId: "Run",
				candidates: [{ filePath: path.join(rootDir, "app", "normalize.go"), localId: "normalize" }],
				locations: [{ startLine: 12, endLine: 12 }],
			},
			{
				callerLocalId: "Run",
				candidates: [{ filePath: legacy, localId: "Encode" }],
				locations: [{ startLine: 13, endLine: 13 }],
			},
		]);
		expect(symbols.some((extracted) => extracted.indexFallback !== undefined)).toBe(false);
	});
});

describe("createScipIndexResolver across languages", () => {
	it("names the languages an index holds documents of, and nothing for one it cannot read", () => {
		const resolver = createScipIndexResolver();

		expect(resolver.languagesIn(path.join(FIXTURES_DIR, "go-scip", "index.scip"))).toStrictEqual(["go"]);
		expect(resolver.languagesIn(path.join(FIXTURES_DIR, "python-scip", "index.scip"))).toStrictEqual(["python"]);
		expect(resolver.languagesIn(path.join(FIXTURES_DIR, "missing.scip"))).toBeUndefined();
	});

	it("reports one unreadable index once, however many languages name it", () => {
		const missing = path.join(os.tmpdir(), "codemap-no-such-index.scip");

		const { unreadableIndexes } = createScipIndexResolver().resolve(
			[
				{ language: "python", indexPath: missing },
				{ language: "go", indexPath: missing },
			],
			[],
			new Map(),
		);

		expect(unreadableIndexes).toMatchObject([{ indexPath: missing }]);
	});
});
