// A file the run left out of the map, and why. Two reasons, worded distinctly so a reader can
// tell which fix applies: an unparseable file needs a syntax fix, a manifest-less one needs a
// manifest added above it (documentation/adr/0002's "Update" section).
export type SkipReason = "manifest-less" | "unparseable";

export interface SkippedFile {
	file: string;
	reason: SkipReason;
}

const WARNING_PREFIX: Readonly<Record<SkipReason, string>> = {
	"manifest-less": "Skipped manifest-less file: ",
	unparseable: "Skipped unparseable file: ",
};

// The human-readable line `codemap.json`'s `warnings` field carries (documentation/adr/0029).
export function formatSkippedFile({ file, reason }: SkippedFile): string {
	return `${WARNING_PREFIX[reason]}${file}`;
}
