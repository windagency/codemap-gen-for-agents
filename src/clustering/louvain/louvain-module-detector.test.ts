import { LouvainModuleDetector } from "src/clustering/louvain/louvain-module-detector";
import type { FileNode, GraphNode, ImportEdge, PackageNode, RawGraph } from "src/core/types";
import { describe, expect, it } from "vitest";

function file(id: string): FileNode {
	return {
		id,
		kind: "file",
		name: id,
		extension: "ts",
		language: "typescript",
		moduleId: null,
		unassignedReason: null,
	};
}

function packageNode(id: string, name: string): PackageNode {
	return { id, kind: "package", name, language: "typescript" };
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

function triangle(a: string, b: string, c: string): ImportEdge[] {
	return [importEdge(a, b), importEdge(b, c), importEdge(a, c)];
}

// Every unordered pair of distinct ids - used by the documentation/adr/0051 tests below to fully connect a
// "hub" group without tripping `noUncheckedIndexedAccess` on a plain indexed loop.
function allPairs(ids: string[]): [string, string][] {
	const pairs: [string, string][] = [];
	for (let i = 0; i < ids.length; i++) {
		for (let j = i + 1; j < ids.length; j++) {
			const a = ids[i];
			const b = ids[j];
			if (a !== undefined && b !== undefined) pairs.push([a, b]);
		}
	}
	return pairs;
}

// Each id paired with the next one in order - a simple path, weaker than `allPairs`' full mesh.
function sequentialPairs(ids: string[]): [string, string][] {
	const pairs: [string, string][] = [];
	for (let i = 0; i + 1 < ids.length; i++) {
		const a = ids[i];
		const b = ids[i + 1];
		if (a !== undefined && b !== undefined) pairs.push([a, b]);
	}
	return pairs;
}

function fileNodesById(nodes: GraphNode[]): Map<string, FileNode> {
	return new Map(nodes.filter((node): node is FileNode => node.kind === "file").map((node) => [node.id, node]));
}

describe("LouvainModuleDetector", () => {
	it("marks a file with zero import edges unassigned as isolated", () => {
		const graph: RawGraph = {
			nodes: ["a1", "a2", "a3", "b1", "b2", "b3", "g"].map(file),
			edges: [...triangle("a1", "a2", "a3"), ...triangle("b1", "b2", "b3")],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const isolated = fileNodesById(result.nodes).get("g");

		expect(isolated).toMatchObject({
			moduleId: null,
			unassignedReason: "isolated",
		});
	});

	it("assigns a fully-embedded 2-file community rather than treating it as undersized (documentation/adr/0015)", () => {
		// "x" and "y" only ever import each other, forming their own tiny, fully-embedded
		// (ratio 1.0) community distinct from the two triangles below - a genuine, if small, domain
		// (mirroring this codebase's own `integration/cli/` and `integration/skill/`, each just an
		// entrypoint plus one adapter file) rather than noise the size floor should filter out.
		const graph: RawGraph = {
			nodes: ["a1", "a2", "a3", "b1", "b2", "b3", "x", "y"].map(file),
			edges: [...triangle("a1", "a2", "a3"), ...triangle("b1", "b2", "b3"), importEdge("x", "y")],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		expect(byId.get("x")?.unassignedReason).toBeNull();
		expect(byId.get("y")?.unassignedReason).toBeNull();
		expect(byId.get("x")?.moduleId).not.toBeNull();
		expect(byId.get("x")?.moduleId).toBe(byId.get("y")?.moduleId);
	});

	it("marks a file whose embeddedness in its own community is below 0.5 as low-embeddedness", () => {
		// "h" bridges into four separate triangles with exactly one edge each: whichever triangle
		// Louvain merges it into, at most 1 of its 4 edges is internal (embeddedness <= 0.25).
		const graph: RawGraph = {
			nodes: ["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3", "d1", "d2", "d3", "h"].map(file),
			edges: [
				...triangle("a1", "a2", "a3"),
				...triangle("b1", "b2", "b3"),
				...triangle("c1", "c2", "c3"),
				...triangle("d1", "d2", "d3"),
				importEdge("h", "a1"),
				importEdge("h", "b1"),
				importEdge("h", "c1"),
				importEdge("h", "d1"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const h = fileNodesById(result.nodes).get("h");

		expect(h).toMatchObject({
			moduleId: null,
			unassignedReason: "low-embeddedness",
		});
	});

	it("assigns a folder-embedded bridge file even though most of its raw edges leave its community", () => {
		// "domainA/h" is a composition-root-shaped file: 3 folder-proximate edges into its own
		// domainA triangle (weight 3^1=3 each, total 9) plus 4 raw edges out to four unrelated
		// triangles it wires together (weight 1 each, no shared folder, total 4). Unweighted
		// embeddedness is 3/7 (< 0.5, low-embeddedness) - but weighted by the same folder-proximity
		// signal that put it in domainA's community in the first place (documentation/adr/0007), its
		// embeddedness is 9/13 (> 0.5), matching a real composition-root file that imports from
		// everywhere but structurally belongs with its own folder (documentation/adr/0014).
		const graph: RawGraph = {
			nodes: [
				"domainA/a1",
				"domainA/a2",
				"domainA/a3",
				"domainA/h",
				"b1",
				"b2",
				"b3",
				"c1",
				"c2",
				"c3",
				"d1",
				"d2",
				"d3",
				"e1",
				"e2",
				"e3",
			].map(file),
			edges: [
				...triangle("domainA/a1", "domainA/a2", "domainA/a3"),
				...triangle("b1", "b2", "b3"),
				...triangle("c1", "c2", "c3"),
				...triangle("d1", "d2", "d3"),
				...triangle("e1", "e2", "e3"),
				importEdge("domainA/h", "domainA/a1"),
				importEdge("domainA/h", "domainA/a2"),
				importEdge("domainA/h", "domainA/a3"),
				importEdge("domainA/h", "b1"),
				importEdge("domainA/h", "c1"),
				importEdge("domainA/h", "d1"),
				importEdge("domainA/h", "e1"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		expect(byId.get("domainA/h")).toMatchObject({
			moduleId: byId.get("domainA/a1")?.moduleId,
			unassignedReason: null,
		});
	});

	it("keeps a directory imported identically by several sibling directories in its own community, not merged into just one of them (documentation/adr/0036)", () => {
		// "extraction/common/x" and "extraction/common/y" are imported the same way by three sibling
		// directories (langA, langB, langC) - mirroring this codebase's own tree-sitter-common serving
		// tree-sitter-go/-java/-python/-rust identically. Each cross-directory edge into common has a
		// raw folder-proximity weight of 3 (one shared segment, "extraction") before dilution; diluted
		// by a fan-in of 3 (three distinct external directories import each common file), it drops to
		// the pre-ADR-0007 floor of 1 - far weaker than any sibling's own internal weight-9 edges
		// (two shared segments) or common's own internal weight-9 edge to itself. Without that
		// dilution, common would arbitrarily land in whichever one sibling Louvain's tie-breaking
		// happened to favour, same as every sibling pulls on it identically.
		function sibling(lang: string) {
			const dir = `extraction/${lang}`;
			return {
				entryFile: `${dir}/a`,
				files: [`${dir}/a`, `${dir}/b`, `${dir}/c`],
				edges: [
					importEdge(`${dir}/a`, `${dir}/b`),
					importEdge(`${dir}/b`, `${dir}/c`),
					importEdge(`${dir}/a`, `${dir}/c`),
					importEdge(`${dir}/a`, "extraction/common/x"),
					importEdge(`${dir}/b`, "extraction/common/y"),
				],
			};
		}
		const siblings = ["langA", "langB", "langC"].map(sibling);

		const graph: RawGraph = {
			nodes: ["extraction/common/x", "extraction/common/y", ...siblings.flatMap((s) => s.files)].map(file),
			edges: [importEdge("extraction/common/x", "extraction/common/y"), ...siblings.flatMap((s) => s.edges)],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		const commonModuleIds = new Set(["extraction/common/x", "extraction/common/y"].map((id) => byId.get(id)?.moduleId));
		const siblingModuleIds = siblings.map((s) => byId.get(s.entryFile)?.moduleId);

		expect(commonModuleIds.size).toBe(1);
		expect(siblingModuleIds.every((id) => id !== null && id !== undefined && !commonModuleIds.has(id))).toBe(true);
		expect(new Set(siblingModuleIds).size).toBe(siblingModuleIds.length);
	});

	it("keeps a dispatcher that fans out to one file in each of several sibling directories out of any single one of them (documentation/adr/0037)", () => {
		// "dispatch/factory" imports exactly one file from each of three sibling directories -
		// mirroring this codebase's own parser-factory.ts importing one concrete parser file from
		// every tree-sitter-<language> directory alike. Each target is privately used only by the
		// dispatcher (fan-IN of 1, so documentation/adr/0036's fan-in-only rule wouldn't dilute these edges) -
		// but the dispatcher's own fan-OUT (three distinct sibling directories) should dilute them the
		// same way, so it doesn't arbitrarily land in just one of them. "dispatch/interface" is the
		// dispatcher's same-directory anchor (its own undiluted edge, mirroring parser-factory.ts's
		// bond with parser.ts), giving it somewhere real to belong instead.
		function sibling(lang: string) {
			const dir = `dispatch/${lang}`;
			return {
				entryFile: `${dir}/impl`,
				files: [`${dir}/impl`, `${dir}/helper`],
				edges: [importEdge(`${dir}/impl`, `${dir}/helper`), importEdge("dispatch/factory", `${dir}/impl`)],
			};
		}
		const siblings = ["langA", "langB", "langC"].map(sibling);

		const graph: RawGraph = {
			nodes: ["dispatch/factory", "dispatch/interface", ...siblings.flatMap((s) => s.files)].map(file),
			edges: [importEdge("dispatch/factory", "dispatch/interface"), ...siblings.flatMap((s) => s.edges)],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		const dispatcherModuleIds = new Set(["dispatch/factory", "dispatch/interface"].map((id) => byId.get(id)?.moduleId));
		const siblingModuleIds = siblings.map((s) => byId.get(s.entryFile)?.moduleId);

		expect(dispatcherModuleIds.size).toBe(1);
		expect(siblingModuleIds.every((id) => id !== null && id !== undefined && !dispatcherModuleIds.has(id))).toBe(true);
		expect(new Set(siblingModuleIds).size).toBe(siblingModuleIds.length);
	});

	it("never leaves a single directory's production files split across more than one Module (documentation/adr/0038)", () => {
		// "core/main1"/"core/main2" only ever import each other, forming their own fully-embedded
		// community - but "core/bridge" has no edge to either of them, only to two of the three files
		// in an unrelated "other/" triangle, so Louvain puts it in *that* community instead. Left
		// alone, "core/" would come out split across two Modules even though every one of its files
		// voted the same way about which directory they live in - this is exactly the shape of this
		// codebase's own `core/test-file.ts` (pulled toward `clustering/` while the rest of `core/`
		// stayed put).
		const graph: RawGraph = {
			nodes: ["core/main1", "core/main2", "core/bridge", "other/x", "other/y", "other/z"].map(file),
			edges: [
				importEdge("core/main1", "core/main2"),
				...triangle("other/x", "other/y", "other/z"),
				importEdge("core/bridge", "other/x"),
				importEdge("core/bridge", "other/y"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		const coreModuleIds = new Set(["core/main1", "core/main2", "core/bridge"].map((id) => byId.get(id)?.moduleId));
		expect(coreModuleIds.size).toBe(1);
		expect([...coreModuleIds][0]).not.toBeNull();

		// "other/" wasn't itself fragmented, so it's untouched: still its own distinct Module.
		const otherModuleIds = new Set(["other/x", "other/y", "other/z"].map((id) => byId.get(id)?.moduleId));
		expect(otherModuleIds.size).toBe(1);
		expect(otherModuleIds).not.toStrictEqual(coreModuleIds);
	});

	it("leaves a directory alone when its files are tied 1-vs-1 between two otherwise-unrelated Modules, rather than forcing an arbitrary merge (documentation/adr/0040)", () => {
		// "root/a" and "root/b" share a directory but have no edge to each other at all - each is
		// instead fully embedded in its own, separate, single-partner community. There's no majority
		// here, just two individuals - mirrors `dude-where-is-my-cli`'s own `src/bin.ts` and
		// `src/index.ts`, which this fix was written for: forcing them together would have destroyed
		// `bin.ts`'s real, fully-embedded pairing with its one actual dependency for no real gain.
		const graph: RawGraph = {
			nodes: ["root/a", "root/b", "partner1/x", "partner2/y"].map(file),
			edges: [importEdge("root/a", "partner1/x"), importEdge("root/b", "partner2/y")],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		const moduleIdOf = (id: string) => byId.get(id)?.moduleId;

		expect(moduleIdOf("root/a")).not.toBeNull();
		expect(moduleIdOf("root/b")).not.toBeNull();
		expect(moduleIdOf("root/a")).toBe(moduleIdOf("partner1/x"));
		expect(moduleIdOf("root/b")).toBe(moduleIdOf("partner2/y"));
		expect(moduleIdOf("root/a")).not.toBe(moduleIdOf("root/b"));
	});

	it("forces a deterministic winner when a directory is tied between two substantial groups, not just individuals (documentation/adr/0053)", () => {
		// "root/a1"+"root/a2" and "root/b1"+"root/b2" are each their own fully-embedded 3-file
		// community (with "partner1/x" and "partner2/y" respectively) - a 2-vs-2 tie for "root/", not
		// documentation/adr/0040's "two individuals" shape (each tied side holds more than one file here).
		// Forcing a winner doesn't strip anything of its only partner the way documentation/adr/0040's
		// 1-vs-1 case would: both sides already have real internal cohesion independent of this vote.
		const graph: RawGraph = {
			nodes: ["root/a1", "root/a2", "partner1/x", "root/b1", "root/b2", "partner2/y"].map(file),
			edges: [...triangle("root/a1", "root/a2", "partner1/x"), ...triangle("root/b1", "root/b2", "partner2/y")],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		const moduleIdOf = (id: string) => byId.get(id)?.moduleId;
		const rootModuleIds = new Set(["root/a1", "root/a2", "root/b1", "root/b2"].map(moduleIdOf));

		// Every "root/" file - from both formerly-separate sides - ends up in the exact same Module.
		expect(rootModuleIds.size).toBe(1);
		expect([...rootModuleIds][0]).not.toBeNull();

		// Whichever side didn't win keeps its own outside partner in that same winning Module (the
		// directory vote only ever moves "root/"'s own files, never partner1/partner2's); the losing
		// side's partner is left alone with no community-mate of its own, unassigned as undersized -
		// the same cascade documentation/adr/0040's own second test already established for a genuine majority,
		// now also reachable via this tie-break.
		const winningModuleId = [...rootModuleIds][0];
		const strandedPartner =
			moduleIdOf("partner1/x") === winningModuleId ? byId.get("partner2/y") : byId.get("partner1/x");
		expect(strandedPartner).toMatchObject({ moduleId: null, unassignedReason: "undersized" });
	});

	it("unassigns a file whose only community-mate was reconciled away to satisfy a different directory's genuine majority (documentation/adr/0040)", () => {
		// "entry/a" is fully embedded with "partner/helper" alone - its one real community. Separately,
		// "partner/b1" and "partner/b2" form their own fully-embedded pair. "partner/"'s directory vote
		// is then a genuine 2-vs-1 majority (b1+b2 vs helper), so helper gets reconciled into b1/b2's
		// Module (documentation/adr/0038) - leaving "entry/a" behind with no community-mate at all. Mirrors
		// `dude-where-is-my-cli`'s own `src/bin.ts`, left alone once its one real dependency,
		// `src/modules/core/helpers/runtime.ts`, joined `core/helpers`'s own majority.
		const graph: RawGraph = {
			nodes: ["entry/a", "partner/helper", "partner/b1", "partner/b2", "anchor/x", "anchor/y", "anchor/z"].map(file),
			edges: [
				importEdge("entry/a", "partner/helper"),
				importEdge("partner/b1", "partner/b2"),
				...triangle("anchor/x", "anchor/y", "anchor/z"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		expect(byId.get("entry/a")).toMatchObject({
			moduleId: null,
			unassignedReason: "undersized",
		});
		expect(byId.get("partner/helper")?.moduleId).not.toBeNull();
		expect(byId.get("partner/helper")?.moduleId).toBe(byId.get("partner/b1")?.moduleId);
		expect(byId.get("partner/b1")?.moduleId).toBe(byId.get("partner/b2")?.moduleId);
	});

	it("marks every file degenerate-partition when the whole graph's modularity is below 0.1", () => {
		const ids = ["k1", "k2", "k3", "k4", "k5"];
		const edges: ImportEdge[] = ids.flatMap((source, i) =>
			ids.slice(i + 1).map((target) => importEdge(source, target)),
		);

		const graph: RawGraph = { nodes: ids.map(file), edges };

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		for (const id of ids) {
			expect(byId.get(id)).toMatchObject({
				moduleId: null,
				unassignedReason: "degenerate-partition",
			});
		}
	});

	it("gives every member of a well-connected community the same non-null moduleId and null unassignedReason", () => {
		const graph: RawGraph = {
			nodes: ["a1", "a2", "a3", "b1", "b2", "b3"].map(file),
			edges: [...triangle("a1", "a2", "a3"), ...triangle("b1", "b2", "b3")],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		const groupA = ["a1", "a2", "a3"].map((id) => byId.get(id));
		const groupB = ["b1", "b2", "b3"].map((id) => byId.get(id));

		for (const node of [...groupA, ...groupB]) {
			expect(node?.unassignedReason).toBeNull();
			expect(node?.moduleId).not.toBeNull();
		}
		expect(new Set(groupA.map((node) => node?.moduleId)).size).toBe(1);
		expect(new Set(groupB.map((node) => node?.moduleId)).size).toBe(1);
		expect(groupA[0]?.moduleId).not.toBe(groupB[0]?.moduleId);
	});

	it("never assigns a non-null moduleId together with a non-null unassignedReason", () => {
		const graph: RawGraph = {
			nodes: ["a1", "a2", "a3", "b1", "b2", "b3", "x", "y", "g"].map(file),
			edges: [...triangle("a1", "a2", "a3"), ...triangle("b1", "b2", "b3"), importEdge("x", "y")],
		};

		const result = new LouvainModuleDetector().detect(graph);

		for (const node of fileNodesById(result.nodes).values()) {
			const hasModule = node.moduleId !== null;
			const hasReason = node.unassignedReason !== null;
			expect(hasModule && hasReason).toBe(false);
		}
	});

	it("breaks an evenly-split tie in favor of the community sharing the bridge file's own folder", () => {
		// "h" has exactly two edges into each triangle - a dead-even tie on raw import count.
		// Folder-proximity weighting (documentation/adr/0007) is the only thing that can break the tie,
		// and it should favour domainA since h lives there too.
		const graph: RawGraph = {
			nodes: ["domainA/a1", "domainA/a2", "domainA/a3", "domainB/b1", "domainB/b2", "domainB/b3", "domainA/h"].map(
				file,
			),
			edges: [
				...triangle("domainA/a1", "domainA/a2", "domainA/a3"),
				...triangle("domainB/b1", "domainB/b2", "domainB/b3"),
				importEdge("domainA/h", "domainA/a1"),
				importEdge("domainA/h", "domainA/a2"),
				importEdge("domainA/h", "domainB/b1"),
				importEdge("domainA/h", "domainB/b2"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		expect(byId.get("domainA/h")?.moduleId).toBe(byId.get("domainA/a1")?.moduleId);
		expect(byId.get("domainA/h")?.moduleId).not.toBe(byId.get("domainB/b1")?.moduleId);
	});

	it("buckets every test file into one dedicated Module together, regardless of folder or which files they test", () => {
		const graph: RawGraph = {
			nodes: [
				"domainA/a1",
				"domainA/a2",
				"domainA/a3",
				"domainB/b1",
				"domainB/b2",
				"domainB/b3",
				"domainA/a1.test.ts",
				"domainB/b1.test.ts",
			].map(file),
			edges: [
				...triangle("domainA/a1", "domainA/a2", "domainA/a3"),
				...triangle("domainB/b1", "domainB/b2", "domainB/b3"),
				importEdge("domainA/a1.test.ts", "domainA/a1"),
				importEdge("domainB/b1.test.ts", "domainB/b1"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);
		const testA = byId.get("domainA/a1.test.ts");
		const testB = byId.get("domainB/b1.test.ts");

		expect(testA?.unassignedReason).toBeNull();
		expect(testB?.unassignedReason).toBeNull();
		expect(testA?.moduleId).not.toBeNull();
		expect(testA?.moduleId).toBe(testB?.moduleId);
		expect(testA?.moduleId).not.toBe(byId.get("domainA/a1")?.moduleId);
		expect(testA?.moduleId).not.toBe(byId.get("domainB/b1")?.moduleId);
	});

	it("excludes test files from production community detection entirely, not just from the result", () => {
		// Without the exclusion, "domainA/a1.test.ts" importing into both triangles would bridge
		// them into a single community. Since test files never enter the import graph at all, the
		// two triangles stay their own separate, well-embedded communities.
		const graph: RawGraph = {
			nodes: ["domainA/a1", "domainA/a2", "domainA/a3", "domainB/b1", "domainB/b2", "domainB/b3", "shared.test.ts"].map(
				file,
			),
			edges: [
				...triangle("domainA/a1", "domainA/a2", "domainA/a3"),
				...triangle("domainB/b1", "domainB/b2", "domainB/b3"),
				importEdge("shared.test.ts", "domainA/a1"),
				importEdge("shared.test.ts", "domainB/b1"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		expect(byId.get("domainA/a1")?.moduleId).not.toBeNull();
		expect(byId.get("domainB/b1")?.moduleId).not.toBeNull();
		expect(byId.get("domainA/a1")?.moduleId).not.toBe(byId.get("domainB/b1")?.moduleId);
	});

	it("excludes a known build-tooling config file from clustering, leaving it unassigned as 'config' rather than bucketed with others (documentation/adr/0048)", () => {
		// Mirrors `valora`'s own shape: a root `eslint.config.js` extended by two packages' own
		// config files, each importing only the root one - a star graph with no other edges at all.
		const graph: RawGraph = {
			nodes: [
				"eslint.config.js",
				"pkg-a/eslint.config.js",
				"pkg-b/eslint.config.js",
				"domainA/a1",
				"domainA/a2",
				"domainA/a3",
				"domainB/b1",
				"domainB/b2",
				"domainB/b3",
			].map(file),
			edges: [
				importEdge("pkg-a/eslint.config.js", "eslint.config.js"),
				importEdge("pkg-b/eslint.config.js", "eslint.config.js"),
				...triangle("domainA/a1", "domainA/a2", "domainA/a3"),
				...triangle("domainB/b1", "domainB/b2", "domainB/b3"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		for (const id of ["eslint.config.js", "pkg-a/eslint.config.js", "pkg-b/eslint.config.js"]) {
			expect(byId.get(id)).toMatchObject({ moduleId: null, unassignedReason: "config" });
		}
		// Unrelated production code is untouched.
		expect(byId.get("domainA/a1")?.moduleId).not.toBeNull();
	});

	it("excludes config files from production community detection entirely, not just from the result", () => {
		// Without the exclusion, the shared root config would bridge two otherwise-unrelated
		// directories' triangles into one community, the same shape as the test-file exclusion test
		// above.
		const graph: RawGraph = {
			nodes: [
				"domainA/a1",
				"domainA/a2",
				"domainA/a3",
				"domainB/b1",
				"domainB/b2",
				"domainB/b3",
				"domainA/eslint.config.js",
				"domainB/eslint.config.js",
			].map(file),
			edges: [
				...triangle("domainA/a1", "domainA/a2", "domainA/a3"),
				...triangle("domainB/b1", "domainB/b2", "domainB/b3"),
				importEdge("domainA/eslint.config.js", "domainA/a1"),
				importEdge("domainB/eslint.config.js", "domainB/b1"),
				importEdge("domainA/eslint.config.js", "domainB/eslint.config.js"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		expect(byId.get("domainA/a1")?.moduleId).not.toBeNull();
		expect(byId.get("domainB/b1")?.moduleId).not.toBeNull();
		expect(byId.get("domainA/a1")?.moduleId).not.toBe(byId.get("domainB/b1")?.moduleId);
	});

	it("splits a Module along Package lines when its files span more than one Package, unassigning a resulting slice too small to survive on its own (documentation/adr/0049)", () => {
		// "pkg-a/bridge" has no edge to any other file in its own Package (pkg-a has no other files at
		// all) and two edges into pkg-b's own fully-embedded triangle - the exact shape
		// `reconcileDirectoryFragmentation`'s own documentation/adr/0038 test uses for a directory, here crossing
		// a Package boundary instead. Without documentation/adr/0049, classify() would put all four files in one
		// community spanning two Packages, exactly the `valora` "src+packages" shape this fix targets.
		const graph: RawGraph = {
			nodes: [
				packageNode(".", "root"),
				packageNode("pkg-a", "pkg-a"),
				packageNode("pkg-b", "pkg-b"),
				file("pkg-a/bridge"),
				file("pkg-b/x"),
				file("pkg-b/y"),
				file("pkg-b/z"),
				file("other/x"),
				file("other/y"),
				file("other/z"),
			],
			edges: [
				...triangle("pkg-b/x", "pkg-b/y", "pkg-b/z"),
				...triangle("other/x", "other/y", "other/z"),
				importEdge("pkg-a/bridge", "pkg-b/x"),
				importEdge("pkg-a/bridge", "pkg-b/y"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		// Confirmed first that without the Package-atomicity fix, this exact shape puts all four
		// files in one community (mirroring the already-passing documentation/adr/0038 directory test) - so a
		// pre-documentation/adr/0049 version of this test would have asserted the opposite of what follows.
		expect(byId.get("pkg-a/bridge")).toMatchObject({
			moduleId: null,
			unassignedReason: "undersized",
		});

		const otherPackageModuleIds = new Set(["pkg-b/x", "pkg-b/y", "pkg-b/z"].map((id) => byId.get(id)?.moduleId));
		expect(otherPackageModuleIds.size).toBe(1);
		expect([...otherPackageModuleIds][0]).not.toBeNull();
	});

	it("leaves a Module untouched when all its files belong to the same Package", () => {
		const graph: RawGraph = {
			nodes: [
				packageNode(".", "root"),
				file("domainA/a1"),
				file("domainA/a2"),
				file("domainA/a3"),
				file("domainB/b1"),
				file("domainB/b2"),
				file("domainB/b3"),
			],
			edges: [
				...triangle("domainA/a1", "domainA/a2", "domainA/a3"),
				...triangle("domainB/b1", "domainB/b2", "domainB/b3"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		const groupA = ["domainA/a1", "domainA/a2", "domainA/a3"].map((id) => byId.get(id));
		for (const node of groupA) {
			expect(node?.unassignedReason).toBeNull();
			expect(node?.moduleId).not.toBeNull();
		}
		expect(new Set(groupA.map((node) => node?.moduleId)).size).toBe(1);
	});

	it("is a no-op when the graph carries no Package node data at all", () => {
		// Same shape as the Package-split test above, but with zero PackageNode fixtures: every file
		// trivially resolves to no owning Package at all, so the split pass can never fire, and
		// behaviour is identical to the pre-documentation/adr/0049 single-community outcome
		// (documentation/adr/0038's own directory-fragmentation test already proves this shape merges absent any
		// Package boundary to split along).
		const graph: RawGraph = {
			nodes: ["pkg-a/bridge", "pkg-b/x", "pkg-b/y", "pkg-b/z", "other/x", "other/y", "other/z"].map(file),
			edges: [
				...triangle("pkg-b/x", "pkg-b/y", "pkg-b/z"),
				...triangle("other/x", "other/y", "other/z"),
				importEdge("pkg-a/bridge", "pkg-b/x"),
				importEdge("pkg-a/bridge", "pkg-b/y"),
			],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		const moduleIds = new Set(["pkg-a/bridge", "pkg-b/x", "pkg-b/y", "pkg-b/z"].map((id) => byId.get(id)?.moduleId));
		expect(moduleIds.size).toBe(1);
		expect([...moduleIds][0]).not.toBeNull();
	});

	it("re-clusters a community that scatters across more directories than the breadth cap, surfacing the per-directory sub-structure a repo-wide resolution-limit artifact hid (documentation/adr/0051)", () => {
		// Mirrors `valora`'s own shape: a "cli"-like hub densely wired into five sibling directories
		// (each a real, internally-connected 3-file community of its own), embedded in a large enough
		// repo that modularity optimisation's resolution limit makes merging all six directories into
		// one community look better than keeping them apart - verified directly by running this exact
		// fixture with `refineOversizedCommunities` disabled: without it, five of the six directories
		// collapse into a single community. With it, re-clustering just this community's own internal
		// edges (with none of the surrounding filler mass distorting the comparison) recovers all six
		// as separate, cleanly-embedded communities.
		const hub: [string, string, string, string, string, string] = [
			"app/cli/h0",
			"app/cli/h1",
			"app/cli/h2",
			"app/cli/h3",
			"app/cli/h4",
			"app/cli/h5",
		];
		const satelliteDirs = ["output", "config", "session", "ui", "cleanup"] as const;
		const satelliteFiles = (dir: string): [string, string, string] => [
			`app/${dir}/f0`,
			`app/${dir}/f1`,
			`app/${dir}/f2`,
		];
		const satellites = satelliteDirs.map(satelliteFiles);

		const hubEdges = allPairs(hub);
		// Each satellite is its own 3-file path (weaker than a full triangle, but real, same-directory
		// cohesion) - its first two files densely cross-wired to every hub file, mirroring a CLI
		// command handler that reaches into a sibling layer (config/output/session/ui/cleanup)
		// constantly.
		const satelliteEdges = satellites.flatMap(([a, b, c]) => [importEdge(a, b), importEdge(b, c)]);
		const crossEdges = satellites.flatMap(([a, b]) => hub.flatMap((h) => [importEdge(h, a), importEdge(h, b)]));

		// Filler mass large enough that this community's cross-directory edges look, relative to the
		// whole graph, like more than enough signal to merge - the same whole-graph-size dependence
		// documentation/adr/0051 is about. Each filler triangle is its own fully unrelated community.
		const filler = Array.from({ length: 80 }, (_, i): [string, string, string] => [
			`filler${i}/x`,
			`filler${i}/y`,
			`filler${i}/z`,
		]);
		const fillerEdges = filler.flatMap(([a, b, c]) => triangle(a, b, c));

		const graph: RawGraph = {
			nodes: [...hub, ...satellites.flat(), ...filler.flat()].map(file),
			edges: [...hubEdges.map(([a, b]) => importEdge(a, b)), ...satelliteEdges, ...crossEdges, ...fillerEdges],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		const filesByDir = new Map<string, string[]>([
			["cli", hub],
			...satelliteDirs.map((dir, i): [string, string[]] => [dir, satellites[i] ?? []]),
		]);
		const dirs = [...filesByDir.keys()];
		const moduleIdOf = (dir: string) => byId.get((filesByDir.get(dir) ?? [])[0] ?? "")?.moduleId;
		const moduleIds = dirs.map(moduleIdOf);

		for (const id of moduleIds) expect(id).not.toBeNull();
		// Every one of the six directories ends up in its own distinct Module - none of them share a
		// Module with any other, exactly reversing the pre-documentation/adr/0051 single-blob outcome.
		expect(new Set(moduleIds).size).toBe(dirs.length);

		// Every file within one directory agrees on that directory's Module (refinement didn't
		// fragment a single directory across several Modules of its own, documentation/adr/0038's invariant
		// still holding after this new pass).
		for (const dir of dirs) {
			const idsInDir = new Set((filesByDir.get(dir) ?? []).map((f) => byId.get(f)?.moduleId));
			expect(idsInDir.size).toBe(1);
			expect([...idsInDir][0]).toBe(moduleIdOf(dir));
		}
	});

	it("never attempts to refine a community within the directory-breadth cap, regardless of its size", () => {
		// Ten files, all directly in one directory (breadth 0, far under the cap) - no room for a
		// resolution-limit artifact to hide in. Embedded in the same large filler mass as the test
		// above, to confirm size alone never triggers refinement, only breadth does: blindly
		// re-clustering a community like this in isolation is actively destructive (verified directly -
		// this codebase's own `ast`/`security`-shaped Modules fragment into mostly unassigned files
		// when re-clustered standalone, since the whole-graph modularity and embeddedness baselines
		// that justified keeping them together no longer have anywhere near enough graph left to
		// reference).
		const members = Array.from({ length: 10 }, (_, i) => `app/security/f${i}`);
		const memberEdges = sequentialPairs(members).map(([a, b]) => importEdge(a, b));

		const filler = Array.from({ length: 80 }, (_, i): [string, string, string] => [
			`filler${i}/x`,
			`filler${i}/y`,
			`filler${i}/z`,
		]);
		const fillerEdges = filler.flatMap(([a, b, c]) => triangle(a, b, c));

		const graph: RawGraph = {
			nodes: [...members, ...filler.flat()].map(file),
			edges: [...memberEdges, ...fillerEdges],
		};

		const result = new LouvainModuleDetector().detect(graph);
		const byId = fileNodesById(result.nodes);

		const moduleIds = new Set(members.map((m) => byId.get(m)?.moduleId));
		expect(moduleIds.size).toBe(1);
		expect([...moduleIds][0]).not.toBeNull();
	});

	it("is repeatable: detect() run twice over the same unchanged RawGraph produces byte-identical assignments", () => {
		const graph: RawGraph = {
			nodes: ["a1", "a2", "a3", "b1", "b2", "b3", "x", "y", "g"].map(file),
			edges: [...triangle("a1", "a2", "a3"), ...triangle("b1", "b2", "b3"), importEdge("x", "y")],
		};

		const first = new LouvainModuleDetector().detect(graph);
		const second = new LouvainModuleDetector().detect(graph);

		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	});
});
