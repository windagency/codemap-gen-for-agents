import { computeImportChain, type ImportChainEdge } from "src/output/html/import-chain";
import { describe, expect, it } from "vitest";

describe("computeImportChain", () => {
	it("walks a simple chain in BFS order starting from the clicked file", () => {
		const edges: ImportChainEdge[] = [
			{ source: "a.ts", target: "b.ts", specifier: "./b" },
			{ source: "b.ts", target: "c.ts", specifier: "./c" },
		];

		const result = computeImportChain("a.ts", edges);

		expect(result.visitedOrder).toEqual(["a.ts", "b.ts", "c.ts"]);
		expect(result.edgeOrder).toEqual(edges);
	});

	it("visits siblings breadth-first before descending further", () => {
		const edges: ImportChainEdge[] = [
			{ source: "a.ts", target: "b.ts", specifier: "./b" },
			{ source: "a.ts", target: "c.ts", specifier: "./c" },
			{ source: "b.ts", target: "d.ts", specifier: "./d" },
		];

		const result = computeImportChain("a.ts", edges);

		expect(result.visitedOrder).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
	});

	it("terminates on a real import cycle, visiting and numbering each node exactly once", () => {
		const edges: ImportChainEdge[] = [
			{ source: "a.ts", target: "b.ts", specifier: "./b" },
			{ source: "b.ts", target: "c.ts", specifier: "./c" },
			{ source: "c.ts", target: "a.ts", specifier: "./a" },
		];

		const result = computeImportChain("a.ts", edges);

		expect(result.visitedOrder).toEqual(["a.ts", "b.ts", "c.ts"]);
		expect(result.edgeOrder).toHaveLength(2);
		expect(new Set(result.visitedOrder).size).toBe(result.visitedOrder.length);
	});

	it("ignores unrelated edges elsewhere in the graph", () => {
		const edges: ImportChainEdge[] = [
			{ source: "a.ts", target: "b.ts", specifier: "./b" },
			{ source: "x.ts", target: "y.ts", specifier: "./y" },
		];

		const result = computeImportChain("a.ts", edges);

		expect(result.visitedOrder).toEqual(["a.ts", "b.ts"]);
	});

	it("returns just the start node when it has no outgoing imports", () => {
		const result = computeImportChain("solo.ts", []);

		expect(result.visitedOrder).toEqual(["solo.ts"]);
		expect(result.edgeOrder).toEqual([]);
	});
});
