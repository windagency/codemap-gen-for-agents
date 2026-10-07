import type { ClusteredGraph, ExternalNode, FileNode, ImportEdge, SymbolNode } from "src/core/types";
import { HtmlTransformer } from "src/output/html/html-transformer";
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

function externalScriptOrLinkTags(html: string): string[] {
	const matches: string[] = [];
	const scriptSrcPattern = /<script\b[^>]*\bsrc\s*=/gi;
	const linkHrefPattern = /<link\b[^>]*\bhref\s*=/gi;
	for (const match of html.matchAll(scriptSrcPattern)) matches.push(match[0]);
	for (const match of html.matchAll(linkHrefPattern)) matches.push(match[0]);
	return matches;
}

describe("HtmlTransformer", () => {
	it("produces HTML with no external <script src>/<link href> (fully offline)", () => {
		const html = new HtmlTransformer().transform(fixtureGraph);

		expect(externalScriptOrLinkTags(html)).toEqual([]);
		expect(html).toContain("<!doctype html>");
	});

	it("vendors a real D3 bundle inline rather than an empty placeholder", () => {
		const html = new HtmlTransformer().transform(fixtureGraph);

		expect(html).toContain("forceSimulation");
		expect(html).toContain("polygonHull");
	});

	it("embeds the same versioned graph envelope the JsonTransformer produces", () => {
		const html = new HtmlTransformer().transform(fixtureGraph);

		expect(html).toContain('"schemaVersion"');
		expect(html).toContain('"a.ts#doThing"');
		expect(html).toContain('"lodash"');
	});

	it("renders both view containers and a shared filter sidebar exactly once", () => {
		const html = new HtmlTransformer().transform(fixtureGraph);

		expect(html).toContain('id="cm-flow-stage"');
		expect(html).toContain('id="cm-force-stage"');
		expect(html.match(/id="cm-filter-path"/g)).toHaveLength(1);
	});

	it("renders a language filter option for every language present in the graph", () => {
		const html = new HtmlTransformer().transform(fixtureGraph);

		expect(html).toContain('id="cm-filter-language"');
		expect(html).toContain('<option value="typescript">typescript</option>');
	});

	it("honors a custom title", () => {
		const html = new HtmlTransformer().transform(fixtureGraph, {
			title: "My Repo",
		});

		expect(html).toContain("<title>My Repo</title>");
	});
});
