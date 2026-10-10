import { z } from "zod";

// documentation/adr/0056 decision 4's sidecar: `<outDir>/scip/<packageId>.hashes.json`, each of a
// Package's files' content hash when the generator last indexed it, keyed by repo-relative path.
// Read back from disk, so validated like any other external input.
const indexHashesSchema = z.object({ files: z.record(z.string(), z.string()) }).strict();

export type IndexHashes = z.infer<typeof indexHashesSchema>;

// Anything unreadable reads as absent, which only costs a re-index.
export function parseIndexHashes(raw: unknown): IndexHashes | undefined {
	const result = indexHashesSchema.safeParse(raw);
	return result.success ? result.data : undefined;
}
