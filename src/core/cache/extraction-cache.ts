import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseCacheFile } from "src/core/cache/cache-schema";
import type { ExtractedSymbols } from "src/core/types";

// documentation/adr/0005-incremental-extraction-caching.md: per-file ExtractedSymbols cache, keyed by
// content hash, guarded by an epoch hash of everything else that could change extraction
// semantics without touching file content (generator version, tsconfig, config excludes,
// whether test files are included, dependency manifests and lockfiles). The first four change
// the file set handed to Parser's program; the last changes External versions.
export interface CacheFile {
	epoch: string;
	files: Record<string, { contentHash: string; extractedSymbols: ExtractedSymbols }>;
}

const EMPTY_CACHE: CacheFile = { epoch: "", files: {} };

function sha256Hex(input: crypto.BinaryLike): string {
	return crypto.createHash("sha256").update(input).digest("hex");
}

// Everything besides a file's own content that can change what `Parser` extracts from it.
export interface EpochInputs {
	generatorVersion: string;
	tsconfigRawText: unknown;
	excludePatterns: string[];
	includeTests: boolean;
	// Repo-relative path -> content of every dependency manifest and lockfile. External versions
	// are read from these, so editing one must invalidate every cached file.
	dependencyFiles: Record<string, string>;
	// `<language>:<index path>` -> content hash of every SCIP index this run reads
	// (documentation/adr/0056). Optional so a caller with no indexes keeps its old epoch inputs.
	scipIndexes?: Record<string, string>;
}

function sortedEntries(record: Record<string, string>): [string, string][] {
	return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

export function computeEpoch(inputs: EpochInputs): string {
	// Sorted (not the caller's raw order) so a reordered-but-otherwise-identical exclude *set* or
	// manifest set hashes the same and doesn't force an unnecessary full re-extraction.
	const payload = JSON.stringify({
		generatorVersion: inputs.generatorVersion,
		tsconfigCompilerOptions: inputs.tsconfigRawText,
		excludePatterns: [...inputs.excludePatterns].sort(),
		includeTests: inputs.includeTests,
		dependencyFiles: sortedEntries(inputs.dependencyFiles),
		scipIndexes: sortedEntries(inputs.scipIndexes ?? {}),
	});

	return sha256Hex(payload);
}

// A missing, corrupt, or wrong-shaped cache file degrades to an empty cache (ADR-0005's
// Consequences) rather than throwing - an empty epoch never matches a real one, so this also
// forces a full re-extraction on its own, with no special-casing needed at the call site.
export function loadCache(cachePath: string): CacheFile {
	if (!fs.existsSync(cachePath)) return EMPTY_CACHE;

	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
	} catch {
		return EMPTY_CACHE;
	}

	return parseCacheFile(raw) ?? EMPTY_CACHE;
}

// Unlike `loadCache`'s degrade-to-empty policy, a failed *write* has nothing safe to degrade
// to - the run's freshly-computed cache would simply be lost with no signal. So this boundary
// re-throws instead, wrapped with the path for context (disk full, permission denied, etc. are
// non-obvious from the bare `fs` error alone), matching `config.ts`'s `loadConfig` convention of
// a plain contextual `Error` at a filesystem/external-input boundary rather than a silent swallow.
export function saveCache(cachePath: string, cache: CacheFile): void {
	try {
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(cachePath, JSON.stringify(cache), "utf8");
	} catch (error) {
		throw new Error(`Failed to save extraction cache to ${cachePath}`, {
			cause: error,
		});
	}
}

export function hashFile(filePath: string): string {
	return sha256Hex(fs.readFileSync(filePath));
}

export function diffFiles(
	cache: CacheFile,
	files: string[],
	currentEpoch: string,
): {
	changed: string[];
	cached: Record<string, ExtractedSymbols>;
	// Every content hash this diff already computed while comparing against `cache` - one entry
	// per file that had an existing cache entry, whether it turned out unchanged or changed. Lets
	// a caller that later rewrites `cache.json` (`buildCacheFiles` in `generate-map.ts`) reuse the
	// hash for those files instead of re-reading and re-hashing the same bytes a second time.
	// A file with no prior entry isn't hashed here at all (nothing to compare it against), so it's
	// simply absent from this map.
	contentHashes: Record<string, string>;
} {
	if (cache.epoch !== currentEpoch) {
		return { changed: [...files], cached: {}, contentHashes: {} };
	}

	const changed: string[] = [];
	const cached: Record<string, ExtractedSymbols> = {};
	const contentHashes: Record<string, string> = {};

	for (const file of files) {
		const entry = cache.files[file];
		if (!entry) {
			changed.push(file);
			continue;
		}

		const contentHash = hashFile(file);
		contentHashes[file] = contentHash;
		if (entry.contentHash === contentHash) {
			cached[file] = entry.extractedSymbols;
		} else {
			changed.push(file);
		}
	}

	return { changed, cached, contentHashes };
}
