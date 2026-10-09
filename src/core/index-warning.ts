import type { IndexFallbackReason } from "src/core/types";

// A SCIP index this run could not use, for one file or as a whole (documentation/adr/0056). The
// file stays in the map with tree-sitter's candidates; only the index's refinement is missing.
export type IndexWarningReason = IndexFallbackReason | "index-unreadable" | "indexer-failed" | "indexer-check-failed";

export interface IndexWarning {
	reason: IndexWarningReason;
	// Repo-relative for a source file; the index path as given for an unreadable index; the
	// Package id for a failed indexer run.
	file: string;
	detail?: string; // why an index was unreadable, or why an indexer run or its check failed
	indexer?: string; // the indexer that failed, or the check, such as `go build`
}

const WARNING_PREFIX: Readonly<Record<IndexFallbackReason, string>> = {
	"index-stale": "SCIP index is stale, used tree-sitter resolution: ",
	"index-uncovered": "Not in SCIP index, used tree-sitter resolution: ",
};

// The human-readable line `codemap.json`'s `warnings` field carries (documentation/adr/0029).
export function formatIndexWarning({ reason, file, detail, indexer }: IndexWarning): string {
	if (reason === "index-unreadable") return `Unreadable SCIP index ${file}: ${detail ?? "unknown reason"}`;
	if (reason === "indexer-failed") {
		return `SCIP indexer ${indexer ?? "unknown"} failed for package ${file}, used tree-sitter resolution: ${detail ?? "unknown reason"}`;
	}
	if (reason === "indexer-check-failed") {
		return `${indexer ?? "unknown"} failed for package ${file}, its SCIP index may be incomplete: ${detail ?? "unknown reason"}`;
	}
	return `${WARNING_PREFIX[reason]}${file}`;
}
