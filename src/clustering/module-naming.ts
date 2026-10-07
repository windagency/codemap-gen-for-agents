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
import { isTestFile } from "src/core/test-file";
import type { GraphNode } from "src/core/types";

export interface ModuleSummary {
	id: number;
	name: string;
}

// Mirrors `louvain-module-detector.ts`'s use of the same shared `isTestFile` convention.
// `LouvainModuleDetector` buckets every test file into one dedicated Module regardless of folder
// (documentation/adr/0010) - a Module made entirely of test files is that bucket, and is named "tests"
// directly rather than through the folder-derived rules below, since its member files were never
// grouped by folder in the first place.

function longestCommonPrefix(segmentLists: string[][]): string[] {
	return (segmentLists[0] ?? []).slice(0, longestCommonPrefixLength(segmentLists));
}

// The single top-level directory every clustered file lives under (e.g. `src`), if there is one.
// That segment is true of the *entire* codebase, not of any particular domain, so it carries no
// information distinguishing one Module from another - same reasoning as the "no common
// directory at all" fallback below, just one level up (documentation/adr/0008). Unassigned files are left
// out: they name no Module, so a stray root-level `vitest.config.ts` mustn't stop `src` being
// stripped from every Module's name.
function universalRootSegment(nodes: GraphNode[]): string | null {
	const firstSegments = new Set(
		nodes
			.filter(isFileNode)
			.filter((node) => node.moduleId !== null)
			.map((node) => containerDirSegments(node.id)[0]),
	);
	const [only] = firstSegments;
	return firstSegments.size === 1 && only !== undefined ? only : null;
}

// A Module's name after its owning Package, when every one of its files shares exactly one Package
// - the genuinely meaningful "top level" in a monorepo laid out as `packages/<name>/src/...`, where
// the literal top-level segment (`packages`) and even the package-relative one (`src`) are both as
// uninformative as a universal root would be, just one level further down (documentation/adr/0041).
// `undefined` when the Module's files span more than one Package (no single Package to name it
// after) or no Package data is available at all.
function singlePackageNameOf(fileIds: string[], packages: NamedPackageDir[]): string | undefined {
	if (packages.length === 0) return undefined;
	const names = new Set(fileIds.map((fileId) => owningPackageOf(fileId, packages)?.name));
	const [only] = names;
	return names.size === 1 && only !== undefined ? only : undefined;
}

// documentation/adr/0009 accepted a composite interpolated name as "verbose but still more informative
// than an ordinal label," deliberately left uncapped - "revisit if a real codebase produces an
// unreadably long interpolated name in practice." Running the generator against a real, large
// monorepo did: a root package with its application code split across 20+ top-level folders
// (`src/cli/`, `src/ui/`, `src/utils/`, ...), all landing in one Module with no closer common
// ancestor than `src` itself, produced a 20-plus-segment name. Past a handful of joined segments, a
// composite name stops being something a human or agent can usefully scan and becomes exactly as
// uninformative as an ordinal label - so beyond `MAX_DIRECTORY_BREADTH` (shared with
// `louvain-module-detector.ts`'s own community-refinement trigger, documentation/adr/0051), `joinChildSegments`
// below treats it as "nothing usable to interpolate," falling through to the owning Package's name
// instead (documentation/adr/0041, documentation/adr/0046) when that Package is this Module's only one, or
// straight to the ordinal label otherwise (documentation/adr/0050) - unlike a Module with nothing to
// interpolate at all, which always gets the Package-name fallback regardless.

// Joins child-segment counts into a composite name ordered by file count (ties broken
// alphabetically) - e.g. `core+__tests__` (documentation/adr/0009). `null` when there's nothing to join
// (zero children) or, per documentation/adr/0046, too many (beyond `MAX_DIRECTORY_BREADTH`) to stay
// scannable. Still derived purely from each file's own id already in the graph, not a fabricated
// guess.
function joinChildSegments(counts: Map<string, number>): string | null {
	if (counts.size === 0 || counts.size > MAX_DIRECTORY_BREADTH) return null;

	return [...counts.entries()]
		.sort(([nameA, countA], [nameB, countB]) => (countB !== countA ? countB - countA : nameA.localeCompare(nameB)))
		.map(([name]) => name)
		.join("+");
}

// Every owning-Package name that more than one Module resolves to (via `singlePackageNameOf`),
// mapped to how many Modules share it - documentation/adr/0050's input for deciding whether naming an
// overflowing Module after its Package would be honest (the Package's only Module) or misleading
// (one of several the Package already owns, each presumably named for its own real sub-domain).
//
// "Owns other Modules" alone isn't quite the right test, though (documentation/adr/0055): a Package's own
// entrypoint files - directly in its `src/`, with every other Module nested in a subdirectory below
// that - are genuinely that Package's root, and the other Modules are naturally understood as the
// root's own sub-areas, not unrelated peers. Naming the root module after the Package there isn't
// misrepresenting it as the whole Package, it's the most accurate name available. What's actually
// dishonest is a Module that's merely a *peer* of its Package's other Modules - sitting at the same
// depth, scattered sideways rather than nested beneath any of them - claiming the Package's name as
// if it were special among equals. `isPackageRootModule` below tells these apart structurally: is
// this Module's own common ancestor a prefix of every other same-Package Module's, i.e. does every
// other one of the Package's Modules live somewhere underneath this one.
function isPrefixOf(prefix: string[], segments: string[]): boolean {
	return prefix.length <= segments.length && prefix.every((segment, index) => segment === segments[index]);
}

function isPackageRootModule(
	moduleId: number,
	ownPackageName: string | undefined,
	childSegmentCount: number,
	meaningfulDirById: Map<number, string[]>,
	packageNameById: Map<number, string | undefined>,
): boolean {
	if (ownPackageName === undefined) return false;
	const ownDir = meaningfulDirById.get(moduleId) ?? [];
	let hasSibling = false;
	for (const [otherId, otherPackageName] of packageNameById) {
		if (otherId === moduleId || otherPackageName !== ownPackageName) continue;
		hasSibling = true;
		if (!isPrefixOf(ownDir, meaningfulDirById.get(otherId) ?? [])) return false;
	}
	// No sibling Module at all: this Module already represents the whole Package on its own
	// (documentation/adr/0041's original single-Module-Package case), regardless of how it got here - an
	// overflowing Module with nothing else in its Package is still that Package's only Module.
	if (!hasSibling) return true;
	// With real siblings, only a genuine zero-children root (every sibling nested below this Module,
	// with nothing of its own left over to interpolate) earns the Package's name - an overflowing
	// Module's own shallow common ancestor can coincidentally "prefix" a sibling's deeper one without
	// actually being its conceptual root, the same way `valora`'s own scattered, 83-file Module did
	// before documentation/adr/0051 split it up.
	return childSegmentCount === 0;
}

// Every distinct `moduleId` referenced by `nodes`, mapped to its member files' ids. Unassigned
// files (`moduleId === null`) and non-file nodes carry no Module membership, so they're excluded.
function groupFileIdsByModuleId(nodes: GraphNode[]): Map<number, string[]> {
	const fileIdsByModuleId = new Map<number, string[]>();
	for (const node of nodes) {
		if (!isFileNode(node) || node.moduleId === null) continue;
		const fileIds = fileIdsByModuleId.get(node.moduleId) ?? [];
		fileIds.push(node.id);
		fileIdsByModuleId.set(node.moduleId, fileIds);
	}
	return fileIdsByModuleId;
}

interface RawSummary {
	id: number;
	topName: string;
	deepName: string;
	interpolatedName: string;
	packageName: string;
}

// One Module's candidate names before collision resolution: the pre-documentation/adr/0012 top-level name,
// the pre-documentation/adr/0013 deeper name that disambiguates it, a third, still deeper composite name
// (one level past the Module's own common ancestor) for when even the deeper name collides, and a
// fourth, owning-Package name for when even that collides (documentation/adr/0041) - or (documentation/adr/0010)
// the fixed "tests" name for a Module made entirely of test files, bypassing folder-derived naming
// since its files were never grouped by folder in the first place.
//
// `deepName` is the last segment of the Module's own common ancestor, so it's only a genuine
// disambiguator when that ancestor is more than one segment deep. A Module whose common ancestor
// bottoms out at a single segment (e.g. every file sits somewhere under `extraction/`, with no
// shared subdirectory below that) has `topName === deepName` - the same string can't disambiguate
// against itself, so `interpolatedName` (one level past that single segment) is what actually
// distinguishes it from a sibling Module that also bottoms out there. When there's nothing usable
// to interpolate there either - whether because every file sits with zero directory depth past the
// common ancestor (a monorepo package's own entrypoint files directly in its `src/`, say) or because
// there were instead *too many* children to usefully join (documentation/adr/0046) - `interpolatedName`
// falls back to the Module's owning-Package name, but only for a Module that's genuinely its
// Package's own root (documentation/adr/0050, documentation/adr/0054, documentation/adr/0055): zero children *and*
// every other Module the Package owns lives in a subdirectory beneath this one
// (`isPackageRootModule`). A Module that instead sits as a *peer* of its Package's other Modules -
// same depth, scattered sideways rather than nested beneath any of them, documentation/adr/0055's distinction
// from the simpler "owns more than one Module" check documentation/adr/0050 first tried - would otherwise
// claim the Package's name as if it stood for the Package as a whole.
//
// When that fallback isn't honest, the filler used instead is this Module's own deepest *real*
// directory segment (documentation/adr/0054) - not a bare per-Module ordinal. A `Module ${id}` filler would
// already be unique by construction, so two sibling Modules that both lack an honest Package name for
// the exact same reason would each "succeed" on their own private ordinal before ever reaching
// documentation/adr/0052's numbering step - silently losing the one real fact they still share (the
// directory). The real directory segment is shared by every Module in the identical situation, so
// they continue colliding through the remaining tiers exactly as they should, reaching documentation/adr/0052's
// numbering honestly instead of bypassing it by accident. Only when there's no real directory segment
// at all either (a Module whose files share no common ancestor whatsoever) does a bare `Module ${id}`
// ordinal apply - the one truly irreducible case, with nothing non-fabricated left to offer.
function rawSummaryOf(
	moduleId: number,
	fileIds: string[],
	rootSegment: string | null,
	packages: NamedPackageDir[],
	meaningfulDirById: Map<number, string[]>,
	packageNameById: Map<number, string | undefined>,
): RawSummary {
	if (fileIds.every(isTestFile)) {
		return {
			id: moduleId,
			topName: "tests",
			deepName: "tests",
			interpolatedName: "tests",
			packageName: "tests",
		};
	}

	const commonDir = longestCommonPrefix(fileIds.map(containerDirSegments));
	const meaningfulDir = commonDir[0] === rootSegment ? commonDir.slice(1) : commonDir;
	const childSegments = distinctChildSegments(fileIds, commonDir.length);
	const joined = joinChildSegments(childSegments);
	const ownPackageName = singlePackageNameOf(fileIds, packages);
	const packageFallbackIsHonest = isPackageRootModule(
		moduleId,
		ownPackageName,
		childSegments.size,
		meaningfulDirById,
		packageNameById,
	);
	const fallbackFiller = meaningfulDir[meaningfulDir.length - 1] ?? `Module ${moduleId}`;
	const packageName = packageFallbackIsHonest ? (ownPackageName ?? fallbackFiller) : fallbackFiller;
	const interpolated = joined ?? packageName;
	return {
		id: moduleId,
		topName: meaningfulDir[0] ?? interpolated,
		deepName: meaningfulDir[meaningfulDir.length - 1] ?? interpolated,
		interpolatedName: interpolated,
		packageName,
	};
}

const NAME_TIERS = [
	"topName",
	"deepName",
	"interpolatedName",
	"packageName",
] as const satisfies readonly (keyof RawSummary)[];

// Groups the still-unsettled summaries by their candidate name at this tier - order-preserving,
// so the result stays deterministic regardless of insertion order.
function groupByTierName(rawSummaries: RawSummary[], tier: (typeof NAME_TIERS)[number]): Map<string, RawSummary[]> {
	const groups = new Map<string, RawSummary[]>();
	for (const raw of rawSummaries) {
		const name = raw[tier];
		const group = groups.get(name) ?? [];
		group.push(raw);
		groups.set(name, group);
	}
	return groups;
}

// Resolves every Module's final name by walking the four candidate tiers in order
// (documentation/adr/0012, documentation/adr/0013, documentation/adr/0009/documentation/adr/0035, documentation/adr/0041) and, at each one, settling
// any Module whose candidate there is both unique among the Modules still unsettled *and* not
// already claimed by a Module that settled at an earlier tier.
//
// The second condition is what distinguishes this from "collide now, fall back together every
// time": a name an earlier tier already resolved stays reserved, so a *later*-arriving Module that
// only reaches the identical string by falling further down its own chain can't retroactively
// reopen it - it keeps falling instead (documentation/adr/0042). `src/output/html/`'s and `src/output/json/`'s
// Modules both reach their deepName at the very same tier, so neither has priority over the other
// and both tiers' names settle together exactly as before; a Module whose common ancestor already
// is its clean, unique directory name a tier earlier keeps that name instead of being needlessly
// bumped just because some unrelated Module's own fallback chain happens to land on the identical
// string later. Every Module still unsettled once all four tiers are exhausted is numbered against
// whichever other still-unsettled Modules share its `deepName` (`cli-1`, `cli-2`, ... - documentation/adr/0052),
// falling back further to the ordinal `Module <id>` label only when even that's unavailable (a lone
// Module with nothing left to number against, or a shared `deepName` an earlier tier already
// reserved for someone else).
// Settles every summary that's alone at this tier's name and not already reserved, reserving that
// name against later tiers; returns whoever is left (still colliding with a same-tier peer, or
// blocked by an earlier tier's reservation) to try the next tier instead.
function settleUniqueAtTier(
	unsettled: RawSummary[],
	tier: (typeof NAME_TIERS)[number],
	finalNameById: Map<number, string>,
	reservedNames: Set<string>,
): RawSummary[] {
	const stillUnsettled: RawSummary[] = [];
	for (const [name, group] of groupByTierName(unsettled, tier)) {
		const [only] = group;
		if (group.length === 1 && only !== undefined && !reservedNames.has(name)) {
			finalNameById.set(only.id, name);
			reservedNames.add(name);
			continue;
		}
		stillUnsettled.push(...group);
	}
	return stillUnsettled;
}

function resolveNamesByPriority(rawSummaries: RawSummary[]): ModuleSummary[] {
	const finalNameById = new Map<number, string>();
	const reservedNames = new Set<string>();

	let unsettled = rawSummaries;
	for (const tier of NAME_TIERS) {
		unsettled = settleUniqueAtTier(unsettled, tier, finalNameById, reservedNames);
	}

	// Every Module reaching this point collided with at least one sibling at *every* tier, including
	// `deepName` - the most specific, purely structural fact still available about it (the real
	// directory it lives in). Two or more Modules that still share nothing else can at least share
	// that: numbering them against each other (`cli-1`, `cli-2`) is strictly more honest than an
	// unrelated ordinal per Module, since it tells a reader "two distinct things live in `cli`,
	// structurally indistinguishable beyond that" instead of nothing at all (documentation/adr/0052). A
	// `deepName` already reserved by a different, earlier-settled Module is never reused as a prefix
	// here, even for a lone remaining Module - that name belongs to someone else.
	for (const [deepName, group] of groupByTierName(unsettled, "deepName")) {
		if (group.length < 2 || reservedNames.has(deepName)) {
			for (const raw of group) finalNameById.set(raw.id, `Module ${raw.id}`);
			continue;
		}
		[...group]
			.sort((a, b) => a.id - b.id)
			.forEach((raw, index) => {
				finalNameById.set(raw.id, `${deepName}-${index + 1}`);
			});
	}

	return rawSummaries.map(({ id }) => ({
		id,
		name: finalNameById.get(id) ?? `Module ${id}`,
	}));
}

// Derives a display name for every Module referenced by `nodes`, one summary per distinct `moduleId`.
//
// A Module is a DDD-inspired domain boundary (`CONTEXT.md`'s Module section) that frequently,
// but not always, coincides with a directory. Its name is normally the top-level directory (the
// first segment) of its member files' nearest common ancestor, with the codebase-wide root
// segment (if any) stripped first (documentation/adr/0012) - e.g. files under `src/discovery/filesystem/`
// name the Module `discovery`, not `filesystem`, so every name sits at the same, comparable depth
// regardless of how deep a particular Module's common ancestor happens to be. In a monorepo where
// every file lives under some `packages/<name>/` prefix, that same rule makes `<name>` - the
// package - the top-level segment, which is the real domain boundary there.
//
// When that top-level name collides between two or more Modules (e.g. `src/output/html/` and
// `src/output/json/` both landing on `output`), the deepest segment of the common ancestor - the
// pre-documentation/adr/0012 name (`html`, `json`) - is tried instead, since it's still real, still derived
// from the graph, and actually distinguishes the colliding Modules (documentation/adr/0013). When the files
// share nothing closer than the root, their distinct child directories are interpolated into a
// composite name instead (documentation/adr/0009) - and that same interpolation is tried as a third tier even
// when the common ancestor isn't empty, for the case where it bottoms out at a single segment (documentation/adr/0035), so
// the top-level and deeper names are identical and can't disambiguate each other): a Module scattered
// under `extraction/tree-sitter-go/` and one scattered under `extraction/tree-sitter-java/` both
// have common ancestor `extraction` alone, but their child directories one level past it still
// differ. If that still collides, the Module's owning Package's own declared name is tried next -
// the genuinely meaningful "top level" in a monorepo laid out as `packages/<name>/src/...`, where
// neither the literal top segment (`packages`) nor the package-relative one (`src`) distinguishes
// anything (documentation/adr/0041). Only if that still collides too, or there's no directory or Package
// information to build a name from at all, does a Module fall back to the ordinal `Module <id>`
// label - preceded by one last attempt to number it against whichever other still-colliding Modules
// share its deepest real directory name instead (`cli-1`, `cli-2`, documentation/adr/0052), when that's
// available. A Module whose files scatter across too many child directories to interpolate at all
// (documentation/adr/0046) skips the Package name and goes straight to that same fallback chain too,
// unless this Module happens to be its Package's only one (documentation/adr/0050) - otherwise the Package
// name would misrepresent one scattered Module among several as if it were the Package as a whole.
//
// A derived name that more than one Module lands on is just as uninformative as no name at all -
// worse, it makes distinct Modules look identical. A name an earlier tier already settled on a
// different Module is reserved and can't be reclaimed by a later-arriving one that only reaches
// the identical string by falling further down its own chain (documentation/adr/0042) - two Modules that
// collide at the very same tier still fall back together, unchanged.
export function deriveModuleNames(nodes: GraphNode[]): ModuleSummary[] {
	const fileIdsByModuleId = groupFileIdsByModuleId(nodes);
	const rootSegment = universalRootSegment(nodes);
	const packages = packagesOf(nodes);
	const idsAndFileIds = [...fileIdsByModuleId.entries()].sort(([a], [b]) => a - b);

	// Pre-pass: every Module's own common ancestor and owning Package, computed up front so
	// `isPackageRootModule` can check one Module's directory against every *other* same-Package
	// Module's - information only available once all of them have been looked at once.
	const meaningfulDirById = new Map<number, string[]>();
	const packageNameById = new Map<number, string | undefined>();
	for (const [moduleId, fileIds] of idsAndFileIds) {
		if (fileIds.every(isTestFile)) continue;
		const commonDir = longestCommonPrefix(fileIds.map(containerDirSegments));
		meaningfulDirById.set(moduleId, commonDir[0] === rootSegment ? commonDir.slice(1) : commonDir);
		packageNameById.set(moduleId, singlePackageNameOf(fileIds, packages));
	}

	const rawSummaries = idsAndFileIds.map(([moduleId, fileIds]) =>
		rawSummaryOf(moduleId, fileIds, rootSegment, packages, meaningfulDirById, packageNameById),
	);

	return resolveNamesByPriority(rawSummaries);
}
