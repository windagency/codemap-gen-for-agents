import { UndirectedGraph } from "graphology";
import type { DetailedLouvainOutput } from "graphology-communities-louvain";
import louvainModule from "graphology-communities-louvain";
import {
	containerDirSegments,
	distinctChildSegments,
	isFileNode,
	longestCommonPrefixLength,
	MAX_DIRECTORY_BREADTH,
	type NamedPackageDir,
	owningPackageOf,
	packagesOf,
} from "src/clustering/graph-node-utils";
import type { ModuleDetector } from "src/clustering/module-detector";
import { isConfigFile } from "src/core/config-file";
import { isTestFile } from "src/core/test-file";
import type { ClusteredGraph, GraphEdge, GraphNode, ImportEdge, RawGraph, UnassignedReason } from "src/core/types";

// Thresholds fixed by documentation/adr/0001, tuned since by
// documentation/adr/0014 (embeddedness) and documentation/adr/0015 (this constant, originally 3).
//
// 2 rather than 1: a community can't have size 0 for a file with degree > 0 (it's always in
// *some* community, itself included), so a floor of 1 would never exclude anything - the
// classification would be dead code. 2 is the smallest floor that still means something: it
// excludes a file Louvain left in a true singleton community of its own, which this library
// empirically avoids for any connected node (see documentation/adr/0015) but which the classification
// still guards against defensively, matching the "safe by construction, checked anyway" pattern
// used elsewhere in this codebase (e.g. `filesystem-discovery.ts`'s `packageId as string`).
const MIN_COMMUNITY_SIZE = 2;
const MIN_EMBEDDEDNESS = 0.5;
const MIN_MODULARITY = 0.1;

// `graphology-communities-louvain` ships an ambient .d.ts written with ESM `export default`
// syntax for a plain CommonJS package (no "type": "module") - under `moduleResolution:
// NodeNext` this makes TS infer the default import's *static* type as the whole module
// namespace instead of the callable it actually is at runtime. Re-declaring the one method
// this file calls and casting sidesteps that upstream typing gap without a blanket `any`.
interface LouvainCommunityDetector {
	detailed(graph: UndirectedGraph, options?: { randomWalk?: boolean }): DetailedLouvainOutput;
}
const louvain = louvainModule as unknown as LouvainCommunityDetector;

function isImportEdge(edge: GraphEdge): edge is ImportEdge {
	return edge.kind === "static" && edge.type === "import";
}

// Number of leading directory segments two files' container paths have in common. Used to
// weight import edges so Louvain favours grouping folder-proximate files (documentation/adr/0007) -
// purely a function of each file's own id, already present in the graph, not an external
// config/declaration input.
function sharedDirDepth(a: string, b: string): number {
	return longestCommonPrefixLength([containerDirSegments(a), containerDirSegments(b)]);
}

// Exponential rather than linear (documentation/adr/0007): each additional shared directory segment
// should decisively outweigh one more raw import edge, not just nudge the tiebreak, so files
// under the same leaf folder reliably land together even against a real cross-folder import
// signal. A depth-0 pair (no shared directory at all) keeps weight 1 - the pre-ADR-0007 baseline.
const FOLDER_PROXIMITY_BASE = 3;

function directoryOf(fileId: string): string {
	return containerDirSegments(fileId).join("/");
}

// For every file, the distinct outside directories connected to it by a cross-directory edge, in
// each direction: `fanIn` is who imports it (its importers' directories), `fanOut` is what it
// imports (the imported files' directories). Two files in the same outside directory count once,
// not twice - it's the number of separate *places* on the other end that matters, not the raw edge
// count. A same-directory edge never contributes to either map (that's internal cohesion, not
// external fan-out, and `importEdgeWeight` below never dilutes a same-directory edge regardless).
function externalDirFanCounts(importEdges: ImportEdge[]): {
	fanIn: Map<string, Set<string>>;
	fanOut: Map<string, Set<string>>;
} {
	const fanIn = new Map<string, Set<string>>();
	const fanOut = new Map<string, Set<string>>();
	for (const edge of importEdges) {
		const sourceDir = directoryOf(edge.source);
		const targetDir = directoryOf(edge.target);
		if (sourceDir === targetDir) continue;

		const importerDirs = fanIn.get(edge.target) ?? new Set<string>();
		importerDirs.add(sourceDir);
		fanIn.set(edge.target, importerDirs);

		const importedDirs = fanOut.get(edge.source) ?? new Set<string>();
		importedDirs.add(targetDir);
		fanOut.set(edge.source, importedDirs);
	}
	return { fanIn, fanOut };
}

// A cross-directory edge's folder-proximity bonus (documentation/adr/0007) assumes directory adjacency is
// itself evidence of domain relatedness - true for a file privately used by one neighbouring
// directory, false for a file reused identically by several sibling directories (e.g. a
// tree-sitter-common parser helper imported the same way by tree-sitter-go, -java, -python, and
// -rust alike: high fan-IN). Being pulled on by N structurally-equivalent siblings is evidence the
// file is a shared dependency of all of them, not a member of whichever one Louvain's tie-breaking
// happens to land it in - so the bonus is diluted by that fan-in count (documentation/adr/0036).
//
// The dual case is a dispatcher that reaches out to N structurally-equivalent siblings itself
// (e.g. a parser factory importing one concrete parser file from every language directory alike:
// high fan-OUT) - same problem, opposite direction, so it's diluted the same way (documentation/adr/0037).
// Whichever side of the edge is more widely connected decides the dilution (`Math.max`): a file
// that's both someone's single private dependency *and* itself a hub shouldn't get to keep an
// undiluted weight just because one side of it looks exclusive.
//
// Never below the pre-documentation/adr/0007 unweighted baseline of 1, and never applied to a same-directory
// edge (that's internal cohesion, not external fan-out/fan-in).
function importEdgeWeight(source: string, target: string, fanIn: number, fanOut: number): number {
	const raw = FOLDER_PROXIMITY_BASE ** sharedDirDepth(source, target);
	const divisor = Math.max(fanIn, fanOut);
	if (divisor <= 1 || directoryOf(source) === directoryOf(target)) return raw;
	return Math.max(1, raw / divisor);
}

// Files added in fixed sorted-path order, edges in fixed (source, target) order: the only
// remaining source of run-to-run nondeterminism in `graphology-communities-louvain` once
// `randomWalk: false` disables its RNG-based traversal order (documentation/adr/0001, research notes).
function buildImportGraph(fileIds: string[], edges: GraphEdge[]): UndirectedGraph {
	const fileIdSet = new Set(fileIds);
	const importGraph = new UndirectedGraph();

	for (const fileId of fileIds) importGraph.addNode(fileId);

	const importEdges = edges
		.filter(isImportEdge)
		.filter((edge) => edge.source !== edge.target && fileIdSet.has(edge.source) && fileIdSet.has(edge.target))
		.sort((a, b) => `${a.source}\0${a.target}`.localeCompare(`${b.source}\0${b.target}`));

	const { fanIn, fanOut } = externalDirFanCounts(importEdges);

	for (const edge of importEdges) {
		importGraph.mergeEdge(edge.source, edge.target, {
			weight: importEdgeWeight(
				edge.source,
				edge.target,
				fanIn.get(edge.target)?.size ?? 0,
				fanOut.get(edge.source)?.size ?? 0,
			),
		});
	}

	return importGraph;
}

function communitySizesOf(communities: Record<string, number>): Map<number, number> {
	const sizes = new Map<number, number>();
	for (const communityId of Object.values(communities)) {
		sizes.set(communityId, (sizes.get(communityId) ?? 0) + 1);
	}
	return sizes;
}

interface Assignment {
	moduleId: number | null;
	unassignedReason: UnassignedReason | null;
}

// Sum of `importEdgeWeight` over every edge incident to `fileId`, optionally restricted to
// neighbours passing `predicate`. The same weighted view `louvain.detailed` used to assign
// communities in the first place (documentation/adr/0014) - a file weighted heavily into a community by
// its folder-proximate edges shouldn't then be measured against that same community by an
// unweighted count that throws the weighting away.
function weightedDegree(
	importGraph: UndirectedGraph,
	fileId: string,
	predicate: (neighbor: string) => boolean = () => true,
): number {
	return importGraph
		.neighbors(fileId)
		.filter(predicate)
		.reduce(
			(sum, neighbor) =>
				sum +
				// graphology's edge-attribute store is untyped (`getEdgeAttribute` returns `any`) - safe
				// to cast here because `buildImportGraph` is the only writer of "weight" on this graph
				// and always assigns it the numeric result of `importEdgeWeight`.
				(importGraph.getEdgeAttribute(fileId, neighbor, "weight") as number),
			0,
		);
}

// The three outputs of a single `louvain.detailed` call, always produced together and always
// consulted together by `classify` - bundled so callers can't pass a `communities` from one run
// alongside a `communitySizes`/`wholeGraphIsDegenerate` from another.
interface LouvainRun {
	communities: Record<string, number>;
	communitySizes: Map<number, number>;
	wholeGraphIsDegenerate: boolean;
}

// Decides one file's Module assignment (or the reason it's left unassigned) after Louvain has run.
//
// Classification order fixed by spec.md: isolated -> undersized -> low-embeddedness ->
// degenerate-partition -> assigned. Each rule short-circuits the ones after it.
function classify(fileId: string, importGraph: UndirectedGraph, run: LouvainRun): Assignment {
	const degree = importGraph.degree(fileId);
	if (degree === 0) return { moduleId: null, unassignedReason: "isolated" };

	// Every node added to `importGraph` is assigned a community by `louvain.detailed` - safe by
	// construction, same guaranteed-lookup pattern as `filesystem-discovery.ts`'s `packageId as string`.
	const communityId = run.communities[fileId] as number;
	if ((run.communitySizes.get(communityId) ?? 0) < MIN_COMMUNITY_SIZE) {
		return { moduleId: null, unassignedReason: "undersized" };
	}

	const totalWeight = weightedDegree(importGraph, fileId);
	const internalWeight = weightedDegree(importGraph, fileId, (neighbor) => run.communities[neighbor] === communityId);
	if (internalWeight / totalWeight < MIN_EMBEDDEDNESS) {
		return { moduleId: null, unassignedReason: "low-embeddedness" };
	}

	if (run.wholeGraphIsDegenerate) {
		return { moduleId: null, unassignedReason: "degenerate-partition" };
	}

	return { moduleId: communityId, unassignedReason: null };
}

// Runs Louvain over exactly `fileIds` and `edges` and classifies every one of them - the same
// build-graph-then-classify-each-file sequence `detect()` runs over the whole codebase, factored out
// so `refineOversizedCommunities` below can re-run it over just one community's own files and
// internal edges (documentation/adr/0051), with no whole-graph context bleeding in. Returns a `moduleId` scoped
// to *this* call only - a fresh Louvain run numbers its own communities from zero regardless of any
// caller's existing ids, so every caller must remap these before merging them into a larger node set.
function clusterFileIds(fileIds: string[], edges: GraphEdge[]): Map<string, Assignment> {
	const importGraph = buildImportGraph(fileIds, edges);
	const { communities, modularity } = louvain.detailed(importGraph, { randomWalk: false });
	const run: LouvainRun = {
		communities,
		communitySizes: communitySizesOf(communities),
		wholeGraphIsDegenerate: modularity < MIN_MODULARITY,
	};
	return new Map(fileIds.map((fileId) => [fileId, classify(fileId, importGraph, run)]));
}

// A file's directory key for `reconcileDirectoryFragmentation` below, or `null` for a bare id with
// no "/" at all - such a file has no real directory to share, so treating every such file as
// living in one shared "" directory would wrongly fuse unrelated root-level files together.
function fragmentationDirectoryKey(fileId: string): string | null {
	const dir = containerDirSegments(fileId).join("/");
	return dir === "" ? null : dir;
}

// Every production, Module-assigned file, grouped by its exact directory and tallied by moduleId -
// a directory whose tally has more than one key is a directory `classify` split across Modules.
function countModuleIdsByDirectory(nodes: GraphNode[]): Map<string, Map<number, number>> {
	const countsByDirectory = new Map<string, Map<number, number>>();
	for (const node of nodes) {
		if (!isFileNode(node) || node.moduleId === null || isTestFile(node.id)) continue;
		const dir = fragmentationDirectoryKey(node.id);
		if (dir === null) continue;
		const counts = countsByDirectory.get(dir) ?? new Map<number, number>();
		counts.set(node.moduleId, (counts.get(node.moduleId) ?? 0) + 1);
		countsByDirectory.set(dir, counts);
	}
	return countsByDirectory;
}

// The moduleId with the most files in a directory's tally. A tie for the top spot between two
// genuine *individuals* (each tied moduleId holding exactly one file here) is left unreconciled -
// `undefined` - matching documentation/adr/0040's own reasoning: with nothing but one file apiece on either
// side, there is no real majority to defer to, and forcing one to win would strip that one file of
// its own genuine, separately-earned community membership for no real gain (`root/a`'s fully-embedded
// pairing with its one actual dependency, documentation/adr/0040's own `dude-where-is-my-cli` example).
//
// A tie between two or more *substantial* groups (every tied moduleId holding more than one file
// here) is resolved instead, deterministically, by lowest moduleId (documentation/adr/0038's original
// tiebreak, before documentation/adr/0040 narrowed it to the individuals-only case this function now
// restores): at this scale, each side already has its own real internal cohesion independent of the
// vote, so picking a winner doesn't fabricate a relationship or strip anything of its only partner,
// it just resolves which of two equally-real contenders gets to keep the directory's name - and
// leaving a directory split across many such substantial groups is worse than that pick, not safer
// (`documentation/adr/0053`, measured on a 22-file directory left fragmented across seven Modules by the
// individuals-only rule alone).
function majorityModuleId(counts: Map<number, number>): number | undefined {
	const bySizeThenId = [...counts.entries()].sort(([idA, countA], [idB, countB]) =>
		countB !== countA ? countB - countA : idA - idB,
	);
	const [first, second] = bySizeThenId;
	if (first === undefined) return undefined;
	if (second !== undefined && second[1] === first[1] && first[1] === 1) return undefined;
	return first[0];
}

// `classify` can leave a single directory's production files split across more than one Module -
// e.g. one file pulled out toward whichever outside directory imports it most, even against many
// siblings that stayed put (documentation/adr/0038). This enforces a stronger invariant than the
// algorithm alone provides: every production file in the same exact directory always ends up in
// the same Module, by merging a split directory's minority files into whichever Module already
// holds a genuine majority of that directory - or, for a tie between substantial groups rather than
// lone individuals, the lowest-id contender (`majorityModuleId`, documentation/adr/0040, narrowed by
// documentation/adr/0053). Test files are excluded - documentation/adr/0010 already buckets them together
// regardless of directory, the opposite grouping rule, so they take no part here either as a vote or
// as something to be moved.
function reconcileDirectoryFragmentation(nodes: GraphNode[]): GraphNode[] {
	const winnerByDirectory = new Map<string, number>();
	for (const [dir, counts] of countModuleIdsByDirectory(nodes)) {
		if (counts.size <= 1) continue;
		const winner = majorityModuleId(counts);
		if (winner !== undefined) winnerByDirectory.set(dir, winner);
	}

	if (winnerByDirectory.size === 0) return nodes;

	return nodes.map((node) => {
		if (!isFileNode(node) || node.moduleId === null || isTestFile(node.id)) return node;
		const dir = fragmentationDirectoryKey(node.id);
		const winner = dir === null ? undefined : winnerByDirectory.get(dir);
		return winner !== undefined && winner !== node.moduleId ? { ...node, moduleId: winner } : node;
	});
}

// Every (moduleId, owning Package) pair among `nodes`' production, Module-assigned files - a
// moduleId mapping to more than one Package key is one Louvain left spanning a boundary
// documentation/adr/0049 treats as inviolable, the Package analogue of `countModuleIdsByDirectory`
// above. Keyed by the Package's own directory (not its declared name) since that's the
// structurally-guaranteed-unique identity a Package node's id already carries - two Packages could
// in principle declare the same name, but never the same directory. Test files are excluded, same
// reasoning as `countModuleIdsByDirectory`: documentation/adr/0010's dedicated bucket already settles
// them regardless of directory or Package, so splitting it by Package would undo that.
function packagesByModuleId(nodes: GraphNode[], packages: NamedPackageDir[]): Map<number, Set<string>> {
	const result = new Map<number, Set<string>>();
	for (const node of nodes) {
		if (!isFileNode(node) || node.moduleId === null || isTestFile(node.id)) continue;
		const pkg = owningPackageOf(node.id, packages);
		if (pkg === undefined) continue;
		const keys = result.get(node.moduleId) ?? new Set<string>();
		keys.add(pkg.dirSegments.join("/"));
		result.set(node.moduleId, keys);
	}
	return result;
}

// For every moduleId whose production files span more than one Package, reassigns each Package's
// own files to a fresh, distinct moduleId - splitting the Module along Package lines rather than
// picking a winner, since two declared Packages are each already a real domain boundary in their
// own right (independently versioned and independently publishable), not two arbitrary, competing
// claims to the same boundary the way two directories voting for a single Module are
// (`reconcileDirectoryFragmentation`'s majority vote). A moduleId that already maps to exactly one
// Package, or to none (no Package data at all), is left untouched - including every one of its
// files, not just a majority of them (documentation/adr/0049).
function reconcilePackageFragmentation(nodes: GraphNode[], packages: NamedPackageDir[]): GraphNode[] {
	const packageKeysByModuleId = packagesByModuleId(nodes, packages);
	const fragmentedModuleIds = [...packageKeysByModuleId.entries()]
		.filter(([, keys]) => keys.size > 1)
		.map(([moduleId]) => moduleId)
		.sort((a, b) => a - b);

	if (fragmentedModuleIds.length === 0) return nodes;

	// Fresh ids start past every id already in use, so a split group can never collide with an
	// untouched Module or the dedicated tests bucket - same "reduce rather than Math.max spread"
	// reasoning as `testsModuleId` below.
	const maxExistingId = nodes.reduce(
		(max, node) => (isFileNode(node) && node.moduleId !== null ? Math.max(max, node.moduleId) : max),
		-1,
	);

	// Deterministic: every (moduleId, packageKey) pair needing a fresh id is visited in a fixed
	// sorted order, so the ids handed out never depend on Map/Set iteration order.
	const freshIdByKey = new Map(
		fragmentedModuleIds
			.flatMap((moduleId) =>
				[...(packageKeysByModuleId.get(moduleId) ?? [])].sort().map((packageKey) => `${moduleId}\0${packageKey}`),
			)
			.map((key, index) => [key, maxExistingId + 1 + index] as const),
	);

	const fragmentedModuleIdSet = new Set(fragmentedModuleIds);
	return nodes.map((node) => {
		if (!isFileNode(node) || node.moduleId === null || isTestFile(node.id)) return node;
		if (!fragmentedModuleIdSet.has(node.moduleId)) return node;
		const pkg = owningPackageOf(node.id, packages);
		if (pkg === undefined) return node;
		const freshId = freshIdByKey.get(`${node.moduleId}\0${pkg.dirSegments.join("/")}`);
		return freshId === undefined ? node : { ...node, moduleId: freshId };
	});
}

// Every production, non-test file Module-assigned by `nodes`, grouped by moduleId - the input
// `refineOversizedCommunities` groups its candidates from, and the one place that excludes test
// files from this pass the same way every other reconciliation pass does (documentation/adr/0010's bucket
// is already settled, not something to refine further).
function fileIdsByModuleId(nodes: GraphNode[]): Map<number, string[]> {
	const result = new Map<number, string[]>();
	for (const node of nodes) {
		if (!isFileNode(node) || node.moduleId === null || isTestFile(node.id)) continue;
		const ids = result.get(node.moduleId) ?? [];
		ids.push(node.id);
		result.set(node.moduleId, ids);
	}
	return result;
}

// How many distinct top-level areas a group of files scatters across, past their own common
// ancestor - the same structural breadth `module-naming.ts`'s `joinChildSegments` measures to decide
// whether a composite name is still readable (documentation/adr/0046), reused here as evidence that a
// community may be hiding real substructure behind a repo-wide resolution-limit artifact
// (documentation/adr/0051).
function communityBreadth(fileIds: string[]): number {
	const depth = longestCommonPrefixLength(fileIds.map(containerDirSegments));
	return distinctChildSegments(fileIds, depth).size;
}

// A community embedded in a large, repo-wide import graph can suffer from modularity optimisation's
// well-known "resolution limit": two (or more) real, separable sub-domains merge into one community
// purely because the *whole* graph is large enough that the expected edge weight between them under
// the null model becomes negligible - at that point, even a handful of genuine cross-sub-domain
// edges look like enough signal to merge, regardless of how much more tightly each sub-domain is
// connected internally. Re-running the identical clustering algorithm (`clusterFileIds`) over just a
// community's own files and *internal* edges removes that whole-graph distortion entirely, since the
// "expected" weight the null model compares against is now computed relative to this community's own
// size, not the whole repo's - surfacing substructure the repo-wide pass structurally could not see.
//
// Only attempted for a community broad enough that this is actually plausible
// (`MAX_DIRECTORY_BREADTH`, documentation/adr/0046's own breadth cap, shared rather than independently tuned -
// documentation/adr/0051): a small, already single-directory community (e.g. this codebase's own `ast` or
// `security` Modules) has no room for a resolution-limit artifact to hide in, and re-clustering it
// blind is actively destructive - verified directly, not assumed: re-running `clusterFileIds` on
// such a Module's own files in isolation, with no outside context, fragments it into mostly
// `low-embeddedness`/`degenerate-partition` unassigned files, because the whole-graph modularity and
// embeddedness baselines that originally justified keeping it together no longer have anywhere near
// enough graph left to reference. Breadth is what tells these two cases apart: substructure worth
// surfacing needs *multiple distinct areas* to split along in the first place.
//
// A recursive split is accepted only when it actually finds more than one resulting sub-community -
// if the community turns out to be one real, irreducible domain after all (or Louvain simply
// reproduces the same single grouping), it's left completely untouched, falling through to
// documentation/adr/0050's ordinal-naming safety net exactly as before. This is a single, non-recursive pass:
// no case in `valora`'s data needed a split result to be refined a second time, so repeated
// refinement isn't implemented - revisit if a resulting sub-community itself turns out to still
// overflow in practice.
// Re-clusters one overflowing community's own files against only the edges between them, remapping
// the resulting sub-ids to fresh, globally-unique ones starting past `nextId` - or `null` if that
// recursive pass found no real split (fewer than two distinct resulting sub-communities), leaving
// the caller to skip this community entirely. `nextId` is passed by reference via return value (the
// next unused id after this call's own allocations) so a caller refining several communities in one
// pass keeps every fresh id unique across all of them, not just within one.
function refineOneCommunity(
	fileIds: string[],
	edges: GraphEdge[],
	nextId: number,
): { overrides: Map<string, Assignment>; nextId: number } | null {
	const fileIdSet = new Set(fileIds);
	const internalEdges = edges.filter(
		(edge) => isImportEdge(edge) && fileIdSet.has(edge.source) && fileIdSet.has(edge.target),
	);
	const assignmentByFileId = clusterFileIds(fileIds, internalEdges);

	const distinctSubIds = [
		...new Set([...assignmentByFileId.values()].map((assignment) => assignment.moduleId).filter((id) => id !== null)),
	].sort((a, b) => a - b);
	if (distinctSubIds.length < 2) return null;

	let freshNextId = nextId;
	// Deterministic: fresh ids handed out in sorted sub-id order, not Map/Set iteration order.
	const freshIdBySubId = new Map(distinctSubIds.map((subId) => [subId, freshNextId++]));

	const overrides = new Map<string, Assignment>();
	for (const [fileId, assignment] of assignmentByFileId) {
		const freshId = assignment.moduleId === null ? null : (freshIdBySubId.get(assignment.moduleId) ?? null);
		overrides.set(fileId, { moduleId: freshId, unassignedReason: assignment.unassignedReason });
	}
	return { overrides, nextId: freshNextId };
}

function refineOversizedCommunities(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
	const overflowing = [...fileIdsByModuleId(nodes).entries()].filter(
		([, fileIds]) => communityBreadth(fileIds) > MAX_DIRECTORY_BREADTH,
	);
	if (overflowing.length === 0) return nodes;

	// Fresh ids start past every id already in use, so a split group can never collide with an
	// untouched Module or the dedicated tests bucket - same "reduce rather than Math.max spread"
	// reasoning as `testsModuleId` below.
	let nextId =
		1 +
		nodes.reduce((max, node) => (isFileNode(node) && node.moduleId !== null ? Math.max(max, node.moduleId) : max), -1);

	const overrideByFileId = new Map<string, Assignment>();
	for (const [, fileIds] of overflowing) {
		const refined = refineOneCommunity(fileIds, edges, nextId);
		if (refined === null) continue;
		nextId = refined.nextId;
		for (const [fileId, assignment] of refined.overrides) overrideByFileId.set(fileId, assignment);
	}

	if (overrideByFileId.size === 0) return nodes;

	return nodes.map((node) => {
		const override = isFileNode(node) ? overrideByFileId.get(node.id) : undefined;
		return override === undefined ? node : { ...node, ...override };
	});
}

// `reconcileDirectoryFragmentation` can leave a Module smaller than `MIN_COMMUNITY_SIZE`, even
// though every member individually passed `classify`'s own size gate at the time: reconciling a
// different directory's genuine majority can pull a file's only community-mate away to satisfy
// it, leaving the file behind alone (e.g. `dude-where-is-my-cli`'s `src/bin.ts`, whose one real
// partner, `src/modules/core/helpers/runtime.ts`, left to join `core/helpers`'s own 2-vs-1-vs-1
// majority, over `src/bin.ts` and `src/index.ts`'s 1-vs-1 tie not being reconciled at all per
// documentation/adr/0040). `classify`'s size floor exists precisely to exclude a community this small;
// reapplying it once reconciliation has finished closes that gap, rather than leaving a now-hollow,
// single-file Module with nothing real to name it after.
function enforceMinimumCommunitySize(nodes: GraphNode[]): GraphNode[] {
	const sizeByModuleId = new Map<number, number>();
	for (const node of nodes) {
		if (!isFileNode(node) || node.moduleId === null || isTestFile(node.id)) continue;
		sizeByModuleId.set(node.moduleId, (sizeByModuleId.get(node.moduleId) ?? 0) + 1);
	}

	return nodes.map((node) => {
		if (!isFileNode(node) || node.moduleId === null || isTestFile(node.id)) return node;
		const size = sizeByModuleId.get(node.moduleId) ?? 0;
		return size < MIN_COMMUNITY_SIZE ? { ...node, moduleId: null, unassignedReason: "undersized" } : node;
	});
}

// Real Louvain community detection over the static import graph
// (documentation/adr/0001-algorithmic-module-detection.md).
// Replaces the stub registered by `codemap-architecture-skeleton`.
export class LouvainModuleDetector implements ModuleDetector {
	detect(graph: RawGraph): ClusteredGraph {
		const packages = packagesOf(graph.nodes);
		const fileIds = graph.nodes
			.filter(isFileNode)
			.map((node) => node.id)
			.filter((id) => !isTestFile(id) && !isConfigFile(id))
			.sort();

		const importGraph = buildImportGraph(fileIds, graph.edges);
		const { communities, modularity } = louvain.detailed(importGraph, {
			randomWalk: false,
		});
		const run: LouvainRun = {
			communities,
			communitySizes: communitySizesOf(communities),
			wholeGraphIsDegenerate: modularity < MIN_MODULARITY,
		};

		// One id reserved for the tests bucket, guaranteed not to collide with any real community id.
		// Reduced rather than spread into Math.max - a large enough graph would blow the call stack.
		const testsModuleId = Object.values(communities).reduce((max, id) => Math.max(max, id), -1) + 1;

		const nodes = graph.nodes.map((node): GraphNode => {
			if (!isFileNode(node)) return node;

			// A file's own domain is what it tests, not "test" - treating a test file as part of the
			// same import-graph community as its subject would make a Module's shape depend on how
			// thoroughly each part of the codebase happens to be tested, not on the codebase's actual
			// structure. Test files are pulled out of clustering entirely and bucketed into one
			// dedicated Module instead (documentation/adr/0010) - `isTestFile` is the shared convention
			// (`src/core/test-file.ts`) discovery-time exclusion also uses (documentation/adr/0011), so this
			// only ever sees test files when `includeTests` was explicitly requested.
			if (isTestFile(node.id)) {
				return { ...node, moduleId: testsModuleId, unassignedReason: null };
			}

			// A known build-tooling config file is excluded from clustering the same way a test file is
			// (never added to `importGraph`, so it can't bridge two directories' - or two Packages' -
			// communities together), but has no "tests"-style shared domain to bucket into: an unrelated
			// `eslint.config.js` and `vitest.config.ts` have no more in common with each other than
			// either has with any other file (documentation/adr/0048).
			if (isConfigFile(node.id)) {
				return { ...node, moduleId: null, unassignedReason: "config" };
			}

			return {
				...node,
				...classify(node.id, importGraph, run),
			};
		});

		return {
			nodes: enforceMinimumCommunitySize(
				reconcileDirectoryFragmentation(
					refineOversizedCommunities(reconcilePackageFragmentation(nodes, packages), graph.edges),
				),
			),
			edges: graph.edges,
		};
	}
}
