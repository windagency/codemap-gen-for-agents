import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeEpoch, diffFiles, type EpochInputs, loadCache, saveCache } from "src/core/cache/extraction-cache";
import type { ExtractedSymbols } from "src/core/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-cache-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
	const filePath = path.join(tmpDir, name);
	fs.writeFileSync(filePath, content);
	return filePath;
}

function fakeExtractedSymbols(filePath: string): ExtractedSymbols {
	return { filePath, symbols: [], imports: [], calls: [] };
}

describe("computeEpoch", () => {
	const base: EpochInputs = {
		generatorVersion: "1.0.0",
		tsconfigRawText: { target: "ES2022" },
		excludePatterns: ["dist/**"],
		includeTests: false,
		dependencyFiles: { "go.mod": "module example.com/a" },
	};

	it("is deterministic for the same inputs", () => {
		expect(computeEpoch(base)).toBe(computeEpoch({ ...base }));
	});

	it.each<[string, Partial<EpochInputs>]>([
		["the generator version", { generatorVersion: "1.0.1" }],
		["the tsconfig compilerOptions", { tsconfigRawText: { target: "ESNext" } }],
		["the config exclude patterns", { excludePatterns: ["build/**"] }],
		["includeTests", { includeTests: true }],
		["a dependency manifest's content", { dependencyFiles: { "go.mod": "module example.com/b" } }],
		["the set of dependency manifests", { dependencyFiles: { "go.mod": "module example.com/a", "go.sum": "" } }],
	])("changes when %s changes", (_label, change) => {
		expect(computeEpoch({ ...base, ...change })).not.toBe(computeEpoch(base));
	});

	it("is unaffected by the order of exclude patterns or dependency manifests", () => {
		const a = computeEpoch({
			...base,
			excludePatterns: ["dist/**", "build/**"],
			dependencyFiles: { "go.mod": "x", "Cargo.toml": "y" },
		});
		const b = computeEpoch({
			...base,
			excludePatterns: ["build/**", "dist/**"],
			dependencyFiles: { "Cargo.toml": "y", "go.mod": "x" },
		});

		expect(a).toBe(b);
	});
});

describe("loadCache / saveCache", () => {
	it("treats a missing cache file as empty, with no error thrown", () => {
		const cachePath = path.join(tmpDir, "cache.json");

		const cache = loadCache(cachePath);

		expect(cache).toStrictEqual({ epoch: "", files: {} });
	});

	it("round-trips a saved cache file", () => {
		const cachePath = path.join(tmpDir, "cache.json");
		const extractedSymbols = fakeExtractedSymbols("src/a.ts");
		const written = {
			epoch: "abc123",
			files: {
				"src/a.ts": { contentHash: "hash-a", extractedSymbols },
			},
		};

		saveCache(cachePath, written);
		const loaded = loadCache(cachePath);

		expect(loaded).toStrictEqual(written);
	});

	it("treats a corrupt cache file as empty rather than throwing", () => {
		const cachePath = path.join(tmpDir, "cache.json");
		fs.writeFileSync(cachePath, "{not valid json");

		const cache = loadCache(cachePath);

		expect(cache).toStrictEqual({ epoch: "", files: {} });
	});

	it("treats valid JSON with the wrong shape as empty rather than throwing", () => {
		const cachePath = path.join(tmpDir, "cache.json");
		fs.writeFileSync(cachePath, JSON.stringify({ epoch: 123, files: null }));

		const cache = loadCache(cachePath);

		expect(cache).toStrictEqual({ epoch: "", files: {} });
	});

	it("wraps a filesystem write failure in a clear, contextual error instead of an unhandled exception", () => {
		// A cache path under a file (not a directory) makes `mkdirSync(recursive: true)` fail with
		// ENOTDIR - a stand-in for any real write failure (disk full, permission denied, ...).
		const blockerFile = writeFile("blocker", "not a directory");
		const cachePath = path.join(blockerFile, "cache.json");

		expect(() => saveCache(cachePath, { epoch: "", files: {} })).toThrow(
			`Failed to save extraction cache to ${cachePath}`,
		);
	});
});

describe("diffFiles", () => {
	it("excludes an unchanged file from the changed set and returns its cached symbols", () => {
		const filePath = writeFile("a.ts", "export const a = 1;");
		const extractedSymbols = fakeExtractedSymbols(filePath);
		const cache = {
			epoch: "epoch-1",
			files: {
				[filePath]: {
					contentHash: hashOf("export const a = 1;"),
					extractedSymbols,
				},
			},
		};

		const result = diffFiles(cache, [filePath], "epoch-1");

		expect(result.changed).toStrictEqual([]);
		expect(result.cached).toStrictEqual({ [filePath]: extractedSymbols });
		expect(result.contentHashes).toStrictEqual({
			[filePath]: hashOf("export const a = 1;"),
		});
	});

	it("includes a file whose content hash changed in the changed set", () => {
		const filePath = writeFile("a.ts", "export const a = 2;");
		const extractedSymbols = fakeExtractedSymbols(filePath);
		const cache = {
			epoch: "epoch-1",
			files: {
				[filePath]: {
					contentHash: hashOf("export const a = 1;"),
					extractedSymbols,
				},
			},
		};

		const result = diffFiles(cache, [filePath], "epoch-1");

		expect(result.changed).toStrictEqual([filePath]);
		expect(result.cached).toStrictEqual({});
		expect(result.contentHashes).toStrictEqual({
			[filePath]: hashOf("export const a = 2;"),
		});
	});

	it("includes a new file with no existing cache entry in the changed set", () => {
		const filePath = writeFile("new.ts", "export const b = 1;");
		const cache = { epoch: "epoch-1", files: {} };

		const result = diffFiles(cache, [filePath], "epoch-1");

		expect(result.changed).toStrictEqual([filePath]);
		expect(result.cached).toStrictEqual({});
		expect(result.contentHashes).toStrictEqual({});
	});

	it("treats every file as changed when the epoch doesn't match, regardless of content hash", () => {
		const filePath = writeFile("a.ts", "export const a = 1;");
		const extractedSymbols = fakeExtractedSymbols(filePath);
		const cache = {
			epoch: "epoch-old",
			files: {
				[filePath]: {
					contentHash: hashOf("export const a = 1;"),
					extractedSymbols,
				},
			},
		};

		const result = diffFiles(cache, [filePath], "epoch-new");

		expect(result.changed).toStrictEqual([filePath]);
		expect(result.cached).toStrictEqual({});
	});
});

function hashOf(content: string): string {
	return crypto.createHash("sha256").update(content).digest("hex");
}
