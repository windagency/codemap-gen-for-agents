# 0051: An overflowing community is recursively re-clustered on its own internal edges

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Supersedes documentation/adr/0050 as the primary fix for the shape that ADR targeted - an ordinal label is
now only the fallback for what this decision's recursion can't resolve, not the first response to it.

## Context

documentation/adr/0050 made `"@windagency/valora"` stop appearing as a Module name, by refusing to name an
83-file, seven-directory Module after a Package it merely shared with over a dozen other Modules.
That was progress - the output stopped being actively misleading - but it wasn't a resolution. The
operator who reported the original finding pushed back directly: naming the blob `"Module 30"`
instead of `"@windagency/valora"` is not what fixes it; `src/cli/document-approval.ts` and the other
32 files genuinely in `src/cli/` should be grouped with each other, not folded into one undifferentiated
mass with `src/output/`, `src/config/`, `src/session/`, `src/ui/`, and `src/cleanup/`.

Measuring directly confirmed the files involved were never one undifferentiated mass to begin with.
Extracting exactly this Module's 83 files and the 205 edges between them from the generated graph,
then re-running the *identical* `LouvainModuleDetector` over that subgraph alone - no outside
context, no filler, nothing else in the repo - splits it cleanly: `cli` (33 files, one real
community), `output`+`executor` (20 files), `config` (10), `session` (11), `ui` (7), `cleanup` (2).
Every one of these is exactly as internally cohesive as this codebase's own already-correctly-named
Modules (`ast`, `security`, `services`). The repo-wide run did not fail to notice real structure
because the structure wasn't there - it failed because community-detection's modularity objective has
a well-documented "resolution limit": in a large enough graph, the *expected* edge weight between two
communities under the null model becomes small enough that almost any real cross-community edge looks
like sufficient evidence to merge them, regardless of how much more tightly each one is connected
internally. The distortion scales with the whole graph's total edge weight, not with the community in
question - which is exactly why re-running the same algorithm on just the community's own edges, with
the rest of the graph's mass removed, recovers the real partition: the null-model expectation shrinks
along with the graph, and the same internal edges that lost the comparison at repo scale win it again
at the community's own scale.

This is not safe to apply indiscriminately. Running the same "re-cluster this Module standalone"
experiment against this codebase's own `ast` and `security` Modules (11 files each, both already
correctly named, both settling cleanly today) does real damage: isolated, `ast` fragments into 7
assigned files plus 4 unassigned (2 `undersized`, 2 `low-embeddedness`); `security` fragments
completely, all 11 files becoming unassigned (6 `degenerate-partition`, 3 `low-embeddedness`, 2
`isolated`). The whole-graph modularity and embeddedness baselines that originally justified keeping
these together depend on there being enough graph left to compare against - cut a small, genuinely
single-domain Module down to just its own edges and those baselines collapse along with it. The
difference between `ast`/`security` and the `"@windagency/valora"` Module isn't size alone, it's
breadth: `ast` and `security` each sit in exactly one directory, with nothing to meaningfully split
along; the oversized Module spans seven. Breadth, not size, is what tells a genuine single domain
apart from one hiding a resolution-limit artifact.

## Decision

`refineOversizedCommunities` (`src/clustering/louvain/louvain-module-detector.ts`) runs as a new pass
between `reconcilePackageFragmentation` and `reconcileDirectoryFragmentation`. For every moduleId
whose production, non-test files span more child directories past their own common ancestor than
`MAX_DIRECTORY_BREADTH` (the same breadth cap documentation/adr/0046 already uses for the composite-name
cap, moved to `graph-node-utils.ts` and shared rather than independently tuned - nothing on record
suggests naming and clustering need different values here), that community's own files and the import
edges strictly between them are re-clustered from scratch: the same `buildImportGraph` + `louvain.detailed`
+ `classify` sequence `detect()` itself runs, factored out into `clusterFileIds` so both call sites
share one implementation.

The recursive result is accepted only if it actually finds more than one distinct resulting
sub-community - a community that re-clusters back into exactly the shape it started in (or into one
community plus unassigned stragglers, never two-or-more *assigned* groups) is left completely
untouched, falling through to documentation/adr/0050's ordinal-naming fallback exactly as before. When a split
*is* accepted, each resulting sub-community gets a fresh, globally-unique moduleId, and any file the
recursive pass itself left unassigned keeps whatever reason that recursive run gave it (`isolated`,
`undersized`, `low-embeddedness`, or `degenerate-partition`, scoped to the sub-graph, not the whole
repo).

This is a single, non-recursive pass over the top level's own communities - a resulting
sub-community is not itself checked for further overflow. No case in `valora`'s data needed a second
level (none of the five sub-communities recovered from the oversized Module here themselves span more
than `MAX_DIRECTORY_BREADTH` directories); revisit if one surfaces.

Runs *before* `reconcileDirectoryFragmentation`: a split sub-community's files are a subset of the
original community's, so directory membership within it is unchanged by the split itself, and any
fragmentation the recursive re-clustering introduces (a directory's files landing in two different
sub-communities) is exactly the shape `reconcileDirectoryFragmentation` already exists to fix -
running it after, not before, lets it clean up after this pass the same way it already cleans up after
`classify()`'s own first pass. Runs *after* `reconcilePackageFragmentation` for the same reason
documentation/adr/0049 itself established: every community refinement considers here is already guaranteed
Package-pure by that point, so recursively splitting it can only ever produce more Package-pure
pieces, never re-fragment a Package.

## Consequences

- Measured on `valora`: the 83-file Module is gone, replaced by six Modules. `cleanup` and `session`
  settle as clean, directly-named Modules. `config+cli`, `ui+cli`, and `output+cli+executor` are
  composite names (documentation/adr/0009) for sub-communities that turned out to span more than one
  directory even after refinement - still true, still structurally derived, no worse than any other
  composite name already in the output. Two small sub-communities purely within `src/cli/` (11 files
  and 2 files, both directly in that one directory with nothing to interpolate from, and sharing one
  Package with over a dozen other Modules) still fall to the ordinal label - an accepted, honest limit
  of path-only naming: two genuinely different communities that happen to sit in the exact same flat
  directory cannot be told apart without reading file contents, which this generator's "no
  fabrication" principle (documentation/adr/0001) forbids outright. `src/cli/document-approval.ts` itself now
  shares a Module with ten other real command-handling files (`command-error-handler.ts`,
  `command-executor.ts`, `execution-coordinator.ts`, `session-manager.ts`, and others) instead of
  eighty-two unrelated ones - the substance of the original request, even where the display name is
  still an ordinal.
- A smaller, parallel effect appeared on `valora-plugin-memory-vault`'s own oversized Module too
  (`vault+migration+retrieval+consolidation`, 20 files): it splits the same way, into `migration`,
  `consolidation+retrieval`, and `vault+retrieval` - not specifically investigated here, but consistent
  with the same mechanism firing wherever the same shape recurs.
- `louvain-module-detector.test.ts` gains two tests, each empirically verified to need every
  parameter it uses (filler count, satellite edge density, hub size) rather than asserted from theory
  alone, per this project's own standing practice for Louvain-shaped tests: one reproducing the
  resolution-limit merge-then-recover shape directly (confirmed, by temporarily disabling this pass,
  that the fixture really does collapse into one community without it), and one confirming a
  small, single-directory community is never even attempted, regardless of size.
- `src/clustering/graph-node-utils.ts` gains `MAX_DIRECTORY_BREADTH` and `distinctChildSegments`,
  moved out of `module-naming.ts` to be shared with this new pass - the same shared-utility home
  `packagesOf`/`owningPackageOf` already have (documentation/adr/0049), for the same reason.
