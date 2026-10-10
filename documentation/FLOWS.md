# Flows

[Back to README.md](../README.md) • [Back to HLD.md](HLD.md)

Step-by-step runtime behaviour for the scenarios a user or agent actually triggers. For the static architecture these flows move through, see [`HLD.md`](HLD.md); for exact interfaces, see [`LLD.md`](LLD.md).

## `generate` - fresh run (no prior cache)

Triggered by `codemap generate`, the MCP `generate` tool, or the Skill's `generate` subcommand - all three call the same core pipeline.

1. Resolve `rootDir` (from `--root`/`rootDir`, default `process.cwd()`) and config (flat lookup at `<rootDir>/codemap.config.json`, or an explicit override), independently of each other.
2. **Discovery** walks the filesystem once from `rootDir`, applying built-in + config excludes, producing the complete matched-file list and the Package/Directory structure.
   - With `--run-indexers`/`runIndexers`, and no supplied Python index, `scip-python` runs once per Python Package into `<outDir>/scip/`, unless that Package's earlier index still matches every file's hash. A failed run becomes a warning ([ADR-0056](adr/0056-scip-index-resolution-for-tree-sitter-languages.md)).
3. Look up `<outDir>/cache.json`. It doesn't exist (or `--force` was passed) → treat as `EMPTY_CACHE`, so every discovered file is "changed."
4. **Parser** - really a `CompositeParser` partitioning the complete file list by extension into up to five per-language sub-lists (ADR-0027, ADR-0030) - hands each partition to its own registered `Parser`: TS/JS builds one `ts.Program` over its partition and extracts every file (since all are "changed"), resolving imports, re-exports, and calls against the type checker as it goes (files with genuine syntax errors are skipped, producing no entry); Go/Rust/Java/Python each build their own repo-wide syntactic (tree-sitter) index over their own partition and resolve imports/calls against that. The merged `ExtractedSymbols[]` is what every step below sees.
5. Write a fresh `cache.json`: a new epoch (hash of generator version + root `tsconfig.json` text + exclude patterns + the `includeTests` flag + every dependency manifest and lockfile at the root and each Package root + the content of every SCIP index read) and every file's content hash + `ExtractedSymbols`.
6. **GraphBuilder** assembles the complete `ExtractedSymbols[]` plus the Discovery structure into a `RawGraph`: nodes for every Package/Directory/File/Symbol/External, edges for every resolved import and call (fanning out ambiguous call candidates).
7. **ModuleDetector** runs Louvain community detection over the graph's static import edges, labelling each file with a `moduleId` or an `unassignedReason`.
8. **JsonTransformer** and **HtmlTransformer** each render the same `ClusteredGraph` into `codemap.json` and `codemap.html`.
9. The adapter returns `{jsonPath, htmlPath, nodeCount, edgeCount}` (CLI: prints this JSON; MCP/Skill: returns/prints it as the tool result).

## `generate` - incremental re-run

Same trigger, run again after files changed.

1. Discovery and config resolution repeat identically to the fresh-run flow - Discovery is never itself cached, since Package/Directory boundaries can shift without any file's content changing.
2. Read the existing `cache.json`. Compute the current epoch and compare:
   - **Epoch mismatch** (generator upgraded, root `tsconfig.json` edited, `exclude` patterns changed, the `includeTests` flag flipped, a dependency manifest or lockfile changed, or a SCIP index changed) → discard the whole cache, fall back to the fresh-run flow above.
   - **Epoch matches** → per-file content-hash diff against `cache.json`'s entries. A file whose hash matches keeps its cached `ExtractedSymbols`; a file that's new, changed, or newly un-excluded is marked for extraction; a file that's newly excluded is simply not read.
3. **Parser** (the same `CompositeParser`-partitioned set of per-language Parsers) builds each language's own whole-program index over its partition of the complete current file list (so cross-file resolution stays exactly as accurate as a fresh run), but only walks and extracts the changed subset.
4. The complete `ExtractedSymbols[]` - fresh entries for changed files, cached entries for the rest - feeds **GraphBuilder** and **ModuleDetector** exactly as in the fresh-run flow. Module clustering is never itself incremental; it always recomputes globally over the full updated graph.
5. Steps 5 onward (JSON/HTML output, cache rewrite, adapter return) are identical to the fresh-run flow.

`--force` (CLI/Skill) or `force: true` (MCP `generate`) skips straight to treating the cache as empty, bypassing the diff entirely.

## MCP `read` - self-healing query

Triggered by an MCP client calling the `read` tool.

1. **Always re-run the incremental `generate` pipeline first** (the fresh-run or incremental-re-run flow above, whichever applies), using the same `rootDir`/`configPath`/`outDir` params as the call. This is why `read` accepts the same location parameters as `generate` - it never assumes a prior `generate` call happened, or that an on-disk map isn't stale. This step does write to disk: it refreshes `<outDir>/cache.json` exactly as `generate` would, and warns (same as `generate`) if extraction skipped any files - `read` just never writes `codemap.json` or `codemap.html`.
2. Load the resulting `ClusteredGraph` in memory (not by re-reading `codemap.json` off disk).
3. Apply the requested filters - `path` (prefix/subtree match), `symbolKind`, `search` - AND-combined when more than one is given.
4. For each matched node, attach its ancestor Cluster chain (File → Directory → Package) for navigability.
5. Include edges that are already fully inside the matched node set - not a full induced subgraph over every edge touching a match.
6. Return `{nodes, edges, modules}`, where `modules` is the full, unfiltered Module table.

The Skill's `read` subcommand follows the identical sequence, printing the same shape as one JSON object to stdout instead of returning an MCP tool result.

## HTML visualisation - user interaction

What happens after a human opens `codemap.html` in a browser (no server, no network calls - the graph data and D3 are both embedded in the file).

1. The page renders the **Flow view** by default.
2. Setting a **Filter** (Path / Symbol kind / Search / Language, AND-combined) re-evaluates `matchesFilterNode` client-side and dims non-matching nodes/edges (opacity 0.15) in whichever view is active - nothing is removed from the DOM, and there's no data reload, since the full graph is already in the page.
3. Clicking a File node in the Flow view triggers `computeImportChain`: a cycle-safe breadth-first walk of that file's imports, with edges numbered in first-traversal order; every node/edge outside the chain is dimmed the same way a non-matching filter result is.
4. Clicking a Module in the sidebar legend triggers Flow view's `highlightModule`: every File belonging to that Module is highlighted and everything else - other Modules' files, External nodes, edges - is dimmed.
5. Switching to the **Force-directed view** lays every node out spatially, visually grouped into regions by detected Module (`computeRegionId`), independent of any Flow-view selection. Clicking a node here triggers `highlightNeighborhood`: the clicked node plus its direct (1-hop) neighbours are highlighted, dimming everything else.
6. A highlight (import-chain, Module click, or neighbourhood click) and an active filter coexist rather than one overriding the other: a node that is both currently highlighted and filter-matched gets a dashed ring (`stroke-dasharray: 3 3` on its `cm-*-combined-ring` element) around it, visually distinct from a plain highlight or a plain filter-match - dimming logic only ever hides nodes that are *neither*.
7. Clearing the selection (clicking empty canvas) or switching views returns to the unfiltered (or currently-filtered) full graph.
