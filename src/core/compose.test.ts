import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModuleDetector } from "src/clustering/module-detector";
import { createDefaultPipeline } from "src/core/compose";
import { createCodemapGenerator } from "src/core/generate-map";
import { createNullLogger } from "src/core/observability/logger";
import type { ClusteredGraph, DiscoveredStructure, ExtractedSymbols, RawGraph } from "src/core/types";
import type { Discovery } from "src/discovery/discovery";
import type { Parser } from "src/extraction/parser";
import type { GraphBuilder } from "src/graph-building/graph-builder";
import type { Transformer } from "src/output/transformer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function writeFile(rootDir: string, relativePath: string, content = ""): void {
	const fullPath = path.join(rootDir, relativePath);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content);
}

describe("createDefaultPipeline", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-compose-"));
		writeFile(rootDir, "package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile(rootDir, "example.ts", "export const example = 1;");
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("wires the real stub implementations together without throwing", () => {
		const generator = createDefaultPipeline();

		const result = generator.generateMap(rootDir, {
			exclude: [],
			outDir: rootDir,
		});

		expect(typeof result.json).toBe("string");
		expect(typeof result.html).toBe("string");
	});

	// codemap-extraction-algorithm ticket 10's own demoable end-to-end requirement: running
	// generate against a small multi-package fixture repo produces correct Package/Directory/File
	// *and* Symbol nodes in codemap.json (zero edges here - this fixture has no imports at all;
	// ticket 11 below covers import/External edges, ticket 12 still covers calls).
	it("produces correct Package/Directory/File/Symbol nodes for a multi-package fixture repo", () => {
		writeFile(rootDir, "src/index.ts", "export const index = 1;");
		writeFile(rootDir, "packages/api/package.json", JSON.stringify({ name: "api-pkg" }));
		writeFile(rootDir, "packages/api/src/handler.ts", "export const handler = 1;");

		const generator = createDefaultPipeline();
		const result = generator.generateMap(rootDir, {
			exclude: [],
			outDir: rootDir,
		});
		const graph = JSON.parse(result.json) as ClusteredGraph;
		const byId = (id: string) => graph.nodes.find((node) => node.id === id);

		expect(byId(".")).toStrictEqual({
			id: ".",
			kind: "package",
			name: "root-pkg",
			language: "typescript",
		});
		expect(byId("packages/api")).toStrictEqual({
			id: "packages/api",
			kind: "package",
			name: "api-pkg",
			language: "typescript",
		});
		expect(byId("src")).toStrictEqual({
			id: "src",
			kind: "directory",
			name: "src",
		});
		expect(byId("packages/api/src")).toStrictEqual({
			id: "packages/api/src",
			kind: "directory",
			name: "src",
		});
		// No import edges anywhere in this fixture, so every file is degree-zero in the import
		// graph LouvainModuleDetector builds - "isolated" per spec.md's classification order.
		expect(byId("example.ts")).toStrictEqual({
			id: "example.ts",
			kind: "file",
			name: "example.ts",
			extension: "ts",
			language: "typescript",
			moduleId: null,
			unassignedReason: "isolated",
		});
		expect(byId("src/index.ts")).toStrictEqual({
			id: "src/index.ts",
			kind: "file",
			name: "index.ts",
			extension: "ts",
			language: "typescript",
			moduleId: null,
			unassignedReason: "isolated",
		});
		expect(byId("packages/api/src/handler.ts")).toStrictEqual({
			id: "packages/api/src/handler.ts",
			kind: "file",
			name: "handler.ts",
			extension: "ts",
			language: "typescript",
			moduleId: null,
			unassignedReason: "isolated",
		});
		expect(byId("example.ts#example")).toStrictEqual({
			id: "example.ts#example",
			kind: "symbol",
			name: "example",
			symbolKind: "const",
			startLine: 1,
			endLine: 1,
			exported: true,
		});
		expect(byId("src/index.ts#index")).toStrictEqual({
			id: "src/index.ts#index",
			kind: "symbol",
			name: "index",
			symbolKind: "const",
			startLine: 1,
			endLine: 1,
			exported: true,
		});
		expect(byId("packages/api/src/handler.ts#handler")).toStrictEqual({
			id: "packages/api/src/handler.ts#handler",
			kind: "symbol",
			name: "handler",
			symbolKind: "const",
			startLine: 1,
			endLine: 1,
			exported: true,
		});
		expect(graph.edges).toStrictEqual([]);
	});

	// codemap-extraction-algorithm ticket 11's own demoable end-to-end requirement: a barrel-file
	// fixture, a multi-package monorepo cross-package import, and an external npm dependency all
	// resolve correctly in codemap.json.
	it("resolves a wildcard-only re-export through with no hop, keeping a named re-export as one", () => {
		writeFile(rootDir, "inner.ts", "export function wildcarded() {}\nexport function named() {}");
		writeFile(rootDir, "barrel.ts", 'export * from "./inner";\nexport { named } from "./inner";');

		const generator = createDefaultPipeline();
		const result = generator.generateMap(rootDir, {
			exclude: [],
			outDir: rootDir,
		});
		const graph = JSON.parse(result.json) as ClusteredGraph;

		expect(graph.edges).toStrictEqual([
			{
				source: "barrel.ts",
				target: "inner.ts",
				kind: "static",
				type: "import",
				specifier: "./inner",
				viaReExport: true,
				locations: [{ startLine: 2, endLine: 2 }],
			},
		]);
	});

	it("resolves a workspace-symlinked cross-package import to a real File node", () => {
		writeFile(rootDir, "packages/pkg-b/package.json", JSON.stringify({ name: "@fixture/pkg-b", version: "1.0.0" }));
		writeFile(rootDir, "packages/pkg-b/index.ts", "export function shared() {}");
		fs.mkdirSync(path.join(rootDir, "node_modules/@fixture"), {
			recursive: true,
		});
		fs.symlinkSync(path.join(rootDir, "packages/pkg-b"), path.join(rootDir, "node_modules/@fixture/pkg-b"), "dir");
		writeFile(rootDir, "main.ts", 'import { shared } from "@fixture/pkg-b";');

		const generator = createDefaultPipeline();
		const result = generator.generateMap(rootDir, {
			exclude: [],
			outDir: rootDir,
		});
		const graph = JSON.parse(result.json) as ClusteredGraph;

		expect(graph.edges).toStrictEqual([
			{
				source: "main.ts",
				target: "packages/pkg-b/index.ts",
				kind: "static",
				type: "import",
				specifier: "@fixture/pkg-b",
				viaReExport: false,
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
		expect(graph.nodes.find((node) => node.id === "packages/pkg-b/index.ts")).toBeTruthy();
		expect(graph.nodes.find((node) => node.kind === "external")).toBeUndefined();
	});

	it("shows an installed npm dependency as an ExternalNode with its real installed version", () => {
		writeFile(rootDir, "node_modules/left-pad/package.json", JSON.stringify({ name: "left-pad", version: "9.9.9" }));
		writeFile(rootDir, "node_modules/left-pad/index.d.ts", "export declare function leftPad(s: string): string;");
		writeFile(rootDir, "main.ts", 'import { leftPad } from "left-pad";');

		const generator = createDefaultPipeline();
		const result = generator.generateMap(rootDir, {
			exclude: [],
			outDir: rootDir,
		});
		const graph = JSON.parse(result.json) as ClusteredGraph;

		expect(graph.nodes.find((node) => node.kind === "external")).toStrictEqual({
			id: "left-pad",
			kind: "external",
			name: "left-pad",
			version: "9.9.9",
			language: "typescript",
		});
		expect(graph.edges).toStrictEqual([
			{
				source: "main.ts",
				target: "left-pad",
				kind: "static",
				type: "import",
				specifier: "left-pad",
				viaReExport: false,
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});
});

// spec.md's Testing Decisions calls for a "Composition-root wiring test... construct the
// orchestrator with fake/stub Parser, GraphBuilder, ModuleDetector, and Transformer
// implementations... assert the final output string is exactly what the fake Transformer
// produced" and explicitly warns that "nothing here should assert on parsing correctness,
// clustering correctness, or rendered output correctness" - unlike every test above, which
// deliberately does assert on those things via the real `createDefaultPipeline()`.
//
// `createDefaultPipeline()` itself takes no parameters, so there's no seam on *that* function to
// inject a fake into - it always wires in the real `TsCompilerApiParser`/`DefaultGraphBuilder`/
// `LouvainModuleDetector`/`JsonTransformer`/`HtmlTransformer`. It does so by delegating straight
// through to `createCodemapGenerator` (`core/generate-map.ts`), the actual seam-accepting
// composition building block `compose.ts` is a thin wrapper over. Exercising that function
// directly, with fakes standing in for every seam, is this file's fake-based wiring coverage.
describe("createCodemapGenerator wiring with fake seams", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-compose-fakes-"));
		writeFile(rootDir, "fake.ts", "export const fake = 1;");
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("returns exactly what the fake Transformer produced, with each seam fed the prior seam's output", () => {
		const fakeStructure: DiscoveredStructure = {
			programFiles: ["fake.ts"],
			packages: [],
			directories: [],
			fileOwners: {},
			manifestlessFiles: [],
		};
		const fakeRawGraph: RawGraph = { nodes: [], edges: [] };
		const fakeClusteredGraph: ClusteredGraph = { nodes: [], edges: [] };

		const discovery: Discovery = { discover: () => fakeStructure };
		const parser: Parser = {
			parse: (_rootDir, _programFiles, extractFiles) =>
				extractFiles.map((filePath) => ({
					filePath,
					symbols: [],
					imports: [],
					calls: [],
				})),
		};

		let graphBuilderReceived: { symbols: ExtractedSymbols[]; structure: DiscoveredStructure } | undefined;
		const graphBuilder: GraphBuilder = {
			build: (symbols, structure) => {
				graphBuilderReceived = { symbols, structure };
				return fakeRawGraph;
			},
		};

		let moduleDetectorReceived: RawGraph | undefined;
		const moduleDetector: ModuleDetector = {
			detect: (graph) => {
				moduleDetectorReceived = graph;
				return fakeClusteredGraph;
			},
		};

		let jsonTransformerReceived: ClusteredGraph | undefined;
		const jsonTransformer: Transformer = {
			transform: (graph) => {
				jsonTransformerReceived = graph;
				return "fake-json-output";
			},
		};
		let htmlTransformerReceived: ClusteredGraph | undefined;
		const htmlTransformer: Transformer = {
			transform: (graph) => {
				htmlTransformerReceived = graph;
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
			exclude: [],
			outDir: rootDir,
		});

		expect(result.json).toBe("fake-json-output");
		expect(result.html).toBe("fake-html-output");
		// Wiring, not business logic: GraphBuilder receives Parser's (path-rewritten) output plus
		// Discovery's structure, ModuleDetector receives GraphBuilder's RawGraph, and both
		// Transformers receive ModuleDetector's ClusteredGraph.
		expect(graphBuilderReceived?.symbols).toStrictEqual([{ filePath: "fake.ts", symbols: [], imports: [], calls: [] }]);
		expect(graphBuilderReceived?.structure).toBe(fakeStructure);
		expect(moduleDetectorReceived).toBe(fakeRawGraph);
		expect(jsonTransformerReceived).toBe(fakeClusteredGraph);
		expect(htmlTransformerReceived).toBe(fakeClusteredGraph);
	});
});
