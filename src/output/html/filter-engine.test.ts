import { type FilterableNode, matchesFilterNode } from "src/output/html/filter-engine";
import { describe, expect, it } from "vitest";

const file: FilterableNode = {
	id: "src/foo.ts",
	kind: "file",
	name: "foo.ts",
	language: "typescript",
};
const nestedFile: FilterableNode = {
	id: "src/nested/bar.ts",
	kind: "file",
	name: "bar.ts",
	language: "typescript",
};
const goFile: FilterableNode = {
	id: "main.go",
	kind: "file",
	name: "main.go",
	language: "go",
};
const symbol: FilterableNode = {
	id: "src/foo.ts#doThing",
	kind: "symbol",
	name: "doThing",
	symbolKind: "function",
};
const otherSymbol: FilterableNode = {
	id: "src/nested/bar.ts#Widget",
	kind: "symbol",
	name: "Widget",
	symbolKind: "class",
};
const nodesById = new Map([file, nestedFile, goFile, symbol, otherSymbol].map((n) => [n.id, n]));

describe("matchesFilterNode", () => {
	it("matches everything when no filters are provided", () => {
		expect(matchesFilterNode(file, {})).toBe(true);
		expect(matchesFilterNode(symbol, {})).toBe(true);
	});

	it("matches a path filter against the node's own id for non-symbols", () => {
		expect(matchesFilterNode(file, { path: "src/foo.ts" })).toBe(true);
		expect(matchesFilterNode(nestedFile, { path: "src" })).toBe(true);
		expect(matchesFilterNode(nestedFile, { path: "src/foo.ts" })).toBe(false);
	});

	it("matches a path filter against a symbol's owning file id, not its own id", () => {
		expect(matchesFilterNode(symbol, { path: "src/foo.ts" })).toBe(true);
		expect(matchesFilterNode(symbol, { path: "src" })).toBe(true);
		expect(matchesFilterNode(otherSymbol, { path: "src/foo.ts" })).toBe(false);
	});

	it("does not treat a path prefix as a match unless it lands on a segment boundary", () => {
		expect(matchesFilterNode(file, { path: "src/fo" })).toBe(false);
	});

	it("matches symbolKind only against Symbol nodes", () => {
		expect(matchesFilterNode(symbol, { symbolKind: "function" })).toBe(true);
		expect(matchesFilterNode(symbol, { symbolKind: "class" })).toBe(false);
		expect(matchesFilterNode(file, { symbolKind: "function" })).toBe(false);
	});

	it("matches language directly against a File/Package/External node's own language", () => {
		expect(matchesFilterNode(file, { language: "typescript" })).toBe(true);
		expect(matchesFilterNode(goFile, { language: "typescript" })).toBe(false);
		expect(matchesFilterNode(goFile, { language: "go" })).toBe(true);
	});

	it("matches language for a Symbol via its owning File's language, given nodesById", () => {
		expect(matchesFilterNode(symbol, { language: "typescript" }, nodesById)).toBe(true);
		expect(matchesFilterNode(symbol, { language: "go" }, nodesById)).toBe(false);
	});

	it("never matches a language filter for a Symbol when nodesById isn't supplied", () => {
		expect(matchesFilterNode(symbol, { language: "typescript" })).toBe(false);
	});

	it("matches search case-insensitively against the node's name", () => {
		expect(matchesFilterNode(symbol, { search: "doth" })).toBe(true);
		expect(matchesFilterNode(symbol, { search: "DOTHING" })).toBe(true);
		expect(matchesFilterNode(symbol, { search: "nope" })).toBe(false);
	});

	it("ANDs path, symbolKind, and search together", () => {
		const filters: Parameters<typeof matchesFilterNode>[1] = {
			path: "src/foo.ts",
			symbolKind: "function",
			search: "doThing",
		};
		expect(matchesFilterNode(symbol, filters)).toBe(true);
		expect(matchesFilterNode(otherSymbol, filters)).toBe(false);
		expect(matchesFilterNode(symbol, { ...filters, symbolKind: "class" })).toBe(false);
		expect(matchesFilterNode(symbol, { ...filters, search: "nope" })).toBe(false);
	});

	it("matches every node for the root path '.'", () => {
		expect(matchesFilterNode(nestedFile, { path: "." })).toBe(true);
		expect(matchesFilterNode(goFile, { path: "." })).toBe(true);
	});

	it("matches a family-qualified Package path only against that family's nodes", () => {
		const goPackage: FilterableNode = {
			id: ".@go",
			kind: "package",
			name: "example.com/poly",
			language: "go",
		};
		const npmPackage: FilterableNode = {
			id: ".@npm",
			kind: "package",
			name: "poly",
			language: "typescript",
		};
		const jsFile: FilterableNode = {
			id: "web/app.js",
			kind: "file",
			name: "app.js",
			language: "javascript",
		};

		expect(matchesFilterNode(goFile, { path: ".@go" })).toBe(true);
		expect(matchesFilterNode(goPackage, { path: ".@go" })).toBe(true);
		expect(matchesFilterNode(nestedFile, { path: ".@go" })).toBe(false);
		expect(matchesFilterNode(npmPackage, { path: ".@go" })).toBe(false);
		expect(matchesFilterNode(jsFile, { path: ".@npm" })).toBe(true);
		expect(matchesFilterNode(symbol, { path: ".@npm" }, nodesById)).toBe(true);
	});
});
