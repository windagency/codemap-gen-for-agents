---
name: codemap
description: Generate and query a structural map (Package/Directory/File/Symbol graph, with algorithmically-detected Module domains and static import/call edges) of a TS/JS, Go, Rust, Java, or Python monorepo, without re-parsing the codebase by hand.
---

# codemap

A companion script over the code-map generator's shared core pipeline. Use it instead of manually crawling the repo file by file to answer "where does X live", "what does this file import", or "what calls this function".

## Commands

Run the companion script bundled next to this file: `node "${CLAUDE_SKILL_DIR}/main.js" <generate|read> [flags]`. Always use that absolute path - it resolves the same way regardless of the shell's working directory. Each invocation prints exactly one JSON object to stdout - parse it as JSON, don't scrape stdout as text. An unknown flag, or a flag missing its value, exits 1 with the reason on stderr. `--help` or `-h` prints the usage and every flag to stdout and exits 0.

### `generate`

Runs the pipeline and writes `codemap.json`/`codemap.html` to disk.

```
node "${CLAUDE_SKILL_DIR}/main.js" generate [--root <dir>] [--out <dir>] [--config <path>] [--force] [--include-tests] [--scip-index <language>=<path>] [--run-indexers]
```

- `--root` - the repo to analyze; defaults to the current working directory.
- `--out` - where to write `codemap.json`/`codemap.html`; defaults to `.codemap/` under `--root`, or the `codemap.config.json`'s `outDir` if set.
- `--config` - an explicit config file path; defaults to `<root>/codemap.config.json`.
- `--force` - bypasses the incremental extraction cache.
- `--include-tests` - includes test files (each language's own convention; for TS/JS, `*.test.*`/`*.spec.*` or anything under `test/`, `tests/`, `__tests__/`) in discovery and Module clustering instead of excluding them by default ([ADR-0011](../../../documentation/adr/0011-exclude-test-files-by-default.md)); they're clustered into one dedicated `tests` Module rather than grouped by folder ([ADR-0010](../../../documentation/adr/0010-test-files-are-their-own-module.md)). Changes the cache epoch, so toggling it forces a full re-extraction the next run.
- `--scip-index <language>=<path>` - a `scip-python`, `scip-go`, or `rust-analyzer` index, `python=`, `go=`, or `rust=`, that narrows that language's call candidates to their type-checked target ([ADR-0056](../../../documentation/adr/0056-scip-index-resolution-for-tree-sitter-languages.md)). Without it, `<root>/index.scip` is read when present. Files the index misses or that changed since indexing keep syntactic candidates and appear in `warnings`.
- `--run-indexers` - runs `scip-python`, `scip-go`, or `rust-analyzer` itself for each Python, Go, or Rust Package with no supplied index, writing under `<out>/scip/` and reusing that index while none of its files, manifest, or lockfile changed. This runs the target repo's own tooling, so only pass it for a repo you would build yourself. For Go, `go build ./...` runs first. For Rust, `cargo check --locked --all-targets` runs first and never writes a `Cargo.lock`. A missing or failing indexer, or a failed build, becomes a warning, not an error. `read` never runs indexers.

Prints `{ jsonPath, htmlPath, nodeCount, edgeCount }` - never the graph itself.

### `read`

Self-heals: always re-runs the pipeline first, so it's safe to call without a prior `generate`, or after files changed since the last one. That regeneration refreshes `<outDir>/cache.json` on disk as a side effect - `read` still never writes `codemap.json` or `codemap.html`.

```
node "${CLAUDE_SKILL_DIR}/main.js" read [--root <dir>] [--out <dir>] [--config <path>] [--path <p>] [--symbol-kind <k>] [--search <s>] [--include-tests] [--scip-index <language>=<path>]
```

- `--path` - matches by prefix/subtree (a Directory or Package path matches every descendant File/Symbol under it). `.` matches the whole repo; a co-located Package id like `.@go` matches only that family's files.
- `--symbol-kind` - one of `function`, `method`, `class`, `const`, `type`, `interface`, `enum`; matches only Symbol nodes of that kind.
- `--search` - case-insensitive substring match over node names.
- `--include-tests` - includes test files in the graph `read` filters over, matching whatever `generate` last used; since `read` self-heals by re-running the pipeline first, pass the same `--include-tests` value used for `generate` to avoid an unnecessary full re-extraction.
- `--scip-index` - same meaning as on `generate`; pass the same value to avoid a full re-extraction.

All provided filters AND together. Omitting every filter returns the whole graph.

Prints `{ nodes, edges, modules }` - `modules` is always the full, unfiltered Module list (not narrowed by any of the above filters); each matched node's ancestor Cluster chain (File/Directory/Package) is included even when the ancestor itself didn't match.
