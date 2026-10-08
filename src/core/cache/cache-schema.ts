import type { CacheFile } from "src/core/cache/extraction-cache";
import { type ExtractedSymbols, LANGUAGES, SYMBOL_KINDS } from "src/core/types";
import { z } from "zod";

// Mirrors `ExtractedSymbols` (src/core/types.ts) closely enough to reject a wrong-shaped
// `cache.json`; `extractedSymbols` is otherwise passed straight through to consumers that
// already trust `Parser`'s output shape, so this only needs to catch a malformed *cache file*,
// not re-validate every field a trusted in-process producer already guarantees.
const edgeLocationSchema = z.object({
	startLine: z.number(),
	endLine: z.number(),
});

const symbolKindSchema = z.enum(SYMBOL_KINDS);

const languageSchema = z.enum(LANGUAGES);

const rawSymbolSchema = z.object({
	localId: z.string(),
	name: z.string(),
	symbolKind: symbolKindSchema,
	startLine: z.number(),
	endLine: z.number(),
	exported: z.boolean(),
	isTestItem: z.boolean().optional(),
});

const resolvedImportTargetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("file"), filePath: z.string() }),
	z.object({
		kind: z.literal("external"),
		packageName: z.string(),
		version: z.string(),
		language: languageSchema,
	}),
	z.object({ kind: z.literal("unresolved") }),
]);

const rawImportSchema = z.object({
	specifier: z.string(),
	viaReExport: z.boolean(),
	resolvedTarget: resolvedImportTargetSchema,
	locations: z.array(edgeLocationSchema),
});

const rawCallCandidateSchema = z.object({
	filePath: z.string(),
	localId: z.string(),
});

const rawCallSchema = z.object({
	callerLocalId: z.string(),
	candidates: z.array(rawCallCandidateSchema),
	locations: z.array(edgeLocationSchema),
});

const extractedSymbolsSchema = z.object({
	filePath: z.string(),
	symbols: z.array(rawSymbolSchema),
	imports: z.array(rawImportSchema),
	calls: z.array(rawCallSchema),
	indexFallback: z.enum(["index-stale", "index-uncovered"]).optional(),
}) satisfies z.ZodType<ExtractedSymbols>;

// `CONTRIBUTING.md`'s "all external input validated with Zod before use" - `cache.json` is
// hand-editable, on-disk external input, same as `codemap.config.json` (src/core/config.ts).
const cacheFileSchema = z.object({
	epoch: z.string(),
	files: z.record(
		z.string(),
		z.object({
			contentHash: z.string(),
			extractedSymbols: extractedSymbolsSchema,
		}),
	),
});

// `undefined` for anything that isn't a well-formed cache file; the caller degrades to empty.
export function parseCacheFile(raw: unknown): CacheFile | undefined {
	const result = cacheFileSchema.safeParse(raw);
	return result.success ? result.data : undefined;
}
