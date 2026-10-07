import { filterGraph } from "src/core/filter-graph";
import type {
	CallEdge,
	ClusteredGraph,
	DirectoryNode,
	ExternalNode,
	FileNode,
	ImportEdge,
	PackageNode,
	SymbolNode,
} from "src/core/types";
import { describe, expect, it } from "vitest";

const rootPackage: PackageNode = {
	id: ".",
	kind: "package",
	name: "root",
	language: "typescript",
};
const pkgA: PackageNode = {
	id: "packages/pkg-a",
	kind: "package",
	name: "@fixture/pkg-a",
	language: "typescript",
};
const implDir: DirectoryNode = {
	id: "packages/pkg-a/src",
	kind: "directory",
	name: "src",
};
const implFile: FileNode = {
	id: "packages/pkg-a/src/index.ts",
	kind: "file",
	name: "index.ts",
	extension: "ts",
	language: "typescript",
	moduleId: 0,
	unassignedReason: null,
};
const implWidgetClass: SymbolNode = {
	id: "packages/pkg-a/src/index.ts#Widget",
	kind: "symbol",
	name: "Widget",
	symbolKind: "class",
	startLine: 1,
	endLine: 5,
	exported: true,
};
const implRunFn: SymbolNode = {
	id: "packages/pkg-a/src/index.ts#run",
	kind: "symbol",
	name: "run",
	symbolKind: "function",
	startLine: 7,
	endLine: 9,
	exported: true,
};

const rootFile: FileNode = {
	id: "index.ts",
	kind: "file",
	name: "index.ts",
	extension: "ts",
	language: "typescript",
	moduleId: null,
	unassignedReason: "isolated",
};
const rootFn: SymbolNode = {
	id: "index.ts#main",
	kind: "symbol",
	name: "main",
	symbolKind: "function",
	startLine: 1,
	endLine: 2,
	exported: true,
};

const external: ExternalNode = {
	id: "react",
	kind: "external",
	name: "react",
	version: "18.2.0",
	language: "typescript",
};

const importEdge: ImportEdge = {
	source: "packages/pkg-a/src/index.ts",
	target: "react",
	kind: "static",
	type: "import",
	specifier: "react",
	viaReExport: false,
	locations: [{ startLine: 1, endLine: 1 }],
};

const rootImportEdge: ImportEdge = {
	source: "index.ts",
	target: "react",
	kind: "static",
	type: "import",
	specifier: "react",
	viaReExport: false,
	locations: [{ startLine: 1, endLine: 1 }],
};

const callEdge: CallEdge = {
	source: implRunFn.id,
	target: rootFn.id,
	kind: "static",
	type: "call",
	locations: [{ startLine: 8, endLine: 8 }],
};

const graph: ClusteredGraph = {
	nodes: [rootPackage, pkgA, implDir, implFile, implWidgetClass, implRunFn, rootFile, rootFn, external],
	edges: [importEdge, rootImportEdge, callEdge],
};

describe("filterGraph", () => {
	it("returns the full graph when no filters are provided", () => {
		const result = filterGraph(graph, {});

		expect(result.nodes).toStrictEqual(graph.nodes);
		expect(result.edges).toStrictEqual(graph.edges);
	});

	it("matches a File by exact path", () => {
		const result = filterGraph(graph, { path: "packages/pkg-a/src/index.ts" });

		expect(result.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([implFile.id]));
	});

	it("matches a path prefix/subtree: a Directory id matches its descendant Files/Symbols", () => {
		const result = filterGraph(graph, { path: "packages/pkg-a/src" });
		const ids = result.nodes.map((n) => n.id);

		expect(ids).toContain(implFile.id);
		expect(ids).toContain(implWidgetClass.id);
		expect(ids).toContain(implRunFn.id);
		expect(ids).not.toContain(rootFile.id);
	});

	it("matches a Symbol whose owning File's path exactly equals the path filter", () => {
		const result = filterGraph(graph, { path: "packages/pkg-a/src/index.ts" });
		const symbolNodes = result.nodes.filter((n) => n.kind === "symbol");

		expect(symbolNodes.map((n) => n.id)).toStrictEqual([implWidgetClass.id, implRunFn.id]);
	});

	it("matches a Package id against every descendant under it", () => {
		const result = filterGraph(graph, { path: "packages/pkg-a" });
		const ids = result.nodes.map((n) => n.id);

		expect(ids).toContain(implFile.id);
		expect(ids).toContain(implWidgetClass.id);
	});

	it("filters symbolKind to only Symbol nodes of that kind", () => {
		const result = filterGraph(graph, { symbolKind: "class" });
		const symbolNodes = result.nodes.filter((n) => n.kind === "symbol");

		expect(symbolNodes.map((n) => n.id)).toStrictEqual([implWidgetClass.id]);
	});

	it("filters search by a case-insensitive name substring", () => {
		const result = filterGraph(graph, { search: "widget" });
		const symbolNodes = result.nodes.filter((n) => n.kind === "symbol");

		expect(symbolNodes.map((n) => n.id)).toStrictEqual([implWidgetClass.id]);
	});

	it("ANDs path + symbolKind together", () => {
		const result = filterGraph(graph, {
			path: "packages/pkg-a",
			symbolKind: "function",
		});
		const symbolNodes = result.nodes.filter((n) => n.kind === "symbol");

		expect(symbolNodes.map((n) => n.id)).toStrictEqual([implRunFn.id]);
	});

	it("ANDs path + search together", () => {
		const result = filterGraph(graph, {
			path: "packages/pkg-a",
			search: "run",
		});
		const symbolNodes = result.nodes.filter((n) => n.kind === "symbol");

		expect(symbolNodes.map((n) => n.id)).toStrictEqual([implRunFn.id]);
	});

	it("ANDs path + symbolKind + search together", () => {
		const matchAll = filterGraph(graph, {
			path: "packages/pkg-a",
			symbolKind: "function",
			search: "run",
		});
		expect(matchAll.nodes.filter((n) => n.kind === "symbol").map((n) => n.id)).toStrictEqual([implRunFn.id]);

		const matchNone = filterGraph(graph, {
			path: "packages/pkg-a",
			symbolKind: "class",
			search: "run",
		});
		expect(matchNone.nodes.filter((n) => n.kind === "symbol")).toStrictEqual([]);
	});

	it("includes a matched Symbol's ancestor Cluster chain even when the ancestors don't themselves match", () => {
		const result = filterGraph(graph, { search: "widget" });
		const ids = result.nodes.map((n) => n.id);

		expect(ids).toContain(implFile.id);
		expect(ids).toContain(implDir.id);
		expect(ids).toContain(pkgA.id);
	});

	it("includes only the ancestor chain up to the owning Package, not the unrelated repo-root Package", () => {
		const result = filterGraph(graph, { search: "widget" });
		const ids = result.nodes.map((n) => n.id);

		expect(ids).not.toContain(rootPackage.id);
	});

	it("falls back to the repo-root Package for a File with no intermediate Directory", () => {
		const result = filterGraph(graph, { path: "index.ts" });
		const ids = result.nodes.map((n) => n.id);

		expect(ids).toContain(rootFile.id);
		expect(ids).toContain(rootPackage.id);
	});

	it("includes an edge once both its endpoints are pulled into the resulting node set", () => {
		const result = filterGraph(graph, { symbolKind: "function" });

		expect(result.edges).toStrictEqual([callEdge]);
	});

	it("excludes an edge whose non-matching endpoint (an External, never pulled in by ancestor expansion) isn't in the resulting node set", () => {
		const result = filterGraph(graph, { path: "packages/pkg-a" });

		expect(result.edges).toStrictEqual([]);
	});

	it("excludes an External node entirely when it isn't itself a match and isn't both edge endpoints", () => {
		const result = filterGraph(graph, { path: "index.ts" });

		expect(result.nodes.map((n) => n.id)).not.toContain(external.id);
		expect(result.edges).toStrictEqual([]);
	});
});

describe("filterGraph over co-located `<dir>@<family>` Package ids", () => {
	const goPackage: PackageNode = {
		id: ".@go",
		kind: "package",
		name: "example.com/poly",
		language: "go",
	};
	const npmPackage: PackageNode = {
		id: ".@npm",
		kind: "package",
		name: "poly",
		language: "typescript",
	};
	const goDir: DirectoryNode = { id: "goa", kind: "directory", name: "goa" };
	const webDir: DirectoryNode = { id: "web", kind: "directory", name: "web" };
	const goFile: FileNode = {
		id: "goa/a1.go",
		kind: "file",
		name: "a1.go",
		extension: "go",
		language: "go",
		moduleId: 0,
		unassignedReason: null,
	};
	const goSymbol: SymbolNode = {
		id: "goa/a1.go#HelperA",
		kind: "symbol",
		name: "HelperA",
		symbolKind: "function",
		startLine: 1,
		endLine: 3,
		exported: true,
	};
	const jsFile: FileNode = {
		id: "web/app.js",
		kind: "file",
		name: "app.js",
		extension: "js",
		language: "javascript",
		moduleId: 1,
		unassignedReason: null,
	};
	const polyglot: ClusteredGraph = {
		nodes: [goPackage, npmPackage, goDir, webDir, goFile, goSymbol, jsFile],
		edges: [],
	};

	it("matches every descendant of a family-qualified Package, and only that family's files", () => {
		const ids = filterGraph(polyglot, { path: ".@go" }).nodes.map((n) => n.id);

		expect(ids).toStrictEqual([goPackage.id, goDir.id, goFile.id, goSymbol.id]);
	});

	it("treats an npm Package as owning both its .ts and .js files", () => {
		const ids = filterGraph(polyglot, { path: ".@npm" }).nodes.map((n) => n.id);

		expect(ids).toStrictEqual([npmPackage.id, webDir.id, jsFile.id]);
	});

	it("pulls in the family-matching owning Package as an ancestor, not the sibling family's", () => {
		const ids = filterGraph(polyglot, { path: "goa" }).nodes.map((n) => n.id);

		expect(ids).toStrictEqual([goPackage.id, goDir.id, goFile.id, goSymbol.id]);
	});

	it("matches the whole repo for the root path '.'", () => {
		const ids = filterGraph(graph, { path: "." }).nodes.map((n) => n.id);

		expect(ids).toStrictEqual(graph.nodes.filter((n) => n.kind !== "external").map((n) => n.id));
	});
});
