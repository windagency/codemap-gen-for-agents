# 0040: Directory reconciliation skips ties and re-checks community size afterward

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows documentation/adr/0038's majority-vote merge and re-applies documentation/adr/0015's
`MIN_COMMUNITY_SIZE` floor after that merge runs, closing a gap between the two.

## Context

Running the generator against a separate real codebase (`dude-where-is-my-cli`) surfaced an ordinal
`Module <id>` containing exactly two files: `src/bin.ts` and `src/index.ts`, both sitting directly
in the project's root `src/` with no subdirectory - and, unusually, no import edge between them at
all. Each had been independently and correctly classified by Louvain: `bin.ts` was fully embedded
(ratio 1.0) in a two-member community with its one real dependency,
`src/modules/core/helpers/runtime.ts`; `index.ts` was genuinely part of the eighteen-member
community that became the `modules` Module, via its five fan-out edges into that many feature
directories. documentation/adr/0038's directory-fragmentation reconciliation then saw `src/` (the one
directory both files happen to share) disagreeing 1-vs-1 about which Module it belonged to, and -
per its original "merge the minority into the majority, ties broken toward the lower id" rule -
forced both into whichever id was numerically smaller. That merge manufactured a relationship
neither file had, while simultaneously `runtime.ts` was separately, correctly reconciled *away* from
`bin.ts`'s pairing into `src/modules/core/helpers`'s own genuine majority (two files outvoting two
single dissenters) - leaving `bin.ts` behind with nothing. The same shape recurred independently at
`src/modules/core/config/index.ts` in the same codebase, whose one real partner (`output.ts`) left
for the identical reason.

documentation/adr/0038's own Consequences section had already flagged this category of risk directly: "a
directory whose files are genuinely torn between two real domains... would still be forced together
under the majority's Module by this rule, with no signal left in the output that the vote was ever
close." A 1-vs-1 split is the most extreme version of that: there is no majority at all, just two
individuals, so "merge into the majority" has nothing to defer to and falls back to an arbitrary
numeric tie-break instead - the worst case documentation/adr/0038 anticipated, now observed.

## Decision

Two changes to `src/clustering/louvain/louvain-module-detector.ts`:

1. `majorityModuleId` now returns `undefined` when two or more moduleIds are tied for the top spot
   in a directory's tally, instead of breaking the tie toward the lower id. `reconcileDirectoryFragmentation`
   treats `undefined` the same as "no reconciliation needed" for that directory - every file keeps
   whatever `classify` already gave it.
2. `enforceMinimumCommunitySize` (new) runs after `reconcileDirectoryFragmentation` and re-counts
   every Module's final size. A Module that reconciliation has shrunk below `MIN_COMMUNITY_SIZE`
   (documentation/adr/0015) - a file whose only community-mate was reconciled away to satisfy a *different*
   directory's genuine majority, the `bin.ts`/`runtime.ts` shape above - is unassigned
   (`unassignedReason: "undersized"`), the same outcome `classify`'s own size gate would have
   produced had it seen this final shape instead of the pre-reconciliation one.

Test files are excluded from both passes, consistent with documentation/adr/0010 and documentation/adr/0038 -
they're never a vote, never moved, and never subject to the size floor here (their dedicated bucket
is allowed to be any size by design).

## Consequences

- Measured on `dude-where-is-my-cli`: the ordinal Module is gone. `index.ts` is named `modules` (its
  real community); `bin.ts` is unassigned (`undersized`). `config/index.ts`, the independent second
  instance of the same shape, is also now unassigned rather than hiding behind a second ordinal
  label. No regression on this generator's own codebase - its module count and names are unchanged,
  since none of its directories hit either case.
- `louvain-module-detector.test.ts` gained two tests: a 1-vs-1 tie between two otherwise-unrelated,
  fully-embedded pairs sharing one directory (both keep their original, separate moduleIds), and a
  genuine 2-vs-1 majority elsewhere that leaves a third file's own pairing down to size one (that
  file is unassigned, `undersized`). All prior tests, including documentation/adr/0038's own, passed
  unchanged - every existing fixture's fragmented directory has a real majority, never a tie, and
  never shrinks a sibling community below the floor.
- documentation/adr/0038's Consequences bullet anticipating "a directory genuinely torn between two real
  domains" is now partly addressed for the most extreme case (an exact tie) - but a directory with,
  say, a 2-vs-2 split, or any tie not at the very top of the tally, still resolves to "no majority,
  leave it" the same way, which is the intended generalization, not a narrower one-off fix for the
  1-vs-1 case specifically.
- This is a strictly more conservative change in both directions: `majorityModuleId` can only decline
  to merge where it previously would have (never the reverse), and `enforceMinimumCommunitySize` can
  only unassign a file that reconciliation left without a real community (never reassign one that
  still has one). Determinism is unaffected - both functions remain pure in their inputs, with no new
  source of run-to-run variance.
