# 0007: Module detection weights import edges exponentially by folder proximity

[Back to 0001-algorithmic-module-detection.md](0001-algorithmic-module-detection.md) • [Back to 0006-module-naming-from-container-folder.md](0006-module-naming-from-container-folder.md) • [Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Amends ADR-0001's "static import/dependency graph, no other input" framing, and narrows CONTEXT.md's "a Module can span files scattered across multiple directories... this is a correlation, not a rule" in practice (see Consequences). The `MIN_EMBEDDEDNESS`-computed-on-raw-counts gap called out in Consequences below is closed by documentation/adr/0014-weighted-embeddedness.md.

## Context

ADR-0001 fixed Module detection as Louvain community detection over the unweighted static import graph, deliberately excluding directory structure as a signal. ADR-0006 then named Modules after their files' nearest common ancestor directory, and documented a real consequence of the unweighted approach: running the generator on its own codebase produced several Modules whose files were scattered across unrelated top-level directories (`core/`, `discovery/`, `integration/mcp/`, `output/`) with no common ancestor closer than the package root. Every one of those Modules bottomed out at the same uninformative name (`src`), and ADR-0006's collision rule then fell back all of them to `Module <id>` - four distinct domains looked identical.

ADR-0006 called this "an honest reflection of the underlying detection limitation, not a naming bug." Revisiting the detection side rather than the naming side: directory placement is not an external signal in the way a config file or LLM call would be - it's intrinsic data already present on every `FileNode` (its `id`), the same data ADR-0006 already uses for naming.

A first version of this decision weighted edges linearly (`weight = 1 + sharedDirDepth`) - enough to break dead-even ties in the bridge file's favor, but too weak to matter when a scattered module's cross-folder import edges outnumbered any single folder-local cluster. Measured on this repo's own codebase (see table below), that got 5 of 8 Modules named. The alternative considered and rejected before this one was leaving the linear weighting as the final answer, accepting that some Modules would keep spanning multiple directories.

| Weighting                                  | Modules named / total | Shape of the result                                                                       |
| ------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------- |
| Unweighted (pre-ADR-0007)                  | 1 / 5                 | Most cross-cutting Modules collide on `src`, fall back to `Module N`                      |
| Linear (`1 + depth`)                       | 5 / 8                 | Some Modules folder-cohesive; some genuinely cross-cutting ones remain, correctly unnamed |
| **Exponential (`3^depth`), this decision** | **10 / 10**           | Every Module maps onto exactly one leaf directory                                         |

## Decision

Import edges are weighted `3 ** sharedDirDepth(source, target)` (`importEdgeWeight`, `src/clustering/louvain/louvain-module-detector.ts`), where `sharedDirDepth` counts the leading directory segments two files' container paths have in common. A pair with no shared directory keeps weight `1` (the pre-ADR-0007 baseline); each additional shared segment triples it. This is passed to `graphology-communities-louvain` via its standard `weight` edge attribute - the algorithm itself, its thresholds (`MIN_COMMUNITY_SIZE`, `MIN_EMBEDDEDNESS`, `MIN_MODULARITY`), and the "no config, no LLM call, no human declaration" determinism guarantee from ADR-0001 are otherwise unchanged.

The exponential curve was chosen, over the linear one measured above, explicitly to make folder-cohesive names the common case for this codebase rather than a minority one. This is a deliberate, human-directed tuning choice: the weighting formula and its base (`FOLDER_PROXIMITY_BASE = 3`) were picked by measuring their effect on this repo's own generated output, not derived from the import graph itself.

## Consequences

- Accepted trade-off: at this weight, Module detection is no longer "algorithmic clustering that sometimes happens to align with folders" - for a codebase organized the way this one is, it reliably reproduces the directory tree. `CONTEXT.md`'s "a Module can span files scattered across multiple directories... this is a correlation, not a rule" is still technically true (a strong enough import signal can still overcome the exponential folder bonus), but it will rarely be observed in practice at this weighting. A future reader comparing a generated map's Modules against its Directories should expect them to mostly coincide, not treat that as a detection bug.
- This narrows, without fully reversing, ADR-0001's original bet that import-graph clustering would surface real cross-cutting domains a directory listing wouldn't show. On this codebase, none of the remaining Modules are cross-cutting after this change (contrast the linear weighting, which still preserved two genuinely cross-cutting Modules). Revisit the weighting (or drop back to the linear formula) if a future codebase's real domain boundaries turn out to need more room to diverge from its folder layout than this constant allows.
- Determinism is preserved: `sharedDirDepth` and `importEdgeWeight` are pure functions of the two file ids already in the graph, computed and applied before edges are inserted in the existing fixed sort order, so the repeatability guarantee (`detect()` run twice over the same graph produces byte-identical output) is unaffected.
- Existing fixtures and unit tests using flat, directory-less file ids (e.g. `"a1"`, `"b1"`) are unaffected, since `sharedDirDepth` is `0` for all of them, giving weight `3^0 = 1` - the prior all-weight-`1` behavior, unchanged.
- ~~The weighting only influences which community Louvain assigns a file to - it has no effect on `classify`'s per-file `MIN_EMBEDDEDNESS` (0.5) gate, which is computed from raw, unweighted edge counts. A file with fewer than half its raw import edges landing inside whatever community it was weighted into still comes out `low-embeddedness`/unassigned rather than assigned. In practice this bounds how far folder-proximity weighting alone can rescue a genuinely cross-cutting file: it can win ties and modest minorities, not gross majorities.~~ Closed by documentation/adr/0014: embeddedness is now measured on the same weighted edges, so a folder-embedded file can be rescued even when it's a gross majority of raw edges leaving its community (e.g. a composition-root file importing from every domain).
