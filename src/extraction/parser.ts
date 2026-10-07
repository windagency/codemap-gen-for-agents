import type { ExtractedSymbols } from "src/core/types";

// Whole-program, not per-file: a real implementation needs every file loaded into one
// ts.Program to get type-checked cross-file call resolution (documentation/adr/0002).
//
// programFiles is always the complete current file set, so cross-file type resolution stays
// accurate; extractFiles is the content-hash-changed subset (documentation/adr/0005) - only those are
// actually walked and extracted, letting the orchestrator skip re-extracting unchanged files.
// rootDir locates `<rootDir>/tsconfig.json`, the one CompilerOptions set governing the whole
// program - never a workspace member's own tsconfig.json, even when one exists and diverges from the root.
export interface Parser {
	parse(rootDir: string, programFiles: string[], extractFiles: string[]): ExtractedSymbols[];
}
