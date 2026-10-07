import path from "node:path";

// A surviving `node_modules` path segment on the *real* (symlink-resolved) path means External -
// one rule that handles npm/Yarn/pnpm workspace symlinks uniformly, with no package-manager-
// specific branching (spec's decision). `Program.getSourceFileMetadata().isFromExternalLibrary`
// looks like a ready-made version of this same check, but isn't one: it actually reflects whether
// the file was reached only via resolution rather than the project's own root/`include` file list
// - true for a workspace package's files whenever the root tsconfig's `include` doesn't happen to
// also cover them, even though their real path sits outside `node_modules` entirely. Hence the
// manual segment check here instead.
export function isUnderNodeModules(absolutePath: string): boolean {
	return absolutePath.split(path.sep).includes("node_modules");
}
