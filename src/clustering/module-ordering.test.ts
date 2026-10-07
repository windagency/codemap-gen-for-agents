import type { ModuleSummary } from "src/clustering/module-naming";
import { orderModulesByExecutionFlow } from "src/clustering/module-ordering";
import type { FileNode, GraphNode, ImportEdge } from "src/core/types";
import { describe, expect, it } from "vitest";

function file(id: string, moduleId: number): FileNode {
	return {
		id,
		kind: "file",
		name: id,
		extension: "ts",
		language: "typescript",
		moduleId,
		unassignedReason: null,
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

function names(modules: ModuleSummary[]): string[] {
	return modules.map((module) => module.name);
}

describe("orderModulesByExecutionFlow", () => {
	it("lists a Module before another Module that imports from it", () => {
		// Names deliberately sort the *opposite* way from the required order ("aaa-..." < "zzz-...")
		// so this only passes if the dependency edge actually drives the order, not the alphabetical
		// fallback coincidentally agreeing with it.
		const nodes: GraphNode[] = [file("aaa-consumer/a", 1), file("zzz-base/b", 0)];
		const edges: ImportEdge[] = [importEdge("aaa-consumer/a", "zzz-base/b")];
		const modules: ModuleSummary[] = [
			{ id: 1, name: "aaa-consumer" },
			{ id: 0, name: "zzz-base" },
		];

		expect(names(orderModulesByExecutionFlow(modules, nodes, edges))).toStrictEqual(["zzz-base", "aaa-consumer"]);
	});

	it("orders a three-Module dependency chain fully", () => {
		// Names sort alphabetically in the reverse of the required topological order, for the same
		// reason as above.
		const nodes: GraphNode[] = [file("aaa-top/a", 2), file("mmm-middle/b", 1), file("zzz-base/c", 0)];
		const edges: ImportEdge[] = [importEdge("aaa-top/a", "mmm-middle/b"), importEdge("mmm-middle/b", "zzz-base/c")];
		const modules: ModuleSummary[] = [
			{ id: 2, name: "aaa-top" },
			{ id: 1, name: "mmm-middle" },
			{ id: 0, name: "zzz-base" },
		];

		expect(names(orderModulesByExecutionFlow(modules, nodes, edges))).toStrictEqual([
			"zzz-base",
			"mmm-middle",
			"aaa-top",
		]);
	});

	it("breaks a tie between two Modules with no dependency between them alphabetically by name", () => {
		const nodes: GraphNode[] = [file("zebra/a", 1), file("apple/b", 0)];
		const modules: ModuleSummary[] = [
			{ id: 1, name: "zebra" },
			{ id: 0, name: "apple" },
		];

		expect(names(orderModulesByExecutionFlow(modules, nodes, []))).toStrictEqual(["apple", "zebra"]);
	});

	it("breaks a dependency cycle deterministically instead of looping forever", () => {
		const nodes: GraphNode[] = [file("zebra/a", 1), file("apple/b", 0)];
		const edges: ImportEdge[] = [importEdge("zebra/a", "apple/b"), importEdge("apple/b", "zebra/a")];
		const modules: ModuleSummary[] = [
			{ id: 1, name: "zebra" },
			{ id: 0, name: "apple" },
		];

		const ordered = orderModulesByExecutionFlow(modules, nodes, edges);

		expect(names(ordered)).toStrictEqual(["apple", "zebra"]);
		expect(ordered).toHaveLength(2);
	});

	it("collapses a composition root and its mutually-dependent satellites into one alphabetically-ordered block, placed before a one-directional consumer", () => {
		// Mirrors this codebase's own `core/` (shared types flow out to several Modules, which it
		// then wires concrete implementations back in from) and `integration/` (which only ever
		// imports from `core/`, never the reverse). Names are deliberately *not* alphabetical in the
		// "obvious" foundational-first order, so this only passes if the cycle is genuinely resolved
		// by alphabetical sort, not by coincidentally matching some other ordering.
		const nodes: GraphNode[] = [
			file("zzz-core/a", 0),
			file("aaa-sat1/a", 1),
			file("bbb-sat2/a", 2),
			file("consumer/a", 3),
		];
		const edges: ImportEdge[] = [
			importEdge("zzz-core/a", "aaa-sat1/a"),
			importEdge("aaa-sat1/a", "zzz-core/a"),
			importEdge("zzz-core/a", "bbb-sat2/a"),
			importEdge("bbb-sat2/a", "zzz-core/a"),
			importEdge("consumer/a", "zzz-core/a"),
		];
		const modules: ModuleSummary[] = [
			{ id: 0, name: "zzz-core" },
			{ id: 1, name: "aaa-sat1" },
			{ id: 2, name: "bbb-sat2" },
			{ id: 3, name: "consumer" },
		];

		expect(names(orderModulesByExecutionFlow(modules, nodes, edges))).toStrictEqual([
			"aaa-sat1",
			"bbb-sat2",
			"zzz-core",
			"consumer",
		]);
	});

	it("ignores an edge between files in the same Module - it carries no ordering information", () => {
		const nodes: GraphNode[] = [file("a/one", 0), file("a/two", 0), file("b/x", 1)];
		const edges: ImportEdge[] = [importEdge("a/one", "a/two")];
		const modules: ModuleSummary[] = [
			{ id: 0, name: "a" },
			{ id: 1, name: "b" },
		];

		expect(names(orderModulesByExecutionFlow(modules, nodes, edges))).toStrictEqual(["a", "b"]);
	});

	it("ignores an edge touching a file with no Module assigned", () => {
		const unassigned: FileNode = {
			id: "stray/x",
			kind: "file",
			name: "stray/x",
			extension: "ts",
			language: "typescript",
			moduleId: null,
			unassignedReason: "isolated",
		};
		const nodes: GraphNode[] = [file("consumer/a", 1), file("base/b", 0), unassigned];
		const edges: ImportEdge[] = [importEdge("stray/x", "consumer/a")];
		const modules: ModuleSummary[] = [
			{ id: 1, name: "consumer" },
			{ id: 0, name: "base" },
		];

		// No edge connects "consumer" and "base" at all (the only edge touches the unassigned file),
		// so this falls back to the alphabetical tie-break, same as the no-edges case.
		expect(names(orderModulesByExecutionFlow(modules, nodes, edges))).toStrictEqual(["base", "consumer"]);
	});

	it("returns an empty array for an empty modules list", () => {
		expect(orderModulesByExecutionFlow([], [], [])).toStrictEqual([]);
	});
});
