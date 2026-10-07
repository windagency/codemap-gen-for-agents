# 0049: A Module's files never span more than one Package

[Back to LLD.md](../LLD.md)

## Status

Accepted. The mirror image of documentation/adr/0038 ("a single directory's production files are never split
across Modules") - this decision is about the opposite failure, two Packages merged *into* one
Module, and the opposite remedy (split, not merge).

## Context

Running the generator against a separate, real, large monorepo (`valora`) produced a Module named
`"src+packages"` whose files came from two different, independently-versioned npm packages: 4 files
from the root application package's `src/memory/`, and 3 files from `packages/valora-plugin-api/src/`
- a separate, manifest-rooted Package the root package merely depends on. The cause was a single,
entirely legitimate edge: `src/memory/index.ts` imports `@windagency/valora-plugin-api` (a declared
dependency, re-exporting its types). One real cross-package import was enough for Louvain to fuse an
independent, publishable package into the root application's own module, and because the two file
sets share no real directory ancestry, every naming tier produced only the uninformative
`"src+packages"` - correctly reflecting that the Module's membership itself made no sense, not a
naming bug on its own.

documentation/adr/0038 already established that a directory is an *inviolable* Module boundary: Louvain's
per-file numbers are allowed to disagree about which Module a file belongs to, but the final
assignment is never allowed to split one directory across two. A Package is a stronger version of the
same kind of boundary - not merely a filesystem convention but a manifest-declared, independently
versioned, independently publishable unit (`DiscoveredPackage`, `src/core/types.ts`) - documentation/adr/0041
already leans on exactly this when it uses a Package's declared name as a naming tier. If a mere
directory is inviolable, a Package - a strictly stronger claim to "this code is its own thing" - must
be too. Nothing in `LouvainModuleDetector` enforced that before this decision: only directory
fragmentation was reconciled, never package fragmentation, even though a cross-package import is a
completely ordinary, expected shape in any monorepo where packages depend on one another - this isn't
a corner case, it will recur in any multi-package repo with internal dependencies.

The required fix is the mirror image of documentation/adr/0038's, not a copy of it. documentation/adr/0038 *merges*:
a directory's stray, minority-voted files rejoin the directory's own majority, because a directory's
files were always one thing and a minority outvote is an artifact to correct. Here, two Packages were
never one thing to begin with - majority-vote reconciliation (`reconcileDirectoryFragmentation`'s
"stray minority rejoins the majority" rule) would be the wrong shape entirely, since forcing the
minority Package's files to join the majority Package's Module doesn't correct an artifact, it
manufactures exactly the cross-package relationship this decision exists to prevent. The correct
operation is to *split* a Package-spanning Module along Package lines, giving each Package's own
slice of it a fresh identity, not to pick a winner.

## Decision

`reconcilePackageFragmentation` (`src/clustering/louvain/louvain-module-detector.ts`) runs as a new
pass between `classify()`'s output and `reconcileDirectoryFragmentation`. For every `moduleId` whose
production, non-test files resolve (via the same `owningPackageOf` longest-prefix match
documentation/adr/0041's `singlePackageNameOf` already uses, now shared from `src/clustering/graph-node-utils.ts`
rather than kept private to `module-naming.ts`) to more than one distinct Package, every one of that
Package's own files is reassigned to a fresh `moduleId`, unique across the whole graph - every
Package's slice gets its own new id, including whichever Package happened to hold the most files; there's
no majority to defer to; a `moduleId` whose files all resolve to the same Package, or to none (no
Package node data at all, or a file matching no declared Package's directory - only possible when the
graph carries no Package nodes, since `owningPackageOf`'s universal `[]`-rooted root Package otherwise
matches every file), is left untouched.

Runs *before* `reconcileDirectoryFragmentation`, not after: an exact directory is always owned by
exactly one Package (nested Packages aside, and a nested Package's own directory is never also
claimed by its enclosing one, per `owningPackageOf`'s longest-prefix rule), so by the time directory
reconciliation's majority vote runs, every candidate `moduleId` it considers moving a file into is
already Package-pure - a directory's own majority `moduleId` necessarily already holds that
directory's Package, since most of that exact directory's own files already determined it. Directory
reconciliation therefore can never reintroduce a cross-Package merge after this pass has run, and
needs no change of its own.

A Package's slice that ends up smaller than `MIN_COMMUNITY_SIZE` after the split (e.g. a Package
contributing only one file to an otherwise-larger, now-split Module) is not given special handling by
this pass - `enforceMinimumCommunitySize`, which already runs at the end of `detect()` for exactly
this reason (documentation/adr/0040), catches it the same way it catches any other post-reconciliation remainder
too small to be a real Module.

Deliberately out of scope: re-checking a split slice's embeddedness ratio against its narrower,
Package-only membership (the ratio `classify()` computed was against the original, unsplit
community). No case in `valora`'s data needed it - both real-world splits (the `valora-plugin-api`/
`memory` split here, and documentation/adr/0048's `eslint.config.js` star once config files are excluded)
remain well-connected, or correctly fall below `MIN_COMMUNITY_SIZE`, without it. Revisit if a split
slice surfaces that's technically Package-pure but has lost all real internal cohesion once its
cross-Package neighbors are no longer counted - the same "no known case yet, revisit if one surfaces"
stance documentation/adr/0038 itself took for directory fragmentation hiding a genuine split.

`src/clustering/graph-node-utils.ts` gains the Package-matching logic (`packagesOf`, `owningPackageOf`,
the `NamedPackageDir` shape) moved out of `module-naming.ts`, which now imports it instead of keeping
its own copy - the same shared-utility home `containerDirSegments` and `longestCommonPrefixLength`
already have, for the same reason: both `module-naming.ts` and `louvain-module-detector.ts` now need
the identical "which Package owns this file" answer.

## Consequences

- Measured on `valora`: the `"src+packages"` Module is gone. `src/memory/`'s 4 files and
  `packages/valora-plugin-api/src/`'s 3 files become two separate Modules, each fully embedded within
  itself (verified against the actual edge list, not assumed), each nameable on its own terms instead
  of jointly producing a composite name that described neither.
- A Package contributing only a handful of files to a Module that's otherwise a different Package's
  domain - the common shape of one package's thin integration shim importing another's public API -
  now reliably surfaces as its own (possibly `undersized`-and-therefore-unassigned) Module rather than
  being silently absorbed. This is the intended effect, not a side effect to mitigate: the whole point
  is that a Package's own files are never attributed to a different Package's Module just because an
  import edge happened to connect them.
- `louvain-module-detector.test.ts` gains Package-fragmentation fixtures (building `PackageNode`s, not
  previously needed by any test in that file): a Module split along Package lines where one resulting
  slice is too small to survive `enforceMinimumCommunitySize` afterward (the directly-testable shape -
  reliably reproducing a *second* slice that also survives post-split needs enough whole-graph import
  mass that Louvain's modularity optimization favors merging two already-cohesive groups in the first
  place, which a small, hand-built fixture graph can't approximate; the "two real Modules, both
  surviving" case is the one actually measured against `valora` above, not asserted from a synthetic
  graph), a Module left untouched when every file shares one Package, and a graph with no Package
  nodes at all confirming the pass is a no-op exactly as before. `module-naming.test.ts`'s existing
  Package-naming-tier tests are unaffected - they build their own `PackageNode` fixtures directly
  against `deriveModuleNames`, never through the detector, and `packagesOf`/`owningPackageOf`'s
  behavior is unchanged by the move, only its home.
- This is the same kind of call documentation/adr/0038 made: a human decided a structural invariant (Packages
  are atomic Module boundaries) matters more than always following `classify()`'s per-file numbers to
  the letter, not something derivable from the import graph alone.
