import type { DiscoveredStructure } from "src/core/types";
import { FilesystemDiscovery } from "src/discovery/filesystem/filesystem-discovery";

// A fifth pipeline seam, directly injected like ModuleDetector - no Factory, single
// implementation (documentation/adr/0003-generator-pipeline-seams.md). Runs once per `generate` call,
// ahead of Parser; not cached between runs, since it's a cheap walk and Package/Directory
// boundaries can shift even when no file's content changed.
export interface Discovery {
	discover(rootDir: string, exclude: string[], includeTests?: boolean): DiscoveredStructure;
}

export function createDiscovery(): Discovery {
	return new FilesystemDiscovery();
}
