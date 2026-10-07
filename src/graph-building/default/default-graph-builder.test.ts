import type { DiscoveredStructure, ExtractedSymbols } from "src/core/types";
import { DefaultGraphBuilder } from "src/graph-building/default/default-graph-builder";
import { describe, expect, it } from "vitest";

function byId<T extends { id: string }>(nodes: T[]): T[] {
	return [...nodes].sort((a, b) => a.id.localeCompare(b.id));
}

describe("DefaultGraphBuilder", () => {
	it("assembles PackageNode/DirectoryNode/FileNode entries from structure alone", () => {
		const structure: DiscoveredStructure = {
			programFiles: ["src/a.ts", "src/deep/b.tsx"],
			packages: [{ id: ".", name: "root-pkg", language: "typescript" }],
			directories: [
				{ id: "src", packageId: "." },
				{ id: "src/deep", packageId: "." },
			],
			fileOwners: {
				"src/a.ts": { packageId: ".", directoryId: "src" },
				"src/deep/b.tsx": { packageId: ".", directoryId: "src/deep" },
			},
			manifestlessFiles: [],
		};
		const symbols: ExtractedSymbols[] = [
			{ filePath: "src/a.ts", symbols: [], imports: [], calls: [] },
			{ filePath: "src/deep/b.tsx", symbols: [], imports: [], calls: [] },
		];

		const graph = new DefaultGraphBuilder().build(symbols, structure);

		expect(byId(graph.nodes)).toStrictEqual(
			byId([
				{ id: ".", kind: "package", name: "root-pkg", language: "typescript" },
				{ id: "src", kind: "directory", name: "src" },
				{ id: "src/deep", kind: "directory", name: "deep" },
				{
					id: "src/a.ts",
					kind: "file",
					name: "a.ts",
					extension: "ts",
					language: "typescript",
					moduleId: null,
					unassignedReason: null,
				},
				{
					id: "src/deep/b.tsx",
					kind: "file",
					name: "b.tsx",
					extension: "tsx",
					language: "typescript",
					moduleId: null,
					unassignedReason: null,
				},
			]),
		);
		expect(graph.edges).toStrictEqual([]);
	});

	it("assembles SymbolNode entries from symbols alone, ided under their owning FileNode", () => {
		const structure: DiscoveredStructure = {
			programFiles: ["src/a.ts"],
			packages: [{ id: ".", name: "root-pkg", language: "typescript" }],
			directories: [],
			fileOwners: { "src/a.ts": { packageId: ".", directoryId: null } },
			manifestlessFiles: [],
		};
		const symbols: ExtractedSymbols[] = [
			{
				filePath: "src/a.ts",
				imports: [],
				calls: [],
				symbols: [
					{
						localId: "foo",
						name: "foo",
						symbolKind: "function",
						startLine: 1,
						endLine: 3,
						exported: true,
					},
					{
						localId: "foo#2",
						name: "foo",
						symbolKind: "function",
						startLine: 5,
						endLine: 5,
						exported: false,
					},
				],
			},
		];

		const graph = new DefaultGraphBuilder().build(symbols, structure);

		expect(graph.nodes).toContainEqual({
			id: "src/a.ts#foo",
			kind: "symbol",
			name: "foo",
			symbolKind: "function",
			startLine: 1,
			endLine: 3,
			exported: true,
		});
		expect(graph.nodes).toContainEqual({
			id: "src/a.ts#foo#2",
			kind: "symbol",
			name: "foo",
			symbolKind: "function",
			startLine: 5,
			endLine: 5,
			exported: false,
		});
		expect(graph.edges).toStrictEqual([]);
	});

	it("emits every discovered Package unconditionally, even one with no files of its own", () => {
		const structure: DiscoveredStructure = {
			programFiles: [],
			packages: [{ id: ".", name: "empty-root", language: "typescript" }],
			directories: [],
			fileOwners: {},
			manifestlessFiles: [],
		};

		const graph = new DefaultGraphBuilder().build([], structure);

		expect(graph.nodes).toStrictEqual([{ id: ".", kind: "package", name: "empty-root", language: "typescript" }]);
	});

	describe("import edges & External nodes", () => {
		const structure: DiscoveredStructure = {
			programFiles: ["a.ts", "b.ts", "c.ts"],
			packages: [{ id: ".", name: "root-pkg", language: "typescript" }],
			directories: [],
			fileOwners: {
				"a.ts": { packageId: ".", directoryId: null },
				"b.ts": { packageId: ".", directoryId: null },
				"c.ts": { packageId: ".", directoryId: null },
			},
			manifestlessFiles: [],
		};

		it("produces no edge (silently) for an unresolved raw import", () => {
			const symbols: ExtractedSymbols[] = [
				{
					filePath: "a.ts",
					symbols: [],
					calls: [],
					imports: [
						{
							specifier: "./missing",
							viaReExport: false,
							resolvedTarget: { kind: "unresolved" },
							locations: [{ startLine: 1, endLine: 1 }],
						},
					],
				},
			];

			const graph = new DefaultGraphBuilder().build(symbols, structure);

			expect(graph.edges).toStrictEqual([]);
		});

		it("merges raw entries sharing a (source, target) key into one edge with concatenated locations", () => {
			const symbols: ExtractedSymbols[] = [
				{
					filePath: "a.ts",
					symbols: [],
					calls: [],
					imports: [
						{
							specifier: "./b",
							viaReExport: false,
							resolvedTarget: { kind: "file", filePath: "b.ts" },
							locations: [{ startLine: 1, endLine: 1 }],
						},
						{
							specifier: "./b",
							viaReExport: false,
							resolvedTarget: { kind: "file", filePath: "b.ts" },
							locations: [{ startLine: 3, endLine: 3 }],
						},
					],
				},
			];

			const graph = new DefaultGraphBuilder().build(symbols, structure);

			expect(graph.edges).toStrictEqual([
				{
					source: "a.ts",
					target: "b.ts",
					kind: "static",
					type: "import",
					specifier: "./b",
					viaReExport: false,
					locations: [
						{ startLine: 1, endLine: 1 },
						{ startLine: 3, endLine: 3 },
					],
				},
			]);
		});

		it("marks a merged edge viaReExport when any contributing raw entry is a re-export", () => {
			const symbols: ExtractedSymbols[] = [
				{
					filePath: "a.ts",
					symbols: [],
					calls: [],
					imports: [
						{
							specifier: "./b",
							viaReExport: false,
							resolvedTarget: { kind: "file", filePath: "b.ts" },
							locations: [{ startLine: 1, endLine: 1 }],
						},
						{
							specifier: "./b",
							viaReExport: true,
							resolvedTarget: { kind: "file", filePath: "b.ts" },
							locations: [{ startLine: 2, endLine: 2 }],
						},
					],
				},
			];

			const graph = new DefaultGraphBuilder().build(symbols, structure);
			const [edge] = graph.edges;

			expect(edge && "type" in edge && edge.type === "import" && edge.viaReExport).toBe(true);
		});

		it("creates one deduplicated ExternalNode per package, shared across every importing File", () => {
			const symbols: ExtractedSymbols[] = [
				{
					filePath: "a.ts",
					symbols: [],
					calls: [],
					imports: [
						{
							specifier: "left-pad",
							viaReExport: false,
							resolvedTarget: {
								kind: "external",
								packageName: "left-pad",
								version: "1.2.3",
								language: "typescript",
							},
							locations: [{ startLine: 1, endLine: 1 }],
						},
					],
				},
				{
					filePath: "b.ts",
					symbols: [],
					calls: [],
					imports: [
						{
							specifier: "left-pad",
							viaReExport: false,
							resolvedTarget: {
								kind: "external",
								packageName: "left-pad",
								version: "1.2.3",
								language: "typescript",
							},
							locations: [{ startLine: 5, endLine: 5 }],
						},
					],
				},
			];

			const graph = new DefaultGraphBuilder().build(symbols, structure);

			expect(graph.nodes.filter((node) => node.kind === "external")).toStrictEqual([
				{
					id: "left-pad",
					kind: "external",
					name: "left-pad",
					version: "1.2.3",
					language: "typescript",
				},
			]);
			expect([...graph.edges].sort((a, b) => a.source.localeCompare(b.source))).toStrictEqual([
				{
					source: "a.ts",
					target: "left-pad",
					kind: "static",
					type: "import",
					specifier: "left-pad",
					viaReExport: false,
					locations: [{ startLine: 1, endLine: 1 }],
				},
				{
					source: "b.ts",
					target: "left-pad",
					kind: "static",
					type: "import",
					specifier: "left-pad",
					viaReExport: false,
					locations: [{ startLine: 5, endLine: 5 }],
				},
			]);
		});

		// Fixes the version-collision bug recorded in
		// documentation/adr/0021-external-node-version-disambiguation.md: two imports resolving the same
		// package name to genuinely different versions - a real monorepo scenario the extraction spec
		// calls out - used to collapse onto one ExternalNode, silently dropping one version. Each
		// distinct version now gets its own node, disambiguated by a `${packageName}@${version}` id.
		it("creates one ExternalNode per distinct version when two imports resolve the same package name to different versions across a monorepo", () => {
			const symbols: ExtractedSymbols[] = [
				{
					filePath: "a.ts",
					symbols: [],
					calls: [],
					imports: [
						{
							specifier: "left-pad",
							viaReExport: false,
							resolvedTarget: {
								kind: "external",
								packageName: "left-pad",
								version: "1.2.3",
								language: "typescript",
							},
							locations: [{ startLine: 1, endLine: 1 }],
						},
					],
				},
				{
					filePath: "b.ts",
					symbols: [],
					calls: [],
					imports: [
						{
							specifier: "left-pad",
							viaReExport: false,
							resolvedTarget: {
								kind: "external",
								packageName: "left-pad",
								version: "2.0.0",
								language: "typescript",
							},
							locations: [{ startLine: 5, endLine: 5 }],
						},
					],
				},
			];

			const graph = new DefaultGraphBuilder().build(symbols, structure);

			// Both versions survive as distinct nodes, each carrying its own real version - neither is
			// silently dropped in favour of the other.
			expect(
				[...graph.nodes.filter((node) => node.kind === "external")].sort((a, b) => a.id.localeCompare(b.id)),
			).toStrictEqual([
				{
					id: "left-pad@1.2.3",
					kind: "external",
					name: "left-pad",
					version: "1.2.3",
					language: "typescript",
				},
				{
					id: "left-pad@2.0.0",
					kind: "external",
					name: "left-pad",
					version: "2.0.0",
					language: "typescript",
				},
			]);

			// Rerunning on the same input is deterministic.
			const rebuiltGraph = new DefaultGraphBuilder().build(symbols, structure);
			expect(rebuiltGraph.nodes.filter((node) => node.kind === "external")).toStrictEqual(
				graph.nodes.filter((node) => node.kind === "external"),
			);

			// Each importer's edge points at the specific version node it actually resolved.
			expect([...graph.edges].sort((a, b) => a.source.localeCompare(b.source))).toStrictEqual([
				{
					source: "a.ts",
					target: "left-pad@1.2.3",
					kind: "static",
					type: "import",
					specifier: "left-pad",
					viaReExport: false,
					locations: [{ startLine: 1, endLine: 1 }],
				},
				{
					source: "b.ts",
					target: "left-pad@2.0.0",
					kind: "static",
					type: "import",
					specifier: "left-pad",
					viaReExport: false,
					locations: [{ startLine: 5, endLine: 5 }],
				},
			]);
		});
	});

	describe("call edges", () => {
		const structure: DiscoveredStructure = {
			programFiles: ["a.ts", "b.ts", "c.ts"],
			packages: [{ id: ".", name: "root-pkg", language: "typescript" }],
			directories: [],
			fileOwners: {
				"a.ts": { packageId: ".", directoryId: null },
				"b.ts": { packageId: ".", directoryId: null },
				"c.ts": { packageId: ".", directoryId: null },
			},
			manifestlessFiles: [],
		};

		it("fans a multi-candidate RawCall out into one CallEdge per candidate", () => {
			const symbols: ExtractedSymbols[] = [
				{
					filePath: "a.ts",
					symbols: [],
					imports: [],
					calls: [
						{
							callerLocalId: "run",
							candidates: [
								{ filePath: "b.ts", localId: "area" },
								{ filePath: "b.ts", localId: "area#2" },
								{ filePath: "c.ts", localId: "area" },
							],
							locations: [{ startLine: 3, endLine: 3 }],
						},
					],
				},
			];

			const graph = new DefaultGraphBuilder().build(symbols, structure);

			expect([...graph.edges].sort((a, b) => a.target.localeCompare(b.target))).toStrictEqual([
				{
					source: "a.ts#run",
					target: "b.ts#area",
					kind: "static",
					type: "call",
					locations: [{ startLine: 3, endLine: 3 }],
				},
				{
					source: "a.ts#run",
					target: "b.ts#area#2",
					kind: "static",
					type: "call",
					locations: [{ startLine: 3, endLine: 3 }],
				},
				{
					source: "a.ts#run",
					target: "c.ts#area",
					kind: "static",
					type: "call",
					locations: [{ startLine: 3, endLine: 3 }],
				},
			]);
		});

		it("merges same-(source, target) call entries with concatenated locations", () => {
			const symbols: ExtractedSymbols[] = [
				{
					filePath: "a.ts",
					symbols: [],
					imports: [],
					calls: [
						{
							callerLocalId: "run",
							candidates: [{ filePath: "b.ts", localId: "helper" }],
							locations: [{ startLine: 3, endLine: 3 }],
						},
						{
							callerLocalId: "run",
							candidates: [{ filePath: "b.ts", localId: "helper" }],
							locations: [{ startLine: 5, endLine: 5 }],
						},
					],
				},
			];

			const graph = new DefaultGraphBuilder().build(symbols, structure);

			expect(graph.edges).toStrictEqual([
				{
					source: "a.ts#run",
					target: "b.ts#helper",
					kind: "static",
					type: "call",
					locations: [
						{ startLine: 3, endLine: 3 },
						{ startLine: 5, endLine: 5 },
					],
				},
			]);
		});
	});
});
