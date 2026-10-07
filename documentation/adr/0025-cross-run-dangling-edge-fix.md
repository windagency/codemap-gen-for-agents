# 0025: A cached import into a file that broke this run is corrected in the orchestrator, not `GraphBuilder`

[Back to documentation/adr/README.md](README.md)

## Status

Accepted.

## Context

Ticket 13's unparseable-file policy guarantees that another file's import into a skipped file is treated as unresolved, never a dangling edge target - but that guarantee, as shipped, only held *within a single `Parser.parse` call*. `TsCompilerApiParser.resolveImportTarget` determines its own run's full skip-set before finalizing any file's import resolution (`context.skippedFiles`), so a same-run unparseable target is already corrected before it ever leaves `Parser`.

Incremental regeneration (`createCodemapGenerator` in `src/core/generate-map.ts`, the normal `force: false` path most runs take) breaks that guarantee across runs. Scenario: run 1 extracts file A, whose import resolves to file B (`{ kind: "file", filePath: B }`), and caches that extraction. Run 2 changes file B's content such that it becomes unparseable this run; file A is untouched, so its cached entry - including the now-stale `{ kind: "file", filePath: B }` target - is reused unmodified. `B` produces no `FileNode` this run, so `GraphBuilder` would receive an edge pointing at a node that doesn't exist: a dangling edge, silently violating the very guarantee ticket 13 already ships and tests.

## Decision

The correction lives in `generate-map.ts`'s orchestrator, in a new `rewriteDanglingFileImports` step run after `skippedRelativePaths`/`structureForGraph` are known and before `symbols` reaches `GraphBuilder.build`: any import (from a cached or freshly-extracted file, treated uniformly) whose `resolvedTarget.kind === "file"` but whose target path is not in this run's final `structureForGraph.programFiles` is rewritten to `{ kind: "unresolved" }` - the same classification a same-run unresolvable specifier already gets.

**Why the orchestrator, not `GraphBuilder`:** `GraphBuilder` is a pure assembler of already-resolved inputs (`documentation/adr/0003`) - it has no notion of "this run" vs. "a prior run," and teaching it a second, independent reason an edge can be dropped would duplicate "what counts as unresolved" across two seams instead of keeping it defined in exactly one place (the same reasoning ticket 13 already used to put the same-run check inside `Parser`, not `GraphBuilder`). The orchestrator is the one place that already knows both `structureForGraph` (this run's final, post-skip file set) and `symbols` (the merged cached+fresh extraction) before they cross into `GraphBuilder`, making it the natural seam to reconcile the two.

**Why no cache format change:** the fix is derived fresh from `structureForGraph.programFiles` on every run, never persisted. A file's own cache entry keeps storing the parser's raw, unmodified extraction output; once its previously-stale import target becomes valid again on a later run, the rewrite simply stops firing - self-healing with no invalidation logic needed.

## Consequences

- `src/core/generate-map.ts` gains `rewriteDanglingFileImports`, called between `buildStructureForGraph` and `graphBuilder.build`.
- No change to `GraphBuilder`'s contract, its own tests, or the cache file's persisted shape (`CacheFile["files"]` in `src/core/cache/extraction-cache.ts`).
- `generate-map.test.ts`'s "cross-run dangling edge" suite covers the two-run scenario above at the orchestrator level (asserting what `GraphBuilder.build` receives), mirroring the existing stubbed-dependency convention already used for other cache-behavior assertions in that file.
