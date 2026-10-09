import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDefaultPipeline } from "src/core/compose";
import type { GenerateMapOptions } from "src/core/generate-map";
import { afterEach, describe, expect, it, vi } from "vitest";

// documentation/adr/0056 end to end: the real pipeline over a copy of `fixtures/python-scip`.
const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "..", "fixtures");
const FIXTURE_DIR = path.join(FIXTURES_DIR, "python-scip");

function copyFixture(name = "python-scip"): string {
	const copy = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-scip-map-"));
	fs.cpSync(path.join(FIXTURES_DIR, name), copy, { recursive: true });
	return copy;
}

// `fixtures/go-scip` with its Go index at the root, plus `fixtures/python-scip`'s Python sources
// and no Python index: one repo, two SCIP languages, one root `index.scip` covering only Go.
function copyPolyglotFixture(): string {
	const rootDir = copyFixture("go-scip");
	fs.cpSync(path.join(FIXTURE_DIR, "app"), path.join(rootDir, "app"), { recursive: true });
	fs.copyFileSync(path.join(FIXTURE_DIR, "pyproject.toml"), path.join(rootDir, "pyproject.toml"));
	return rootDir;
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

function callTargetsOf(map: MapJson, source = "app/service.py#run"): string[] {
	return map.edges
		.filter((edge) => edge.type === "call" && edge.source === source)
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

		// Named for every SCIP language, so the unreadable default is never consulted.
		const map = generate(rootDir, { scipIndexes: { python: elsewhere, go: elsewhere } });

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

	it("reads <rootDir>/index.scip for Go, and only for the languages it holds documents of", () => {
		const map = generate(copyPolyglotFixture());

		expect(callTargetsOf(map, "app/service.go#Run")).toStrictEqual(GO_INDEX_TARGETS);
		expect(callTargetsOf(map)).toStrictEqual(TREE_SITTER_TARGETS);
		expect(map.warnings).toStrictEqual([]);
	});
});

// scip-go records no occurrence for a standard-library member, so `Encode` on a `*json.Encoder`
// keeps tree-sitter's same-name guess.
const GO_INDEX_TARGETS = [
	"app/normalize.go#normalize",
	"legacy/legacy.go#Encode",
	"storage/storage.go#Load",
	"storage/storage.go#Save",
];

// A stand-in indexer on PATH: records each working directory it ran in, then copies a fixture's
// committed index to wherever `--output` points.
function fakeIndexerOnPath(command = "scip-python", fixtureDir = FIXTURE_DIR): { runsLog: string } {
	const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-fake-indexer-"));
	const runsLog = path.join(binDir, "runs.log");
	const script = [
		`#!${process.execPath}`,
		'const fs = require("node:fs");',
		'const output = process.argv[process.argv.indexOf("--output") + 1];',
		`fs.appendFileSync(${JSON.stringify(runsLog)}, process.cwd() + "\\n");`,
		`fs.copyFileSync(${JSON.stringify(path.join(fixtureDir, "index.scip"))}, output);`,
	].join("\n");
	fs.writeFileSync(path.join(binDir, command), script, { mode: 0o755 });
	vi.stubEnv("PATH", `${binDir}${path.delimiter}${process.env.PATH ?? ""}`);
	return { runsLog };
}

function runsIn(runsLog: string): string[] {
	return fs.existsSync(runsLog) ? fs.readFileSync(runsLog, "utf8").split("\n").filter(Boolean) : [];
}

describe("generateMap with runIndexers", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("runs scip-python in the Package root when no index was supplied, then refines from what it wrote", () => {
		const rootDir = copyFixture();
		fs.rmSync(path.join(rootDir, "index.scip"));
		const { runsLog } = fakeIndexerOnPath();

		const map = generate(rootDir, { runIndexers: true });

		expect(runsIn(runsLog)).toStrictEqual([fs.realpathSync(rootDir)]);
		expect(callTargetsOf(map)).toStrictEqual(["app/storage.py#load", "app/storage.py#save"]);
		expect(map.warnings).toStrictEqual([]);
		expect(fs.existsSync(path.join(rootDir, ".codemap", "scip", "%2E.scip"))).toBe(true);
		expect(fs.existsSync(path.join(rootDir, ".codemap", "scip", "%2E.hashes.json"))).toBe(true);
	});

	it("reuses its own index on the next run while no Python file changed", () => {
		const rootDir = copyFixture();
		fs.rmSync(path.join(rootDir, "index.scip"));
		const { runsLog } = fakeIndexerOnPath();

		generate(rootDir, { runIndexers: true });
		const map = generate(rootDir, { runIndexers: true });

		expect(runsIn(runsLog)).toHaveLength(1);
		expect(callTargetsOf(map)).toStrictEqual(["app/storage.py#load", "app/storage.py#save"]);
	});

	it("never runs an indexer for a language whose index was supplied", () => {
		const rootDir = copyFixture();
		const { runsLog } = fakeIndexerOnPath();

		const map = generate(rootDir, { runIndexers: true });

		expect(runsIn(runsLog)).toStrictEqual([]);
		expect(callTargetsOf(map)).toStrictEqual(["app/storage.py#load", "app/storage.py#save"]);
	});

	it("runs nothing unless asked", () => {
		const rootDir = copyFixture();
		fs.rmSync(path.join(rootDir, "index.scip"));
		const { runsLog } = fakeIndexerOnPath();

		const map = generate(rootDir);

		expect(runsIn(runsLog)).toStrictEqual([]);
		expect(callTargetsOf(map)).toStrictEqual(TREE_SITTER_TARGETS);
	});

	it("warns and keeps tree-sitter's candidates when scip-python is not installed", () => {
		const rootDir = copyFixture();
		fs.rmSync(path.join(rootDir, "index.scip"));
		vi.stubEnv("PATH", fs.mkdtempSync(path.join(os.tmpdir(), "codemap-empty-path-")));

		const map = generate(rootDir, { runIndexers: true });

		expect(callTargetsOf(map)).toStrictEqual(TREE_SITTER_TARGETS);
		expect(map.warnings).toStrictEqual([
			"SCIP indexer scip-python failed for package ., used tree-sitter resolution: scip-python not found on PATH",
		]);
	});

	it("still runs the indexers when the root index.scip cannot be read, and warns about it once", () => {
		const rootDir = copyFixture();
		fs.writeFileSync(path.join(rootDir, "index.scip"), "not a SCIP index");
		const { runsLog } = fakeIndexerOnPath();

		const map = generate(rootDir, { runIndexers: true });

		expect(runsIn(runsLog)).toStrictEqual([fs.realpathSync(rootDir)]);
		expect(callTargetsOf(map)).toStrictEqual(["app/storage.py#load", "app/storage.py#save"]);
		expect(map.warnings).toStrictEqual([
			"Unreadable SCIP index index.scip: not a SCIP index: illegal tag: field no 13 wire type 6",
		]);
	});

	it("runs scip-python when the root index.scip holds only Go documents", () => {
		const rootDir = copyPolyglotFixture();
		const { runsLog } = fakeIndexerOnPath();

		const map = generate(rootDir, { runIndexers: true });

		expect(runsIn(runsLog)).toStrictEqual([fs.realpathSync(rootDir)]);
		expect(callTargetsOf(map)).toStrictEqual(["app/storage.py#load", "app/storage.py#save"]);
		expect(callTargetsOf(map, "app/service.go#Run")).toStrictEqual(GO_INDEX_TARGETS);
		expect(map.warnings).toStrictEqual([]);
	});

	it("runs scip-go in the Go module root when no index was supplied", () => {
		const rootDir = copyFixture("go-scip");
		fs.rmSync(path.join(rootDir, "index.scip"));
		const { runsLog } = fakeIndexerOnPath("scip-go", path.join(FIXTURES_DIR, "go-scip"));

		const map = generate(rootDir, { runIndexers: true });

		expect(runsIn(runsLog)).toStrictEqual([fs.realpathSync(rootDir)]);
		expect(callTargetsOf(map, "app/service.go#Run")).toStrictEqual(GO_INDEX_TARGETS);
		expect(map.warnings).toStrictEqual([]);
	});
});
