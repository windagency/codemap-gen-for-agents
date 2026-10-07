import { familyOfLanguage, type ManifestFamily, parsePackageId } from "src/core/languages";
import type { ClusteredGraph, GraphNode, SymbolNode } from "src/core/types";

// The `read` tool filter contract - shared by the MCP
// `read` tool and the Skill's `read` subcommand (`src/core/read-command.ts`), so both surfaces
// filter identically instead of each reimplementing this.
export interface GraphFilters {
	path?: string;
	symbolKind?: SymbolNode["symbolKind"];
	search?: string;
}

// A path filter names a directory subtree, optionally narrowed to one manifest family: `.@go`
// means "everything under `.` that the Go Package owns" (`parsePackageId`).
interface PathScope {
	dir: string;
	family: ManifestFamily | undefined;
}

// Where a node sits in the directory tree, and which manifest families own it. A Directory is
// owned by every family with a File beneath it; Externals have no location, so a path filter
// never matches them.
interface NodeLocation {
	path: string;
	families: ReadonlySet<ManifestFamily>;
}

// What every lookup below needs: nodes by id, plus each Directory's families.
interface GraphIndex {
	nodeById: Map<string, GraphNode>;
	familiesByDir: Map<string, Set<ManifestFamily>>;
}

function isUnderDir(nodePath: string, dir: string): boolean {
	return dir === "." || nodePath === dir || nodePath.startsWith(`${dir}/`);
}

function fileIdOf(symbolId: string): string {
	return symbolId.split("#")[0] ?? symbolId;
}

// Every directory strictly above `id`, nearest first, ending at the repo root ".".
function ancestorDirs(id: string): string[] {
	const segments = id.split("/");
	const dirs: string[] = [];
	for (let end = segments.length - 1; end >= 1; end--) {
		dirs.push(segments.slice(0, end).join("/"));
	}
	return [...dirs, "."];
}

function indexGraph(graph: ClusteredGraph): GraphIndex {
	const familiesByDir = new Map<string, Set<ManifestFamily>>();
	for (const node of graph.nodes) {
		if (node.kind !== "file") continue;
		for (const dir of ancestorDirs(node.id)) {
			const families = familiesByDir.get(dir) ?? new Set();
			families.add(familyOfLanguage(node.language));
			familiesByDir.set(dir, families);
		}
	}
	return {
		nodeById: new Map(graph.nodes.map((node) => [node.id, node])),
		familiesByDir,
	};
}

function locationOf(node: GraphNode, index: GraphIndex): NodeLocation | undefined {
	switch (node.kind) {
		case "package": {
			const scope = parsePackageId(node.id);
			const family = scope.family ?? familyOfLanguage(node.language);
			return { path: scope.dir, families: new Set([family]) };
		}
		case "directory":
			return {
				path: node.id,
				families: index.familiesByDir.get(node.id) ?? new Set(),
			};
		case "file":
			return {
				path: node.id,
				families: new Set([familyOfLanguage(node.language)]),
			};
		case "symbol": {
			const file = index.nodeById.get(fileIdOf(node.id));
			return file?.kind === "file" ? locationOf(file, index) : { path: fileIdOf(node.id), families: new Set() };
		}
		case "external":
			return undefined;
	}
}

function matchesPath(location: NodeLocation | undefined, scope: PathScope): boolean {
	if (!location || !isUnderDir(location.path, scope.dir)) return false;
	return scope.family === undefined || location.families.has(scope.family);
}

function matchesNode(node: GraphNode, filters: GraphFilters, index: GraphIndex): boolean {
	if (filters.path !== undefined && !matchesPath(locationOf(node, index), parsePackageId(filters.path))) {
		return false;
	}
	if (filters.symbolKind !== undefined && (node.kind !== "symbol" || node.symbolKind !== filters.symbolKind)) {
		return false;
	}
	if (filters.search !== undefined && !node.name.toLowerCase().includes(filters.search.toLowerCase())) {
		return false;
	}
	return true;
}

// The Package rooted at `dir` that owns `family`'s files: the co-located `<dir>@<family>` id, or
// the bare `<dir>` id when its language belongs to that family.
function owningPackageId(dir: string, family: ManifestFamily, nodeById: Map<string, GraphNode>): string | undefined {
	return [`${dir}@${family}`, dir].find((candidateId) => {
		const node = nodeById.get(candidateId);
		return node?.kind === "package" && familyOfLanguage(node.language) === family;
	});
}

// Walks upward collecting Directory nodes until `family`'s owning Package (the top of the
// File/Directory/Package Cluster chain).
function clusterAncestorIds(id: string, family: ManifestFamily, nodeById: Map<string, GraphNode>): string[] {
	const ancestorIds: string[] = [];
	for (const dir of ancestorDirs(id)) {
		const packageId = owningPackageId(dir, family, nodeById);
		if (packageId !== undefined) return [...ancestorIds, packageId];
		if (nodeById.get(dir)?.kind === "directory") ancestorIds.push(dir);
	}
	return ancestorIds;
}

function includeAncestors(node: GraphNode, index: GraphIndex, resultIds: Set<string>): void {
	if (node.kind === "package") return;
	const location = locationOf(node, index);
	if (!location) return;
	if (node.kind === "symbol") resultIds.add(location.path);
	for (const family of location.families) {
		for (const ancestorId of clusterAncestorIds(location.path, family, index.nodeById)) {
			resultIds.add(ancestorId);
		}
	}
}

// ANDs every provided filter (no filters -> the whole graph matches), then expands the matched
// set to include each match's ancestor Cluster chain (File/Directory/Package) and restricts
// `edges` to those whose endpoints are both already in the resulting node set.
export function filterGraph(graph: ClusteredGraph, filters: GraphFilters): ClusteredGraph {
	const index = indexGraph(graph);
	const matched = graph.nodes.filter((node) => matchesNode(node, filters, index));

	const resultIds = new Set<string>();
	for (const node of matched) {
		resultIds.add(node.id);
		includeAncestors(node, index, resultIds);
	}

	return {
		nodes: graph.nodes.filter((node) => resultIds.has(node.id)),
		edges: graph.edges.filter((edge) => resultIds.has(edge.source) && resultIds.has(edge.target)),
	};
}
