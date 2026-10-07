# 0052: Modules that collide at every tier are numbered against each other, not just ordinal

[Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows the final fallback step of documentation/adr/0012/documentation/adr/0013/documentation/adr/0009/documentation/adr/0041's
tier chain - the `Module <id>` label it used to assign unconditionally.

## Context

documentation/adr/0051 split `valora`'s 83-file, seven-directory Module into six real, cleanly-named pieces -
but two of the sub-communities it recovered inside `src/cli/` (11 files built around
`command-executor.ts`, and 2 files - `plugin-catalogue-utils.ts` and `plugin-update-orchestrator.ts`
- with zero edges to anything else in `src/cli/`) still came out as `"Module 59"` and `"Module 67"`.
The operator who drove documentation/adr/0049 through documentation/adr/0051 pushed back a third time: an opaque ordinal is
still not a resolution, even once the underlying grouping itself is correct.

Measuring directly confirmed the grouping *is* correct this time, unlike the original finding this
whole chain started from: `plugin-update-orchestrator.ts` imports `plugin-catalogue-utils.ts` and
nothing else in `src/cli/` touches either of them - a genuinely separate, self-contained pair, not an
artifact of over-eager refinement. The reason naming still fails for them is structural, not a bug in
any earlier decision: both Modules' files sit directly in `src/cli/` with no further subdirectory to
distinguish them, both resolve to the same owning Package (`@windagency/valora`, which - per
documentation/adr/0050 - already owns several other, separately-named Modules, so the Package name isn't
offered either), so every one of the four naming tiers produces the identical string for both. There
is no path-derived information left that tells them apart, and manufacturing a semantic distinction
("command execution" vs "plugin management") would mean reading file contents or inferring intent -
exactly what documentation/adr/0001's "no fabrication" principle forbids.

What's available, and what the ordinal label was discarding, is the one fact both Modules still
genuinely share: they are both `cli`. `resolveNamesByPriority` already tracks exactly this - a Module
reaching the end of all four tiers got there by colliding with specific other Modules at specific
tiers, and the last *structural* fact about it before the collision cascade bottoms out is its
`deepName` (the real directory it lives in, documentation/adr/0013). Two Modules sharing a `deepName` this
late already share the most specific piece of real information this generator has about either of
them - numbering them against each other (`cli-1`, `cli-2`) states that honestly, instead of replacing
it with an unrelated integer that could as easily belong to a Module on the opposite side of the repo.

## Decision

`resolveNamesByPriority`'s final step (`src/clustering/module-naming.ts`) no longer assigns
`Module <id>` to every still-unsettled summary unconditionally. It first groups them by `deepName`
(`groupByTierName`, the same helper every other tier already uses). A group of two or more is
numbered, sorted by `id` for determinism (`cli-1`, `cli-2`, ...) - *unless* that `deepName` string is
already reserved by a different, earlier-settled Module (documentation/adr/0042's reservation set), in which
case numbering would misleadingly suggest a relationship to that unrelated Module, so the group falls
through to the plain ordinal instead. A group of exactly one reaching this point is provably always
either reserved (the same reason above) or otherwise ineligible - a genuinely unique, unreserved
`deepName` would already have settled back at the `deepName` tier itself, before ever reaching here -
so it, too, falls to the ordinal; this is defensive, not a case expected to be exercised in practice.

## Consequences

- Measured on `valora`: `"Module 59"` and `"Module 67"` become `"cli-1"` and `"cli-2"`. Every Module
  in the output is now either a real, structurally-derived name or a numbered variant of one - no
  bare, context-free integer remains anywhere in the list.
- `module-naming.test.ts`'s own "both Modules share one Package" fixture changes behavior under this
  decision (both Modules there also collide down to a shared `deepName`, `"src"`) and now numbers as
  `"src-1"`/`"src-2"` rather than `"Module 0"`/`"Module 1"` - updated deliberately, not as an
  incidental side effect, since the same reasoning (two Modules sharing their last remaining real
  structural fact is more honest than an ordinal) applies regardless of how generic that shared
  directory name happens to be. A new test covers the genuine ordinal path this decision leaves intact:
  when the shared `deepName` is already reserved by an unrelated, earlier-settled Module.
- Two other existing "falls back to ordinal" tests are unaffected on inspection, for a reason worth
  recording: both involve Modules with *no* Package data at all, where the `packageName` tier's own
  `Module ${moduleId}` fallback already produces a per-Module-unique string one tier before reaching
  this decision's new step - they never arrive here "still colliding" in the first place. This
  decision only ever fires when real Package data ties two or more Modules' entire fallback chains
  together identically, which is precisely the `valora`-shaped case it was written for.
