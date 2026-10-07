# 0016: The ModuleDetector factory lives in its own file, separate from the interface

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. A structural fix to `src/clustering/`, not a change to the detection algorithm itself (documentation/adr/0001, 0007, 0014, 0015).

## Context

Running the generator on its own codebase kept producing one Module named `core+clustering`: `src/clustering/`'s two files (`module-detector.ts`, `louvain/louvain-module-detector.ts`) were consistently grouped with `src/core/` instead of forming their own Module, and sweeping `FOLDER_PROXIMITY_BASE` from 3 up to 20 didn't change that (measured directly - see below). That ruled out a tuning fix; the cause was structural.

`src/clustering/module-detector.ts` combined two responsibilities `src/extraction/` and `src/graph-building/` keep in separate files: the `ModuleDetector` interface (analogous to `parser.ts`/`graph-builder.ts`) *and* the `createModuleDetector()` construction function (analogous to `parser-factory.ts`/`graph-builder-factory.ts`). Because both lived in one file, that one file collected import edges from *both* of `core/`'s composition files - `generate-map.ts` (which only needs the `ModuleDetector` type) and `compose.ts` (which only needs the construction function) - where the extraction/graph-building convention spreads the same two dependents across two separate files. With only 2 files total in `clustering/`, those extra edges into `core/` were enough to outweigh the one edge between `clustering/`'s own two files, and Louvain's global modularity optimization merged them into `core/`'s community rather than keeping them apart - a real, measured effect of the import graph, not a naming or threshold problem.

## Decision

Split `src/clustering/module-detector.ts` into two files, matching the established convention:
- `module-detector.ts` keeps only the `ModuleDetector` interface.
- `module-detector-factory.ts` (new) holds `createModuleDetector()`, importing both the interface and `LouvainModuleDetector`.

`core/generate-map.ts` still imports the interface from `module-detector.ts` (unchanged); `core/compose.ts` now imports the factory from `module-detector-factory.ts` instead. This is purely a dependency-topology fix in the codebase's own source, not a change to `LouvainModuleDetector`, its weighting, or its thresholds - the detection algorithm doesn't know or care that this file was split; it just sees a different (and here, more accurate) import graph as a result of `clustering/`'s own code now matching the isolation pattern the rest of the pipeline already follows.

## Consequences

- Running the generator on its own codebase, `clustering` (`module-detector.ts`, `module-detector-factory.ts`, `louvain/louvain-module-detector.ts`) and `core` are now two separate Modules instead of one `core+clustering` interpolated Module. No other Module's assignment changed.
- `src/clustering/` now has 3 files instead of 2, one file more than before `MIN_COMMUNITY_SIZE` (documentation/adr/0015) would have required on its own - though the fix here is the edge topology, not the file count; the community boundary moved because `compose.ts`'s edge now lands on a different, non-`core`-adjacent file, not because there's simply more mass to work with.
- `src/__tests__/architecture/dependency-direction.test.ts`'s boundary rules (which check `clustering/louvain/` as an implementation subfolder core/ must never import directly) are unaffected - both new files sit at `clustering/`'s top level, the same position `parser.ts`/`parser-factory.ts` and `graph-builder.ts`/`graph-builder-factory.ts` occupy in their own slices.
- No behavioural test changes were needed: `compose.test.ts` exercises the wiring through `createDefaultPipeline()` only, and every other reference to `module-detector.ts` in tests or docs was to the unchanged interface import or to `louvain-module-detector.ts`, not to the factory function's file location.
