import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDefaultPipeline } from "src/core/compose";
import type { GenerateMapOptions } from "src/core/generate-map";
import { describe, expect, it } from "vitest";

// Capstone golden-file coverage for the real Discovery -> Parser -> GraphBuilder chain: each
// checked-in fixture repo under `fixtures/` is run through the exact same wiring
// `createDefaultPipeline` gives every real caller, and its `codemap.json` is compared
// byte-for-byte against a checked-in expected file - proving tickets 09-13's real
// implementations are correct together, not just stage by stage.
const FIXTURES_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "fixtures");

interface FixtureScenario {
	name: string;
	exclude: string[];
}

const SCENARIOS: FixtureScenario[] = [
	{ name: "barrel-file", exclude: [] },
	{ name: "ambiguous-call", exclude: [] },
	{ name: "isolated-file", exclude: [] },
	{ name: "multi-package-monorepo", exclude: ["node_modules/**"] },
	{ name: "broken-file", exclude: [] },
	{ name: "module-assignment", exclude: [] },
	// Multi-language support: one small fixture
	// per new language, plus one genuinely mixed-language repo.
	{ name: "go-basics", exclude: [] },
	{ name: "rust-basics", exclude: [] },
	{ name: "java-basics", exclude: [] },
	{ name: "python-basics", exclude: [] },
	// documentation/adr/0056: the committed `index.scip` narrows this fixture's ambiguous calls.
	{ name: "python-scip", exclude: [] },
	{ name: "polyglot-repo", exclude: [] },
];

function freshOutDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "codemap-golden-"));
}

function generate(scenario: FixtureScenario): string {
	const rootDir = path.join(FIXTURES_ROOT, scenario.name);
	const options: GenerateMapOptions = {
		exclude: scenario.exclude,
		outDir: freshOutDir(),
		force: true,
	};
	return createDefaultPipeline().generateMap(rootDir, options).json;
}

function expectedJsonFor(scenario: FixtureScenario): string {
	return fs.readFileSync(path.join(FIXTURES_ROOT, "expected", `${scenario.name}.codemap.json`), "utf8");
}

describe("golden-file fixtures", () => {
	for (const scenario of SCENARIOS) {
		it(`matches the checked-in codemap.json byte-for-byte: ${scenario.name}`, () => {
			expect(generate(scenario)).toBe(expectedJsonFor(scenario));
		});
	}

	// Every other scenario's expected fixture has `moduleId: null` on every file (proving only the
	// "isolated"/"undersized"/"degenerate-partition" unassigned paths) - this is the one case that
	// proves a file actually landing in a real Module end-to-end: `fixtures/module-assignment/`
	// has two folder-proximate two-file components (`src/moduleA/{a1,a2}.ts`,
	// `src/moduleB/{b1,b2}.ts`), each an import edge with no cross-component edge, which is enough
	// disconnected structure for whole-graph modularity to clear `MIN_MODULARITY` while each pair
	// still clears `MIN_COMMUNITY_SIZE` and `MIN_EMBEDDEDNESS` (documentation/adr/0015,
	// `src/clustering/louvain/louvain-module-detector.ts`).
	it("assigns a real, non-null moduleId to files that form a genuine community: module-assignment", () => {
		const graph = JSON.parse(generate({ name: "module-assignment", exclude: [] })) as {
			nodes: { kind: string; moduleId?: number | null }[];
		};

		const fileModuleIds = graph.nodes.filter((node) => node.kind === "file").map((node) => node.moduleId);

		expect(fileModuleIds).toStrictEqual([0, 0, 1, 1]);
		expect(fileModuleIds.some((moduleId) => moduleId !== null)).toBe(true);
	});

	// End-to-end coverage for the multi-language spec's three
	// cross-cutting claims together, not just per-parser unit tests: `fixtures/polyglot-repo/` has
	// a `package.json` and `go.mod` co-located at the repo root (point 10), a Go pair
	// (`goa/a1.go`/`gob/a2.go`) and a TS pair (`src/moduleA/{a1,a2}.ts`) each forming their own real
	// Module in one combined run (point 20), and all four languages represented in one `languages`
	// envelope field (point 24).
	it("lands co-located Packages, combined-graph Module detection, and the languages field together: polyglot-repo", () => {
		const graph = JSON.parse(generate({ name: "polyglot-repo", exclude: [] })) as {
			nodes: {
				id: string;
				kind: string;
				language?: string;
				moduleId?: number | null;
			}[];
			languages: string[];
		};

		const packageIds = graph.nodes
			.filter((node) => node.kind === "package")
			.map((node) => node.id)
			.sort();
		expect(packageIds).toStrictEqual([".@go", ".@npm", "java", "rust"]);

		const moduleIdByFile = new Map(
			graph.nodes.filter((node) => node.kind === "file").map((node) => [node.id, node.moduleId]),
		);
		const goaModuleId = moduleIdByFile.get("goa/a1.go");
		const tsModuleId = moduleIdByFile.get("src/moduleA/a1.ts");
		expect(goaModuleId).not.toBeNull();
		expect(tsModuleId).not.toBeNull();
		expect(goaModuleId).toBe(moduleIdByFile.get("gob/a2.go"));
		expect(tsModuleId).toBe(moduleIdByFile.get("src/moduleA/a2.ts"));
		expect(goaModuleId).not.toBe(tsModuleId);

		expect(graph.languages).toStrictEqual(["go", "java", "rust", "typescript"]);
	});

	// End-to-end coverage for `--include-tests` actually revealing each new language's
	// default-excluded test file -
	// the `SCENARIOS` loop above only proves each fixture's *default* (hidden) byte-for-byte shape;
	// these prove the flag's reveal path surfaces the file and its Symbol(s) end-to-end.
	it("reveals Go's _test.go file and its Symbol when includeTests is on", () => {
		const rootDir = path.join(FIXTURES_ROOT, "go-basics");
		const result = createDefaultPipeline().generateMap(rootDir, {
			exclude: [],
			outDir: freshOutDir(),
			force: true,
			includeTests: true,
		});
		const graph = JSON.parse(result.json) as {
			nodes: { id: string; kind: string }[];
		};

		expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "main_test.go", kind: "file" }));
		expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "main_test.go#TestRun", kind: "symbol" }));
	});

	it("reveals Python's test_*.py file and its Symbol when includeTests is on", () => {
		const rootDir = path.join(FIXTURES_ROOT, "python-basics");
		const result = createDefaultPipeline().generateMap(rootDir, {
			exclude: [],
			outDir: freshOutDir(),
			force: true,
			includeTests: true,
		});
		const graph = JSON.parse(result.json) as {
			nodes: { id: string; kind: string }[];
		};

		expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "test_widget.py", kind: "file" }));
		expect(graph.nodes).toContainEqual(
			expect.objectContaining({
				id: "test_widget.py#test_run",
				kind: "symbol",
			}),
		);
	});

	it("reveals Java's src/test/ file and its Symbols when includeTests is on", () => {
		const rootDir = path.join(FIXTURES_ROOT, "java-basics");
		const result = createDefaultPipeline().generateMap(rootDir, {
			exclude: [],
			outDir: freshOutDir(),
			force: true,
			includeTests: true,
		});
		const graph = JSON.parse(result.json) as {
			nodes: { id: string; kind: string }[];
		};
		const testFileId = "src/test/java/com/example/WidgetTest.java";

		expect(graph.nodes).toContainEqual(expect.objectContaining({ id: testFileId, kind: "file" }));
		expect(graph.nodes).toContainEqual(
			expect.objectContaining({
				id: `${testFileId}#testRun`,
				kind: "symbol",
			}),
		);
	});

	it("reveals Rust's tests/ integration file when includeTests is on, bucketed into the shared tests Module", () => {
		const rootDir = path.join(FIXTURES_ROOT, "rust-basics");
		const result = createDefaultPipeline().generateMap(rootDir, {
			exclude: [],
			outDir: freshOutDir(),
			force: true,
			includeTests: true,
		});
		const graph = JSON.parse(result.json) as {
			nodes: { id: string; kind: string; moduleId?: number | null }[];
			modules: { id: number; name: string }[];
		};
		const testFileId = "tests/integration_test.rs";

		expect(graph.nodes).toContainEqual(
			expect.objectContaining({
				id: `${testFileId}#it_works_end_to_end`,
				kind: "symbol",
			}),
		);

		const testsModule = graph.modules.find((module) => module.name === "tests");
		expect(testsModule).toBeDefined();

		const fileNode = graph.nodes.find((node) => node.id === testFileId && node.kind === "file");
		expect(fileNode?.moduleId).toBe(testsModule?.id);
	});

	// One test per scenario, like the byte-for-byte tests above: a single test running every
	// scenario twice outgrew Vitest's 5s default on CI runners, and this also names the fixture
	// that broke determinism.
	for (const scenario of SCENARIOS) {
		it(`produces byte-identical codemap.json across two runs of the same unchanged fixture: ${scenario.name}`, () => {
			expect(generate(scenario)).toBe(generate(scenario));
		});
	}

	// Real end-to-end coverage for ticket 13's unparseable-file policy
	// (that ticket's "Fixture: a
	// repo with one syntactically-broken file still generates a complete, correct map for every
	// other file" item), through the exact same Discovery -> Parser -> GraphBuilder -> ModuleDetector
	// -> Transformer chain every real caller drives - not just `Parser`'s own in-memory unit tests
	// (`ts-compiler-api-parser.test.ts`'s "TsCompilerApiParser unparseable file policy" describe).
	// `fixtures/broken-file/` has one genuinely broken file (`src/broken.ts`, a bare
	// "export function broken( {") alongside two valid ones: `src/good.ts` (a plain exported
	// function) and `src/consumer.ts`, which imports and calls `good.ts` *and* imports (but never
	// resolves) `broken.ts`, exercising the "another file's import into a skipped file resolves as
	// unresolved" rule in the same run.
	it("skips a syntactically-broken file with a warning, never crashes, and leaves every other file's nodes/edges complete and correct", () => {
		const scenario: FixtureScenario = { name: "broken-file", exclude: [] };
		const rootDir = path.join(FIXTURES_ROOT, scenario.name);
		const result = createDefaultPipeline().generateMap(rootDir, {
			exclude: scenario.exclude,
			outDir: freshOutDir(),
			force: true,
		});

		// The run always succeeds (no thrown error to reach this point at all) and surfaces exactly
		// one warning, naming the skipped file - never silently, and (schema 1.3.0) inside
		// codemap.json's own top-level `warnings` field too, asserted again below via `result.json`.
		expect(result.skippedFiles).toStrictEqual([{ file: "src/broken.ts", reason: "unparseable" }]);

		const graph = JSON.parse(result.json) as {
			nodes: { id: string; kind: string }[];
			edges: { source: string; target: string }[];
		};

		// broken.ts produces no FileNode and contributes no Symbols at all.
		expect(graph.nodes.some((node) => node.id.startsWith("src/broken.ts"))).toBe(false);

		// Every other file's own nodes and edges are still generated completely and correctly - this
		// is exactly the checked-in expected fixture's content (asserted byte-for-byte in the
		// `SCENARIOS` loop above), repeated here as explicit, named assertions.
		expect(result.json).toBe(expectedJsonFor(scenario));
		expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "src/good.ts", kind: "file" }));
		expect(graph.nodes).toContainEqual(expect.objectContaining({ id: "src/consumer.ts", kind: "file" }));
		expect(graph.edges).toContainEqual(
			expect.objectContaining({
				source: "src/consumer.ts",
				target: "src/good.ts",
			}),
		);
		expect(graph.edges).toContainEqual(
			expect.objectContaining({
				source: "src/consumer.ts#run",
				target: "src/good.ts#safe",
			}),
		);

		// consumer.ts's import of the broken file resolves as unresolved (no edge at all) - never a
		// dangling edge pointing at a FileNode that was never created.
		expect(graph.edges.some((edge) => edge.target.startsWith("src/broken.ts"))).toBe(false);
	});
});
