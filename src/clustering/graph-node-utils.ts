import { parsePackageDir } from "src/core/languages";
import type { FileNode, GraphNode, PackageNode } from "src/core/types";

// Shared by `module-naming.ts` and `louvain/louvain-module-detector.ts` - both need to narrow a
// `GraphNode` down to its file-kind member and read the directory segments a file's id implies,
// and neither owns that logic more than the other.
export function isFileNode(node: GraphNode): node is FileNode {
	return node.kind === "file";
}

export function containerDirSegments(fileId: string): string[] {
	return fileId.split("/").slice(0, -1);
}

// Shared by `module-naming.ts`'s `longestCommonPrefix` (the full common-prefix segments across N
// path-segment lists) and `louvain-module-detector.ts`'s `sharedDirDepth` (just the depth of the
// common prefix between two lists) - both walked their own copy of the same "compare segments
// until a mismatch" loop. Comparing every list against the first is equivalent to the previous
// pairwise-accumulating approach: the common prefix across all lists must equal the first list's
// own segments at every shared position, so the first list is as valid a reference as any.
export function longestCommonPrefixLength(segmentLists: string[][]): number {
	const [first, ...rest] = segmentLists;
	if (first === undefined) return 0;

	let length = first.length;
	for (const segments of rest) {
		let i = 0;
		while (i < length && i < segments.length && first[i] === segments[i]) {
			i++;
		}
		length = i;
		if (length === 0) break;
	}
	return length;
}

// Threshold shared by `module-naming.ts`'s composite-name cap (documentation/adr/0046) and
// `louvain-module-detector.ts`'s community-refinement trigger (documentation/adr/0051): the number of
// distinct child directories past a common ancestor beyond which a group of files stops reading as
// one coherent area - whether that means "too long a joined name" (naming) or "broad enough to
// suspect a resolution-limit artifact is hiding real substructure" (clustering). One constant, not
// two independently-tuned ones, since nothing on record suggests these two concerns need different
// values - revisit if that changes.
export const MAX_DIRECTORY_BREADTH = 4;

// The distinct directory segments one level past `depth` across a set of file ids, tallied by file
// count. `depth` is normally a Module's own common-ancestor length, so this reads each file's
// immediate child directory below whatever the files already agree on, however deep that happens to
// be. Shared by `module-naming.ts` (composite name interpolation, documentation/adr/0009, documentation/adr/0046) and
// `louvain-module-detector.ts` (the community-refinement trigger, documentation/adr/0051) - both need to
// know not just whether a group of files joins into something nameable, but how broad it is.
export function distinctChildSegments(fileIds: string[], depth: number): Map<string, number> {
	const counts = new Map<string, number>();
	for (const fileId of fileIds) {
		const child = containerDirSegments(fileId)[depth];
		if (child === undefined) continue;
		counts.set(child, (counts.get(child) ?? 0) + 1);
	}
	return counts;
}

export interface NamedPackageDir {
	dirSegments: string[];
	name: string;
}

// Every Package node's directory, as path segments - `[]` for the repo-root Package
// (`parsePackageDir` strips a co-located `@family` suffix first, documentation/adr/0034). Every Package
// matches every file trivially via `[]`, so this exists as the "nothing more specific claimed it"
// floor, not a real boundary of its own. Shared by `module-naming.ts` (the Package naming tier,
// documentation/adr/0041) and `louvain-module-detector.ts` (the Package-atomicity invariant,
// documentation/adr/0049) - both need the identical "which Package owns this file" answer.
export function packagesOf(nodes: GraphNode[]): NamedPackageDir[] {
	return nodes
		.filter((node): node is PackageNode => node.kind === "package")
		.map((node) => {
			const dir = parsePackageDir(node.id);
			return { dirSegments: dir === "." ? [] : dir.split("/"), name: node.name };
		});
}

function isPathPrefix(prefix: string[], segments: string[]): boolean {
	return prefix.length <= segments.length && prefix.every((segment, index) => segment === segments[index]);
}

// The Package that owns a given file: whichever Package's directory is the *longest* matching
// prefix of the file's own containing directory, so a nested Package (e.g. `packages/foo/`) wins
// over the repo-root one for files beneath it. `undefined` if no Package node is present at all (a
// graph built without Discovery's Package data).
export function owningPackageOf(fileId: string, packages: NamedPackageDir[]): NamedPackageDir | undefined {
	const fileDirSegments = containerDirSegments(fileId);
	let best: NamedPackageDir | undefined;
	for (const pkg of packages) {
		if (!isPathPrefix(pkg.dirSegments, fileDirSegments)) continue;
		if (best === undefined || pkg.dirSegments.length > best.dirSegments.length) {
			best = pkg;
		}
	}
	return best;
}
