# 0035: Interpolated module names also serve as a third collision tier

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows documentation/adr/0009's interpolated-name fallback and documentation/adr/0013's deeper-name collision tier - both left this case unresolved, each assuming the other covered it.

## Context

Running the generator on this repo's own codebase - with `fixtures/` and `documentation/` excluded from the scan, a prerequisite for `src`'s universal root to be stripped at all - still left two Modules under `src/extraction/` with the opaque `Module <id>` label: one spanning `tree-sitter-common/` and `tree-sitter-java/`, the other spanning `composite-parser.ts` (sitting directly in `extraction/`) and `tree-sitter-go/`.

Neither Module's files share a common ancestor closer than `extraction` itself - a single segment. Per documentation/adr/0012 their top-level name is `"extraction"`. Per documentation/adr/0013, a top-level collision falls back to the deepest common-ancestor segment - but for a one-segment common ancestor, the deepest segment and the top-level segment are the same segment. `deepName` and `topName` are identical strings, so the second tier is the first tier restated: it can never disambiguate a Module from itself, and both Modules collided again on `"extraction"`, falling through to the ordinal label.

The information that does distinguish these two Modules was already being computed, just scoped to the wrong case. documentation/adr/0009 joins each file's immediate child directory below the *codebase's* root into a composite name (e.g. `core+__tests__`) - but only when a Module's common ancestor is empty. Running that same interpolation one level below the Module's own common ancestor, whatever depth that happens to be, resolves both Modules above to `"tree-sitter-common+tree-sitter-java"` and `"tree-sitter-go"` - both still derived purely from file ids already in the graph, nothing fabricated.

## Decision

`interpolatedNameAt(fileIds, depth)` (`src/clustering/module-naming.ts`) replaces the old root-relative `interpolatedName`/`childSegment` pair with a version that takes an explicit depth, rather than always reading one level past a (possibly absent) universal root. `rawSummaryOf` computes this at `commonDir.length` - one level past the Module's own common ancestor - and exposes it as a third candidate name, `interpolatedName`, alongside the existing `topName`/`deepName`. `deriveModuleNames` chains three collision-resolution passes (`resolveTierCollisions`, generalized from the old two-argument `resolveTopNameCollisions`) in order - topName, then deepName, then interpolatedName - before the unchanged final ordinal fallback.

When a Module's common ancestor is empty (documentation/adr/0009's original case), `commonDir.length` is the same depth the old root-relative call used, so `topName === deepName === interpolatedName` and behavior there is unchanged: a collision still falls straight through to the ordinal label.

## Consequences

- Running the generator on this repo's own codebase (`src/` only): both previously-ordinal `src/extraction/` Modules now get real names. Every one of the 11 detected Modules now has a derived, non-ordinal name.
- `module-naming.test.ts`'s prior "falls back to ordinal labels when the deeper disambiguating name collides too" test encoded the exact gap this decision closes (two Modules bottoming out at the same single segment, each with genuinely different child directories one level deeper); it's now a positive-case test asserting the interpolated third tier resolves them. A new test covers the narrower case this decision doesn't change: both Modules' files sitting directly in the colliding segment with no child directory left to interpolate from, which still falls back to ordinals, since there's nothing left to derive a name from.
- No new signal was introduced - `interpolatedNameAt` reads the same file ids already on the graph, just at a depth relative to each Module's own common ancestor instead of a depth fixed to the codebase root. Determinism (documentation/adr/0001) is unaffected: the function stays pure in its inputs, and tier order is fixed.
- This only adds a tier before the ordinal fallback, so it can turn a previously-ordinal name into a real one but never the reverse - confirmed by the full existing test suite and golden fixtures passing unchanged.
- This decision only fixes the naming side. It does not address the separate, harder question of whether the underlying Louvain communities it's naming are themselves the right boundaries (e.g. whether lumping `tree-sitter-common` in with `tree-sitter-java` rather than treating it as its own shared-kernel-style Module is correct) - that's a documentation/adr/0007/0014-style clustering-weight question, not a naming one, and remains open.
