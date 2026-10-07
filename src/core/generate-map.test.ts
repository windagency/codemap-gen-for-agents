import fs from "node:fs";
import path from "node:path";
import type { ModuleDetector } from "src/clustering/module-detector";
import { loadCache } from "src/core/cache/extraction-cache";
import { createCodemapGenerator } from "src/core/generate-map";
import { createNullLogger } from "src/core/observability/logger";
import { formatSkippedFile } from "src/core/skipped-file";
import { createFixtureRepo, fakeLogger } from "src/core/test-helpers";
import type { ClusteredGraph, DiscoveredStructure, ExtractedSymbols, RawGraph } from "src/core/types";
import type { Discovery } from "src/discovery/discovery";
import type { Parser } from "src/extraction/parser";
import type { GraphBuilder } from "src/graph-building/graph-builder";
import type { Transformer } from "src/output/transformer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const fakeRawGraph: RawGraph = { nodes: [], edges: [] };
const fakeClusteredGraph: ClusteredGraph = { nodes: [], edges: [] };

function fakeDiscovery(programFiles: string[]): Discovery {
	const structure: DiscoveredStructure = {
		programFiles,
		packages: [],
		directories: [],
		fileOwners: {},
		manifestlessFiles: [],
	};
	return { discover: () => structure };
}

function fakeExtractedSymbols(filePath: string): ExtractedSymbols {
	return { filePath, symbols: [], imports: [], calls: [] };
}

function fakeParser(parseSpy: (programFiles: string[], extractFiles: string[]) => void): Parser {
	return {
		parse: (_rootDir, programFiles, extractFiles) => {
			parseSpy(programFiles, extractFiles);
			return extractFiles.map(fakeExtractedSymbols);
		},
	};
}

function stubDependencies(discovery: Discovery, parser: Parser) {
	const graphBuilder: GraphBuilder = { build: () => fakeRawGraph };
	const moduleDetector: ModuleDetector = { detect: () => fakeClusteredGraph };
	const jsonTransformer: Transformer = { transform: () => "fake-json" };
	const htmlTransformer: Transformer = { transform: () => "fake-html" };

	return {
		discovery,
		parser,
		graphBuilder,
		moduleDetector,
		jsonTransformer,
		htmlTransformer,
	};
}

// Every test below `stubDependencies` only cares about extraction/caching behaviour, not
// logging, so it runs against a silent logger to keep `pnpm vitest run` output free of the
// real `createConsoleLogger()` default's JSON noise. Logging itself is asserted separately,
// below, against a capturing fake `Logger`.
function createSilentGenerator(dependencies: ReturnType<typeof stubDependencies>) {
	return createCodemapGenerator(dependencies, createNullLogger());
}

describe("createCodemapGenerator", () => {
	let rootDir: string;
	let filePath: string;

	beforeEach(() => {
		// Realpathed up front: `generateMap` canonicalises `rootDir` internally (macOS's `/var` ->
		// `/private/var` tmpdir symlink), so a test comparing against its own `rootDir` needs the
		// same canonical form.
		rootDir = createFixtureRepo({
			prefix: "codemap-gen-",
			realpath: true,
			files: { "example.ts": "export const example = 1;" },
		});
		filePath = path.join(rootDir, "example.ts");
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("threads Discovery -> Parser -> GraphBuilder -> ModuleDetector -> Transformer output in order", () => {
		const structure: DiscoveredStructure = {
			programFiles: ["example.ts"],
			packages: [{ id: ".", name: "root-pkg", language: "typescript" }],
			directories: [],
			fileOwners: { "example.ts": { packageId: ".", directoryId: null } },
			manifestlessFiles: [],
		};
		const discovery: Discovery = {
			discover: (receivedRootDir, receivedExclude, receivedIncludeTests) => {
				expect(receivedRootDir).toBe(rootDir);
				expect(receivedExclude).toStrictEqual(["dist/**"]);
				expect(receivedIncludeTests).toBe(true);
				return structure;
			},
		};
		const fakeSymbols: ExtractedSymbols[] = [fakeExtractedSymbols(filePath)];
		const parser: Parser = {
			parse: (_rootDir, _programFiles, _extractFiles) => fakeSymbols,
		};
		const graphBuilder: GraphBuilder = {
			build: (receivedSymbols, receivedStructure) => {
				// `GraphBuilder` needs repo-relative filePaths (matching every File node id and
				// `structure.programFiles`), not the absolute ones `Parser`/the cache use.
				expect(receivedSymbols).toStrictEqual([fakeExtractedSymbols("example.ts")]);
				expect(receivedStructure).toBe(structure);
				return fakeRawGraph;
			},
		};
		const moduleDetector: ModuleDetector = {
			detect: (received) => {
				expect(received).toBe(fakeRawGraph);
				return fakeClusteredGraph;
			},
		};
		const jsonTransformer: Transformer = {
			transform: (received) => {
				expect(received).toBe(fakeClusteredGraph);
				return "fake-json-output";
			},
		};
		const htmlTransformer: Transformer = {
			transform: (received) => {
				expect(received).toBe(fakeClusteredGraph);
				return "fake-html-output";
			},
		};

		const generator = createCodemapGenerator(
			{
				discovery,
				parser,
				graphBuilder,
				moduleDetector,
				jsonTransformer,
				htmlTransformer,
			},
			createNullLogger(),
		);

		const result = generator.generateMap(rootDir, {
			exclude: ["dist/**"],
			outDir: rootDir,
			includeTests: true,
		});

		expect(result).toStrictEqual({
			json: "fake-json-output",
			html: "fake-html-output",
			skippedFiles: [],
			nodeCount: 0,
			edgeCount: 0,
		});
	});
});

describe("createCodemapGenerator nodeCount/edgeCount", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-gen-",
			realpath: true,
			files: { "a.ts": "export const a = 1;" },
		});
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("counts nodes/edges straight from the clustered graph, not by re-parsing the serialized json", () => {
		const clusteredGraph: ClusteredGraph = {
			nodes: [
				{
					id: "a.ts",
					kind: "file",
					name: "a.ts",
					extension: ".ts",
					language: "typescript",
					moduleId: null,
					unassignedReason: null,
				},
				{
					id: "b.ts",
					kind: "file",
					name: "b.ts",
					extension: ".ts",
					language: "typescript",
					moduleId: null,
					unassignedReason: null,
				},
			],
			edges: [],
		};
		const discovery: Discovery = {
			discover: () => ({
				programFiles: ["a.ts"],
				packages: [],
				directories: [],
				fileOwners: {},
				manifestlessFiles: [],
			}),
		};
		const parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) => extractFiles.map(fakeExtractedSymbols),
		};
		const graphBuilder: GraphBuilder = { build: () => fakeRawGraph };
		const moduleDetector: ModuleDetector = { detect: () => clusteredGraph };
		// Deliberately out of sync with `clusteredGraph` - proves `nodeCount`/`edgeCount` come from
		// the in-memory graph, never from parsing this string back out.
		const jsonTransformer: Transformer = { transform: () => "{}" };
		const htmlTransformer: Transformer = { transform: () => "<html></html>" };

		const result = createCodemapGenerator(
			{
				discovery,
				parser,
				graphBuilder,
				moduleDetector,
				jsonTransformer,
				htmlTransformer,
			},
			createNullLogger(),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		expect(result.nodeCount).toBe(2);
		expect(result.edgeCount).toBe(0);
	});
});

describe("createCodemapGenerator unparseable file policy", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-gen-",
			realpath: true,
			files: {
				"a.ts": "export const a = 1;",
				"b.ts": "export const b = 1;",
			},
		});
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("excludes a Parser-skipped file from GraphBuilder's structure and reports it as a warning", () => {
		const structure: DiscoveredStructure = {
			programFiles: ["a.ts", "b.ts"],
			packages: [{ id: ".", name: "root-pkg", language: "typescript" }],
			directories: [],
			fileOwners: {
				"a.ts": { packageId: ".", directoryId: null },
				"b.ts": { packageId: ".", directoryId: null },
			},
			manifestlessFiles: [],
		};
		const discovery: Discovery = { discover: () => structure };
		// Simulates Parser's own skip-and-warn policy: `b.ts` is silently absent from the result,
		// the same way a genuinely syntactically-broken file would be.
		const parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) =>
				extractFiles.filter((filePath) => !filePath.endsWith("b.ts")).map(fakeExtractedSymbols),
		};
		let receivedStructure: DiscoveredStructure | undefined;
		const graphBuilder: GraphBuilder = {
			build: (_symbols, receivedStructureArg) => {
				receivedStructure = receivedStructureArg;
				return fakeRawGraph;
			},
		};
		const moduleDetector: ModuleDetector = { detect: () => fakeClusteredGraph };
		let receivedJsonOptions: Parameters<Transformer["transform"]>[1];
		const jsonTransformer: Transformer = {
			transform: (_graph, options) => {
				receivedJsonOptions = options;
				return "fake-json";
			},
		};
		const htmlTransformer: Transformer = { transform: () => "fake-html" };

		const result = createCodemapGenerator(
			{
				discovery,
				parser,
				graphBuilder,
				moduleDetector,
				jsonTransformer,
				htmlTransformer,
			},
			createNullLogger(),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		expect(receivedStructure?.programFiles).toStrictEqual(["a.ts"]);
		expect(result.skippedFiles).toStrictEqual([{ file: "b.ts", reason: "unparseable" }]);
		// The exact same array reaches JsonTransformer via TransformOptions, so it also ends up
		// inside `json`'s own envelope (`build-map-json.ts`'s `warnings` field, schema 1.3.0).
		expect(receivedJsonOptions?.warnings).toStrictEqual(result.skippedFiles.map(formatSkippedFile));
	});

	it("does not throw, and passes the original structure through unchanged, when nothing is skipped", () => {
		const structure: DiscoveredStructure = {
			programFiles: ["a.ts", "b.ts"],
			packages: [{ id: ".", name: "root-pkg", language: "typescript" }],
			directories: [],
			fileOwners: {
				"a.ts": { packageId: ".", directoryId: null },
				"b.ts": { packageId: ".", directoryId: null },
			},
			manifestlessFiles: [],
		};
		const discovery: Discovery = { discover: () => structure };
		const parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) => extractFiles.map(fakeExtractedSymbols),
		};
		let receivedStructure: DiscoveredStructure | undefined;
		const graphBuilder: GraphBuilder = {
			build: (_symbols, receivedStructureArg) => {
				receivedStructure = receivedStructureArg;
				return fakeRawGraph;
			},
		};
		const moduleDetector: ModuleDetector = { detect: () => fakeClusteredGraph };
		const jsonTransformer: Transformer = { transform: () => "fake-json" };
		const htmlTransformer: Transformer = { transform: () => "fake-html" };

		const result = createCodemapGenerator(
			{
				discovery,
				parser,
				graphBuilder,
				moduleDetector,
				jsonTransformer,
				htmlTransformer,
			},
			createNullLogger(),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		expect(receivedStructure).toBe(structure);
		expect(result.skippedFiles).toStrictEqual([]);
	});
});

describe("createCodemapGenerator manifest-less file policy", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-gen-",
			realpath: true,
			files: { "a.ts": "export const a = 1;" },
		});
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	// Mirrors the unparseable-file policy's own two-layer testing shape, one layer up: the
	// Discovery-seam-level check lives in `filesystem-discovery.test.ts`; this asserts the
	// orchestrator turns a reported manifest-less file into a distinctly-worded `warnings` entry.
	it("reports a Discovery-flagged manifest-less file as a distinctly-worded warning", () => {
		const structure: DiscoveredStructure = {
			programFiles: ["a.ts"],
			packages: [{ id: ".", name: "root-pkg", language: "typescript" }],
			directories: [],
			fileOwners: { "a.ts": { packageId: ".", directoryId: null } },
			manifestlessFiles: ["orphan/no-manifest.ts"],
		};
		const discovery: Discovery = { discover: () => structure };
		const parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) => extractFiles.map(fakeExtractedSymbols),
		};
		const graphBuilder: GraphBuilder = { build: () => fakeRawGraph };
		const moduleDetector: ModuleDetector = { detect: () => fakeClusteredGraph };
		const jsonTransformer: Transformer = { transform: () => "fake-json" };
		const htmlTransformer: Transformer = { transform: () => "fake-html" };

		const result = createCodemapGenerator(
			{
				discovery,
				parser,
				graphBuilder,
				moduleDetector,
				jsonTransformer,
				htmlTransformer,
			},
			createNullLogger(),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		expect(result.skippedFiles).toStrictEqual([{ file: "orphan/no-manifest.ts", reason: "manifest-less" }]);
	});

	// Both skip reasons can occur in the same run; `warnings` always orders manifest-less entries
	// before unparseable ones, and the same list reaches both `GeneratedMap.skippedFiles` and
	// (formatted, via `TransformOptions`) `codemap.json`'s own `warnings` field (documentation/adr/0029).
	it("orders manifest-less warnings before unparseable-file warnings when both occur in one run", () => {
		const combinedRootDir = createFixtureRepo({
			prefix: "codemap-gen-",
			realpath: true,
			files: {
				"a.ts": "export const a = 1;",
				"b.ts": "export const b = 1;",
			},
		});
		const structure: DiscoveredStructure = {
			programFiles: ["a.ts", "b.ts"],
			packages: [{ id: ".", name: "root-pkg", language: "typescript" }],
			directories: [],
			fileOwners: {
				"a.ts": { packageId: ".", directoryId: null },
				"b.ts": { packageId: ".", directoryId: null },
			},
			manifestlessFiles: ["orphan/no-manifest.ts"],
		};
		const discovery: Discovery = { discover: () => structure };
		const parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) =>
				extractFiles.filter((filePath) => !filePath.endsWith("b.ts")).map(fakeExtractedSymbols),
		};
		const graphBuilder: GraphBuilder = { build: () => fakeRawGraph };
		const moduleDetector: ModuleDetector = { detect: () => fakeClusteredGraph };
		let receivedJsonOptions: Parameters<Transformer["transform"]>[1];
		const jsonTransformer: Transformer = {
			transform: (_graph, options) => {
				receivedJsonOptions = options;
				return "fake-json";
			},
		};
		const htmlTransformer: Transformer = { transform: () => "fake-html" };

		const result = createCodemapGenerator(
			{
				discovery,
				parser,
				graphBuilder,
				moduleDetector,
				jsonTransformer,
				htmlTransformer,
			},
			createNullLogger(),
		).generateMap(combinedRootDir, { exclude: [], outDir: combinedRootDir });

		expect(result.skippedFiles).toStrictEqual([
			{ file: "orphan/no-manifest.ts", reason: "manifest-less" },
			{ file: "b.ts", reason: "unparseable" },
		]);
		expect(receivedJsonOptions?.warnings).toStrictEqual(result.skippedFiles.map(formatSkippedFile));

		fs.rmSync(combinedRootDir, { recursive: true, force: true });
	});
});

describe("createCodemapGenerator cross-run dangling edge", () => {
	let rootDir: string;
	let fileA: string;
	let fileB: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-gen-",
			realpath: true,
			files: {
				"a.ts": "export const a = 1;",
				"b.ts": "export const b = 1;",
			},
		});
		fileA = path.join(rootDir, "a.ts");
		fileB = path.join(rootDir, "b.ts");
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	// Mirrors the unparseable-file policy's own two-layer testing shape, one layer up:
	// run 1's Parser resolves `a.ts`'s import to `b.ts`, cached as such. Run 2 changes `b.ts`'s
	// content and its stubbed Parser returns no extraction for it (simulating it going from valid
	// to broken), while `a.ts` is unchanged and its cached entry is reused unmodified - the exact
	// scenario a same-run-only "no dangling target" guarantee misses.
	it("rewrites a cached file's import into a now-broken file to unresolved, not a dangling file target", () => {
		const structure: DiscoveredStructure = {
			programFiles: ["a.ts", "b.ts"],
			packages: [{ id: ".", name: "root-pkg", language: "typescript" }],
			directories: [],
			fileOwners: {
				"a.ts": { packageId: ".", directoryId: null },
				"b.ts": { packageId: ".", directoryId: null },
			},
			manifestlessFiles: [],
		};
		const discovery: Discovery = { discover: () => structure };

		const extractedSymbolsFor = (filePath: string): ExtractedSymbols =>
			filePath === fileA
				? {
						filePath,
						symbols: [],
						imports: [
							{
								specifier: "./b",
								viaReExport: false,
								resolvedTarget: { kind: "file", filePath: fileB },
								locations: [],
							},
						],
						calls: [],
					}
				: fakeExtractedSymbols(filePath);

		const run1Parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) => extractFiles.map(extractedSymbolsFor),
		};

		createCodemapGenerator(stubDependencies(discovery, run1Parser), createNullLogger()).generateMap(rootDir, {
			exclude: [],
			outDir: rootDir,
		});

		// `b.ts`'s content changes, and this run's Parser treats it as broken (simulating a
		// syntactically-broken edit) - `a.ts` is untouched, so its cached entry (importing `b.ts`
		// as a `file` target) is reused unmodified.
		fs.writeFileSync(fileB, "export const b = 2; !!!broken!!!");
		const run2Parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) =>
				extractFiles.filter((filePath) => filePath !== fileB).map(extractedSymbolsFor),
		};

		let receivedSymbols: ExtractedSymbols[] | undefined;
		const graphBuilder: GraphBuilder = {
			build: (symbols) => {
				receivedSymbols = symbols;
				return fakeRawGraph;
			},
		};

		createCodemapGenerator(
			{
				...stubDependencies(discovery, run2Parser),
				graphBuilder,
			},
			createNullLogger(),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		const receivedA = receivedSymbols?.find((symbols) => symbols.filePath === "a.ts");
		expect(receivedA?.imports).toStrictEqual([
			{
				specifier: "./b",
				viaReExport: false,
				resolvedTarget: { kind: "unresolved" },
				locations: [],
			},
		]);
	});
});

describe("createCodemapGenerator hidden test-item stripping", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-gen-",
			realpath: true,
			files: { "a.rs": "pub fn run() {}\n" },
		});
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	function structureFor(filePath: string): DiscoveredStructure {
		return {
			programFiles: [filePath],
			packages: [{ id: ".", name: "root-pkg", language: "rust" }],
			directories: [],
			fileOwners: { [filePath]: { packageId: ".", directoryId: null } },
			manifestlessFiles: [],
		};
	}

	// A Rust-shaped fixture: one visible symbol (`run`) that calls an `isTestItem`-tagged one
	// (`it_works`), plus the tagged symbol's own now-dangling call back into `run`.
	function taggedSymbols(filePath: string): ExtractedSymbols {
		return {
			filePath,
			symbols: [
				{
					localId: "run",
					name: "run",
					symbolKind: "function",
					startLine: 1,
					endLine: 1,
					exported: true,
				},
				{
					localId: "it_works",
					name: "it_works",
					symbolKind: "function",
					startLine: 3,
					endLine: 3,
					exported: false,
					isTestItem: true,
				},
			],
			imports: [],
			calls: [
				{
					callerLocalId: "run",
					candidates: [{ filePath, localId: "it_works" }],
					locations: [{ startLine: 1, endLine: 1 }],
				},
				{
					callerLocalId: "it_works",
					candidates: [{ filePath, localId: "run" }],
					locations: [{ startLine: 3, endLine: 3 }],
				},
			],
		};
	}

	it("drops an isTestItem-tagged symbol, its own calls, and any dangling candidate naming it, by default", () => {
		const structure = structureFor("a.rs");
		const discovery: Discovery = { discover: () => structure };
		const parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) => extractFiles.map((filePath) => taggedSymbols(filePath)),
		};

		let receivedSymbols: ExtractedSymbols[] | undefined;
		const graphBuilder: GraphBuilder = {
			build: (symbols) => {
				receivedSymbols = symbols;
				return fakeRawGraph;
			},
		};

		createCodemapGenerator({ ...stubDependencies(discovery, parser), graphBuilder }, createNullLogger()).generateMap(
			rootDir,
			{ exclude: [], outDir: rootDir },
		);

		const received = receivedSymbols?.find((s) => s.filePath === "a.rs");
		expect(received?.symbols.map((s) => s.name)).toStrictEqual(["run"]);
		expect(received?.calls).toStrictEqual([]);
	});

	it("keeps an isTestItem-tagged symbol and its calls intact when includeTests is on", () => {
		const structure = structureFor("a.rs");
		const discovery: Discovery = { discover: () => structure };
		const parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) => extractFiles.map((filePath) => taggedSymbols(filePath)),
		};

		let receivedSymbols: ExtractedSymbols[] | undefined;
		const graphBuilder: GraphBuilder = {
			build: (symbols) => {
				receivedSymbols = symbols;
				return fakeRawGraph;
			},
		};

		createCodemapGenerator({ ...stubDependencies(discovery, parser), graphBuilder }, createNullLogger()).generateMap(
			rootDir,
			{
				exclude: [],
				outDir: rootDir,
				includeTests: true,
			},
		);

		const received = receivedSymbols?.find((s) => s.filePath === "a.rs");
		expect(received?.symbols.map((s) => s.name)).toStrictEqual(["run", "it_works"]);
		expect(received?.calls).toHaveLength(2);
	});

	it("logs how many hidden test items were stripped", () => {
		const structure = structureFor("a.rs");
		const discovery: Discovery = { discover: () => structure };
		const parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) => extractFiles.map((filePath) => taggedSymbols(filePath)),
		};
		const { logger, calls } = fakeLogger();

		createCodemapGenerator({ ...stubDependencies(discovery, parser) }, logger).generateMap(rootDir, {
			exclude: [],
			outDir: rootDir,
		});

		const strippedCall = calls.find(([, message]) => message === "hidden test items stripped");
		expect(strippedCall).toStrictEqual([
			"info",
			"hidden test items stripped",
			{ runId: expect.any(String), hiddenSymbols: 1 },
		]);
	});
});

describe("createCodemapGenerator incremental caching", () => {
	let rootDir: string;
	let fileA: string;
	let fileB: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-gen-",
			realpath: true,
			files: {
				"a.ts": "export const a = 1;",
				"b.ts": "export const b = 1;",
			},
		});
		fileA = path.join(rootDir, "a.ts");
		fileB = path.join(rootDir, "b.ts");
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("passes every file as extractFiles on the first run (empty cache)", () => {
		const calls: string[][] = [];
		const generator = createSilentGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser((_programFiles, extractFiles) => calls.push(extractFiles)),
			),
		);

		generator.generateMap(rootDir, { exclude: [], outDir: rootDir });

		expect(calls).toStrictEqual([[fileA, fileB]]);
	});

	it("only passes content-changed files as extractFiles on a subsequent run", () => {
		createSilentGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser(() => {}),
			),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		fs.writeFileSync(fileA, "export const a = 2;");

		const calls: string[][] = [];
		createSilentGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser((_programFiles, extractFiles) => calls.push(extractFiles)),
			),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		expect(calls).toStrictEqual([[fileA]]);
	});

	it("passes every file as extractFiles when force is true, even with a valid cache", () => {
		createSilentGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser(() => {}),
			),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		const calls: string[][] = [];
		createSilentGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser((_programFiles, extractFiles) => calls.push(extractFiles)),
			),
		).generateMap(rootDir, { exclude: [], outDir: rootDir, force: true });

		expect(calls).toStrictEqual([[fileA, fileB]]);
	});

	it("re-extracts every file when includeTests toggles, even with unchanged content", () => {
		createSilentGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser(() => {}),
			),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		const calls: string[][] = [];
		createSilentGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser((_programFiles, extractFiles) => calls.push(extractFiles)),
			),
		).generateMap(rootDir, {
			exclude: [],
			outDir: rootDir,
			includeTests: true,
		});

		expect(calls).toStrictEqual([[fileA, fileB]]);
	});

	it.each(["go.mod", "Cargo.lock", "package.json"])(
		"re-extracts every file when the root %s changes, even with unchanged source content",
		(manifest) => {
			fs.writeFileSync(path.join(rootDir, manifest), "v1");
			createSilentGenerator(
				stubDependencies(
					fakeDiscovery(["a.ts", "b.ts"]),
					fakeParser(() => {}),
				),
			).generateMap(rootDir, { exclude: [], outDir: rootDir });

			fs.writeFileSync(path.join(rootDir, manifest), "v2");

			const calls: string[][] = [];
			createSilentGenerator(
				stubDependencies(
					fakeDiscovery(["a.ts", "b.ts"]),
					fakeParser((_programFiles, extractFiles) => calls.push(extractFiles)),
				),
			).generateMap(rootDir, { exclude: [], outDir: rootDir });

			expect(calls).toStrictEqual([[fileA, fileB]]);
		},
	);

	it("writes an updated cache.json after each run", () => {
		createSilentGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser(() => {}),
			),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		const cache = loadCache(path.join(rootDir, "cache.json"));
		expect(Object.keys(cache.files).sort()).toStrictEqual([fileA, fileB].sort());
	});

	it("a force run writes a cache that a later normal run can reuse", () => {
		createSilentGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser(() => {}),
			),
		).generateMap(rootDir, { exclude: [], outDir: rootDir, force: true });

		const calls: string[][] = [];
		createSilentGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser((_programFiles, extractFiles) => calls.push(extractFiles)),
			),
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		expect(calls).toStrictEqual([[]]);
	});
});

describe("createCodemapGenerator observability", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-gen-",
			realpath: true,
			files: {
				"a.ts": "export const a = 1;",
				"b.ts": "export const b = 1;",
			},
		});
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("logs cache diff and module detection counts through the injected logger", () => {
		const clusteredGraph: ClusteredGraph = {
			nodes: [
				{
					id: "a.ts",
					kind: "file",
					name: "a.ts",
					extension: ".ts",
					language: "typescript",
					moduleId: 0,
					unassignedReason: null,
				},
				{
					id: "b.ts",
					kind: "file",
					name: "b.ts",
					extension: ".ts",
					language: "typescript",
					moduleId: null,
					unassignedReason: "isolated",
				},
			],
			edges: [],
		};
		const dependencies = stubDependencies(
			fakeDiscovery(["a.ts", "b.ts"]),
			fakeParser(() => {}),
		);
		const { logger, calls } = fakeLogger();

		createCodemapGenerator({ ...dependencies, moduleDetector: { detect: () => clusteredGraph } }, logger).generateMap(
			rootDir,
			{ exclude: [], outDir: rootDir },
		);

		const cacheDiffCall = calls.find(([, message]) => message === "cache diff computed");
		expect(cacheDiffCall).toStrictEqual([
			"info",
			"cache diff computed",
			{
				runId: expect.any(String),
				totalFiles: 2,
				changedFiles: 2,
				cachedFiles: 0,
			},
		]);

		const moduleDetectionCall = calls.find(([, message]) => message === "module detection complete");
		expect(moduleDetectionCall).toStrictEqual([
			"info",
			"module detection complete",
			{
				runId: expect.any(String),
				assigned: 1,
				unassigned: 1,
				unassignedByReason: { isolated: 1 },
			},
		]);
	});

	it("tags every line of one run with the same runId, and a new run with a different one", () => {
		const { logger, calls } = fakeLogger();
		const generator = createCodemapGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser(() => {}),
			),
			logger,
		);

		generator.generateMap(rootDir, { exclude: [], outDir: rootDir });
		const firstRunIds = new Set(calls.map(([, , context]) => context?.runId));
		calls.length = 0;
		generator.generateMap(rootDir, { exclude: [], outDir: rootDir });
		const secondRunIds = new Set(calls.map(([, , context]) => context?.runId));

		expect(firstRunIds.size).toBe(1);
		expect(secondRunIds.size).toBe(1);
		expect([...firstRunIds][0]).toEqual(expect.any(String));
		expect([...firstRunIds][0]).not.toBe([...secondRunIds][0]);
	});

	it("logs a completion summary with per-stage durations and per-language file counts", () => {
		const { logger, calls } = fakeLogger();

		createCodemapGenerator(
			stubDependencies(
				fakeDiscovery(["a.ts", "b.ts"]),
				fakeParser(() => {}),
			),
			logger,
		).generateMap(rootDir, { exclude: [], outDir: rootDir });

		const summary = calls.find(([, message]) => message === "generate complete");
		expect(summary?.[0]).toBe("info");
		expect(summary?.[2]).toMatchObject({
			nodeCount: 0,
			edgeCount: 0,
			warningCount: 0,
			filesByLanguage: { typescript: 2 },
			skippedByLanguage: {},
			durationsMs: {
				discover: expect.any(Number),
				parse: expect.any(Number),
				build: expect.any(Number),
				cluster: expect.any(Number),
				transform: expect.any(Number),
				total: expect.any(Number),
			},
		});
	});

	it("logs which stage failed, then rethrows the original error", () => {
		const { logger, calls } = fakeLogger();
		const failure = new Error("parser exploded");
		const parser: Parser = {
			parse: () => {
				throw failure;
			},
		};

		expect(() =>
			createCodemapGenerator(stubDependencies(fakeDiscovery(["a.ts"]), parser), logger).generateMap(rootDir, {
				exclude: [],
				outDir: rootDir,
			}),
		).toThrow(failure);

		expect(calls.at(-1)).toMatchObject([
			"error",
			"generate failed",
			{ stage: "parse", error: "parser exploded", runId: expect.any(String) },
		]);
	});
});
