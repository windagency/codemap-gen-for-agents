import type {
	CallEdge,
	ClusteredGraph,
	DynamicEdgeStub,
	ExternalNode,
	FileNode,
	GraphEdge,
	GraphNode,
	ImportEdge,
	PackageNode,
	SymbolNode,
} from "src/core/types";
import { buildMapJson, SCHEMA_VERSION } from "src/output/json/build-map-json";
import { describe, expect, it } from "vitest";

function graphOf(nodes: GraphNode[], edges: GraphEdge[] = []): ClusteredGraph {
	return { nodes, edges };
}

const packageNode: PackageNode = {
	id: ".",
	kind: "package",
	name: "root",
	language: "typescript",
};
const fileNode: FileNode = {
	id: "src/a.ts",
	kind: "file",
	name: "a.ts",
	extension: "ts",
	language: "typescript",
	moduleId: 0,
	unassignedReason: null,
};
const symbolNode: SymbolNode = {
	id: "src/a.ts#foo",
	kind: "symbol",
	name: "foo",
	symbolKind: "function",
	startLine: 1,
	endLine: 3,
	exported: true,
};
const externalNode: ExternalNode = {
	id: "react",
	kind: "external",
	name: "react",
	version: "18.2.0",
	language: "typescript",
};

describe("buildMapJson", () => {
	it("wraps the graph in the versioned envelope with schemaVersion/nodes/edges/modules/languages/warnings and no other top-level keys", () => {
		const result = buildMapJson(graphOf([packageNode]));

		expect(result).toStrictEqual({
			schemaVersion: SCHEMA_VERSION,
			nodes: [packageNode],
			edges: [],
			modules: [],
			languages: ["typescript"],
			warnings: [],
		});
	});

	it("defaults warnings to an empty array when the caller omits it", () => {
		const result = buildMapJson(graphOf([packageNode]));

		expect(result.warnings).toStrictEqual([]);
	});

	it("carries the caller-supplied warnings through unchanged, in the given order", () => {
		const warnings = ["Skipped manifest-less file: orphan/no-manifest.ts", "Skipped unparseable file: src/broken.ts"];
		const result = buildMapJson(graphOf([packageNode]), warnings);

		expect(result.warnings).toStrictEqual(warnings);
	});

	it("derives languages from every File/Package/External node's own language, deduplicated and sorted", () => {
		const goFile: FileNode = {
			...fileNode,
			id: "main.go",
			extension: "go",
			language: "go",
		};
		const result = buildMapJson(graphOf([packageNode, fileNode, goFile, externalNode]));

		expect(result.languages).toStrictEqual(["go", "typescript"]);
	});

	it("never derives a language from a Directory or Symbol node (neither carries one)", () => {
		const directoryNode = {
			id: "src",
			kind: "directory" as const,
			name: "src",
		};
		const result = buildMapJson(graphOf([directoryNode, symbolNode]));

		expect(result.languages).toStrictEqual([]);
	});

	it("derives a modules array from assigned Files' container folders", () => {
		const node: FileNode = { ...fileNode, id: "src/core/a.ts", moduleId: 0 };
		const result = buildMapJson(graphOf([node]));

		expect(result.modules).toStrictEqual([{ id: 0, name: "core" }]);
	});

	it.each([
		["package", packageNode],
		["directory", { id: "src", kind: "directory" as const, name: "src" }],
		["file", fileNode],
		["symbol", symbolNode],
		["external", externalNode],
	])("passes a %s node through unchanged", (_label, node) => {
		const result = buildMapJson(graphOf([node as GraphNode]));
		expect(result.nodes).toStrictEqual([node]);
	});

	it.each(["isolated", "undersized", "low-embeddedness", "degenerate-partition"] as const)(
		"passes an unassigned File through with unassignedReason %s and moduleId null",
		(unassignedReason) => {
			const node: FileNode = { ...fileNode, moduleId: null, unassignedReason };
			const result = buildMapJson(graphOf([node]));

			expect(result.nodes[0]).toMatchObject({
				moduleId: null,
				unassignedReason,
			});
		},
	);

	it("passes an assigned File through with moduleId set and unassignedReason null", () => {
		const node: FileNode = { ...fileNode, moduleId: 4, unassignedReason: null };
		const result = buildMapJson(graphOf([node]));

		expect(result.nodes[0]).toMatchObject({
			moduleId: 4,
			unassignedReason: null,
		});
	});

	it("passes an import edge through with specifier, viaReExport, and locations intact", () => {
		const edge: ImportEdge = {
			source: "src/a.ts",
			target: "src/b.ts",
			kind: "static",
			type: "import",
			specifier: "./b",
			viaReExport: true,
			locations: [{ startLine: 1, endLine: 1 }],
		};

		const result = buildMapJson(graphOf([], [edge]));
		expect(result.edges).toStrictEqual([edge]);
	});

	it.each([true, false])("passes an import edge through with viaReExport %s", (viaReExport) => {
		const edge: ImportEdge = {
			source: "src/a.ts",
			target: "src/b.ts",
			kind: "static",
			type: "import",
			specifier: "./b",
			viaReExport,
			locations: [],
		};

		const result = buildMapJson(graphOf([], [edge]));
		const resultEdge = result.edges[0];
		expect(resultEdge?.kind === "static" && resultEdge.type === "import" ? resultEdge.viaReExport : undefined).toBe(
			viaReExport,
		);
	});

	it("passes a call edge through unchanged", () => {
		const edge: CallEdge = {
			source: "src/a.ts#foo",
			target: "src/b.ts#bar",
			kind: "static",
			type: "call",
			locations: [{ startLine: 2, endLine: 2 }],
		};

		const result = buildMapJson(graphOf([], [edge]));
		expect(result.edges).toStrictEqual([edge]);
	});

	it("passes a dynamic-stub edge through unchanged", () => {
		const edge: DynamicEdgeStub = {
			source: "src/a.ts",
			target: "src/b.ts",
			kind: "dynamic",
		};

		const result = buildMapJson(graphOf([], [edge]));
		expect(result.edges).toStrictEqual([edge]);
	});

	it("passes multiple CallEdges through for one ambiguous call site (already fanned out upstream)", () => {
		const edges: CallEdge[] = [
			{
				source: "src/a.ts#foo",
				target: "src/b.ts#implA",
				kind: "static",
				type: "call",
				locations: [{ startLine: 5, endLine: 5 }],
			},
			{
				source: "src/a.ts#foo",
				target: "src/b.ts#implB",
				kind: "static",
				type: "call",
				locations: [{ startLine: 5, endLine: 5 }],
			},
		];

		const result = buildMapJson(graphOf([], edges));
		expect(result.edges).toHaveLength(2);
		expect(result.edges.map((edge) => edge.target)).toStrictEqual(["src/b.ts#implA", "src/b.ts#implB"]);
	});

	it("preserves an already-deduplicated edge's multi-entry locations array (dedup itself happens upstream in GraphBuilder)", () => {
		const edge: ImportEdge = {
			source: "src/a.ts",
			target: "src/b.ts",
			kind: "static",
			type: "import",
			specifier: "./b",
			viaReExport: false,
			locations: [
				{ startLine: 1, endLine: 1 },
				{ startLine: 9, endLine: 9 },
			],
		};

		const result = buildMapJson(graphOf([], [edge]));
		const resultEdge = result.edges[0];
		expect(resultEdge?.kind === "static" ? resultEdge.locations : undefined).toStrictEqual(edge.locations);
	});

	it("sorts nodes by id ascending regardless of input order", () => {
		const nodes: GraphNode[] = [symbolNode, externalNode, packageNode, fileNode];
		const result = buildMapJson(graphOf(nodes));

		expect(result.nodes.map((node) => node.id)).toStrictEqual([".", "react", "src/a.ts", "src/a.ts#foo"].sort());
	});

	it("sorts edges by (source, target, kind, type) ascending regardless of input order", () => {
		const callEdge: CallEdge = {
			source: "src/a.ts#foo",
			target: "src/b.ts#bar",
			kind: "static",
			type: "call",
			locations: [],
		};
		const importEdge: ImportEdge = {
			source: "src/a.ts",
			target: "src/b.ts",
			kind: "static",
			type: "import",
			specifier: "./b",
			viaReExport: false,
			locations: [],
		};
		const dynamicEdge: DynamicEdgeStub = {
			source: "src/a.ts",
			target: "src/b.ts",
			kind: "dynamic",
		};

		const result = buildMapJson(graphOf([], [callEdge, importEdge, dynamicEdge]));

		expect(
			result.edges.map((edge) => [edge.source, edge.target, edge.kind, edge.kind === "dynamic" ? "" : edge.type]),
		).toStrictEqual([
			["src/a.ts", "src/b.ts", "dynamic", ""],
			["src/a.ts", "src/b.ts", "static", "import"],
			["src/a.ts#foo", "src/b.ts#bar", "static", "call"],
		]);
	});
});
