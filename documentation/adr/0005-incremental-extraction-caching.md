# 0005: Incremental extraction caching

[Back to documentation/adr/README.md](README.md) • [Back to HLD.md](../HLD.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md)

## Status

Accepted. Amends ADR-0003's `Parser` interface. `codemap-extraction-algorithm`'s Import resolution, re-export handling & External nodes ticket landed this ADR's "resolved tsconfig compilerOptions" epoch input as the root `tsconfig.json`'s raw file content instead - see Consequences.

## Context

The map's Notes settled two things before any ticket touched implementation: change detection is content-hash based, and "Module clustering always recomputes globally over the full updated graph every run; only extraction/parsing is incremental." Ticket 06 needed to make that second sentence concrete, and doing so ran straight into ADR-0003's own `Parser` design:

- ADR-0003 fixed `Parser.parse(files: string[]): ExtractedSymbols[]` as one whole-program call, precisely because the TypeScript Compiler API's type-checked cross-file call resolution (ADR-0002's reason for choosing it over tree-sitter) only works if the entire file set is loaded into one `ts.Program`. A strictly per-file parser can't do this at all.
- But "only extraction is incremental" only means something if a single file's edit doesn't force every other unchanged file to be re-walked and re-extracted too. Under ADR-0003's original signature, the only way to skip extraction work is to skip calling `Parser.parse()` altogether when nothing changed - which makes any single edit in a large repo fall back to a full re-extraction of every file, defeating the point of this ticket.

The fix has to preserve whole-program type resolution while still letting per-file extraction be skipped for unchanged files - those are different requirements on different axes (what the type checker sees, vs. which files get walked for symbols/edges), and ADR-0003's single `files: string[]` parameter conflated them.

## Decision

`Parser`'s interface gains a second parameter, splitting "files the `ts.Program` is built over" from "files actually extracted":

```ts
interface Parser {
  parse(programFiles: string[], extractFiles: string[]): ExtractedSymbols[];
}
```

`programFiles` is always the complete current file set, so cross-file type resolution stays exactly as accurate as ADR-0003 required. `extractFiles` is the content-hash-changed subset; only those get walked and extracted. `GraphBuilder` and `ModuleDetector` are untouched by this change - they still run over the complete, full-graph `ExtractedSymbols[]` (fresh entries for changed files, cached entries for the rest) on every run, exactly as ADR-0003 and the map's Notes already specified.

**Cache storage:** per-file `ExtractedSymbols`, at `<outDir>/cache.json` - the same directory as the two public artifacts, never embedded in `codemap.json` itself (ticket 03 already excludes non-deterministic or bookkeeping fields from that schema).

```ts
interface CacheFile {
  epoch: string;
  files: Record<string, { contentHash: string; extractedSymbols: ExtractedSymbols }>;
}
```

**Invalidation:** `epoch` is a hash of `(generator version, resolved tsconfig compilerOptions, config's exclude patterns)`. A mismatch discards the whole cache and forces a full fresh extraction - chosen over trying to enumerate every way a non-content change could affect extraction semantics, since missing one such case silently would produce a wrong (not just slow) map. A matching epoch falls through to ordinary per-file content-hash diffing: a newly-excluded file's entry is simply never read, and a newly-included file has no entry and is treated as changed - neither case needs special handling.

**Force bypass:** CLI `--force` and MCP `generate`'s `force?: boolean` (ADR-0004) both skip the cache entirely and write a fresh cache file with a fresh epoch.

## Consequences

- ADR-0003's `Parser` interface and its accompanying `arch-unit-ts` dependency-direction rule need updating to reflect the two-parameter signature; implementations built against the original single-parameter signature need a matching update.
- `cache.json`'s shape is allowed to change between generator versions without being a breaking change to the public output contract, since it's never part of `codemap.json` and any shape it doesn't recognize is just treated as an epoch mismatch.
- A corrupt or hand-edited `cache.json` degrades safely to a full regeneration (fails epoch comparison or per-file lookup, both of which already fall back to fresh extraction) rather than needing its own validation layer.
- **Epoch's tsconfig input is the raw file, not the resolved options.** Computing the fully `extends`-resolved `CompilerOptions` this ADR's Decision names would mean running the compiler API a second time purely to compute the epoch, before knowing which files even need extracting - a real restructuring this ticket didn't take on. Hashing `<rootDir>/tsconfig.json`'s raw text (or `null` if absent) instead catches every direct edit to it, which is the common case; it does not invalidate the cache when only a transitively-`extends`-ed base config changes underneath it, an accepted gap.

## Update: dependency manifests are part of the epoch

External versions are read from dependency manifests and lockfiles, not from any source file's own content, so a `go.mod` bump used to be served stale from cache until `--force`. The epoch now also hashes the content of every manifest and lockfile at the repo root and at each Package root: `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `go.mod`, `go.sum`, `Cargo.toml`, `Cargo.lock`, `pom.xml`, `pyproject.toml` (`DEPENDENCY_FILE_NAMES` in `src/core/languages.ts`). Editing any of them forces a full re-extraction. An `npm install` that changes installed versions without touching a lockfile is still not detected; `--force` covers it.
