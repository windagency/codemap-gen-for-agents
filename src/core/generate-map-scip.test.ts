import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDefaultPipeline } from "src/core/compose";
import type { GenerateMapOptions } from "src/core/generate-map";
import { describe, expect, it } from "vitest";

// documentation/adr/0056 end to end: the real pipeline over a copy of `fixtures/python-scip`.
const FIXTURE_DIR = path.resolve(import.meta.dirname, "..", "..", "fixtures", "python-scip");

function copyFixture(): string {
	const copy = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-scip-map-"));
	fs.cpSync(FIXTURE_DIR, copy, { recursive: true });
	return copy;
}

interface MapJson {
	edges: { source: string; target: string; type: string }[];
	warnings: string[];
}

function generate(rootDir: string, options: Partial<GenerateMapOptions> = {}): MapJson {
	const json = createDefaultPipeline().generateMap(rootDir, {
		exclude: [],
		outDir: path.join(rootDir, ".codemap"),
		...options,
	}).json;
	return JSON.parse(json) as MapJson;
}

function callTargetsOf(map: MapJson): string[] {
	return map.edges
		.filter((edge) => edge.type === "call" && edge.source === "app/service.py#run")
		.map((edge) => edge.target)
		.sort();
}

const TREE_SITTER_TARGETS = [
	"app/legacy.py#encode",
	"app/legacy.py#load",
	"app/storage.py#load",
	"app/storage.py#save",
	"app/storage.py#save#2",
];

describe("generateMap with a SCIP index", () => {
	it("reads <rootDir>/index.scip by default and keeps only the index's targets", () => {
		const map = generate(copyFixture());

		expect(callTargetsOf(map)).toStrictEqual(["app/storage.py#load", "app/storage.py#save"]);
		expect(map.warnings).toStrictEqual([]);
	});

	it("keeps tree-sitter's candidates when no index exists", () => {
		const rootDir = copyFixture();
		fs.rmSync(path.join(rootDir, "index.scip"));

		const map = generate(rootDir);

		expect(callTargetsOf(map)).toStrictEqual(TREE_SITTER_TARGETS);
		expect(map.warnings).toStrictEqual([]);
	});

	it("warns about an explicit index it cannot read and keeps tree-sitter's candidates", () => {
		const rootDir = copyFixture();
		const missing = path.join(rootDir, "missing.scip");

		const map = generate(rootDir, { scipIndexes: { python: missing } });

		expect(callTargetsOf(map)).toStrictEqual(TREE_SITTER_TARGETS);
		expect(map.warnings).toHaveLength(1);
		expect(map.warnings[0]).toMatch(/^Unreadable SCIP index .*missing\.scip: /);
	});

	it("names an unreadable index by its repo-relative path, even through a symlinked root", () => {
		const linkedRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codemap-scip-link-")), "repo");
		fs.symlinkSync(copyFixture(), linkedRoot, "dir");

		const map = generate(linkedRoot, { scipIndexes: { python: path.join(linkedRoot, "indexes", "missing.scip") } });

		expect(map.warnings).toHaveLength(1);
		expect(map.warnings[0]).toMatch(/^Unreadable SCIP index indexes\/missing\.scip: /);
	});

	it("prefers an explicit index over <rootDir>/index.scip, and finds its documents from a subdirectory", () => {
		const rootDir = copyFixture();
		const elsewhere = path.join(rootDir, "build", "python.scip");
		fs.mkdirSync(path.dirname(elsewhere));
		fs.renameSync(path.join(rootDir, "index.scip"), elsewhere);
		fs.writeFileSync(path.join(rootDir, "index.scip"), "not a SCIP index");

		const map = generate(rootDir, { scipIndexes: { python: elsewhere } });

		expect(callTargetsOf(map)).toStrictEqual(["app/storage.py#load", "app/storage.py#save"]);
		expect(map.warnings).toStrictEqual([]);
	});

	it("warns about a file edited since indexing, and keeps warning once that file is cached", () => {
		const rootDir = copyFixture();
		const servicePath = path.join(rootDir, "app", "service.py");
		fs.writeFileSync(servicePath, `# edited\n${fs.readFileSync(servicePath, "utf8")}`);
		const stale = "SCIP index is stale, used tree-sitter resolution: app/service.py";

		expect(generate(rootDir).warnings).toStrictEqual([stale]);
		expect(generate(rootDir).warnings).toStrictEqual([stale]);
	});

	it("re-extracts every file when the index changes, instead of serving cached refinements", () => {
		const rootDir = copyFixture();
		expect(callTargetsOf(generate(rootDir))).toStrictEqual(["app/storage.py#load", "app/storage.py#save"]);

		fs.writeFileSync(path.join(rootDir, "index.scip"), Buffer.alloc(0));

		expect(callTargetsOf(generate(rootDir))).toStrictEqual(TREE_SITTER_TARGETS);
	});
});
