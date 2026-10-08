import type { IndexFallbackReason } from "src/core/types";

// A SCIP index this run could not use, for one file or as a whole (documentation/adr/0056). The
// file stays in the map with tree-sitter's candidates; only the index's refinement is missing.
export type IndexWarningReason = IndexFallbackReason | "index-unreadable";

export interface IndexWarning {
	reason: IndexWarningReason;
	file: string; // repo-relative for a source file; the index path as given for an unreadable index
	detail?: string; // why an index was unreadable
}

const WARNING_PREFIX: Readonly<Record<IndexFallbackReason, string>> = {
	"index-stale": "SCIP index is stale, used tree-sitter resolution: ",
	"index-uncovered": "Not in SCIP index, used tree-sitter resolution: ",
};

// The human-readable line `codemap.json`'s `warnings` field carries (documentation/adr/0029).
export function formatIndexWarning({ reason, file, detail }: IndexWarning): string {
	if (reason === "index-unreadable") return `Unreadable SCIP index ${file}: ${detail ?? "unknown reason"}`;
	return `${WARNING_PREFIX[reason]}${file}`;
}
