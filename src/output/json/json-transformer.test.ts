import type { ClusteredGraph, ExternalNode, FileNode, ImportEdge, SymbolNode } from "src/core/types";
import { buildMapJson } from "src/output/json/build-map-json";
import { JsonTransformer } from "src/output/json/json-transformer";
import { describe, expect, it } from "vitest";

function file(id: string, moduleId: number | null): FileNode {
	return {
		id,
		kind: "file",
		name: id.split("/").pop() ?? id,
		extension: "ts",
		language: "typescript",
		moduleId,
		unassignedReason: moduleId === null ? "isolated" : null,
	};
}

function symbol(fileId: string, name: string): SymbolNode {
	return {
		id: `${fileId}#${name}`,
		kind: "symbol",
		name,
		symbolKind: "function",
		startLine: 1,
		endLine: 2,
		exported: true,
	};
}

function importEdge(source: string, target: string): ImportEdge {
	return {
		source,
		target,
		kind: "static",
		type: "import",
		specifier: `./${target}`,
		viaReExport: false,
		locations: [{ startLine: 1, endLine: 1 }],
	};
}

const externalNode: ExternalNode = {
	id: "lodash",
	kind: "external",
	name: "lodash",
	version: "4.17.21",
	language: "typescript",
};

const fixtureGraph: ClusteredGraph = {
	nodes: [file("a.ts", 0), file("b.ts", 0), file("c.ts", 1), symbol("a.ts", "doThing"), externalNode],
	edges: [
		importEdge("a.ts", "b.ts"),
		importEdge("b.ts", "c.ts"),
		importEdge("c.ts", "a.ts"),
		importEdge("a.ts", "lodash"),
	],
};

describe("JsonTransformer", () => {
	it("produces a JSON string that round-trips to the same shape buildMapJson produces", () => {
		const json = new JsonTransformer().transform(fixtureGraph);

		expect(() => JSON.parse(json)).not.toThrow();
		expect(JSON.parse(json)).toStrictEqual(buildMapJson(fixtureGraph));
	});

	it("ignores TransformOptions.title (HTML-only option) without leaking it into the output or throwing", () => {
		const json = new JsonTransformer().transform(fixtureGraph, {
			title: "My Repo",
		});

		expect(() => JSON.parse(json)).not.toThrow();
		expect(JSON.parse(json)).toStrictEqual(buildMapJson(fixtureGraph));
		expect(json).not.toContain("My Repo");
	});

	it("threads TransformOptions.warnings into the envelope's own warnings field", () => {
		const warnings = ["Skipped unparseable file: src/broken.ts"];
		const json = new JsonTransformer().transform(fixtureGraph, { warnings });

		expect(JSON.parse(json)).toStrictEqual(buildMapJson(fixtureGraph, warnings));
	});

	it("defaults to an empty warnings array when TransformOptions omits it", () => {
		const json = new JsonTransformer().transform(fixtureGraph);

		expect((JSON.parse(json) as { warnings: string[] }).warnings).toStrictEqual([]);
	});
});
