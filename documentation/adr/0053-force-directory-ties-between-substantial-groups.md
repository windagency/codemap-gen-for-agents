# 0053: A directory tie between substantial groups is resolved, not skipped

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows documentation/adr/0040's own narrowing of documentation/adr/0038 - restores documentation/adr/0038's original
lowest-id tiebreak, but only for the case documentation/adr/0040 itself didn't test.

## Context

Even after documentation/adr/0048 through documentation/adr/0052, the operator who drove this whole investigation flagged one
more problem: `valora`'s `src/cli/` directory - one real directory, 32 files sitting directly in it
(not counting its own `commands/`, `presenters/`, and `types/` subdirectories, each its own exact
directory) - came out scattered across seven different Modules (`cli-1`, `cli-2`,
`commands+types`'s own 11-file share, `ui+cli`'s, `output+cli+executor`'s, `config+cli`'s, and one
`low-embeddedness` straggler).

Measuring why: `countModuleIdsByDirectory`'s own tally for `src/cli` showed two groups tied for the
top spot at 11 files each, with the rest (5, 2, 1, 1) trailing behind as genuine minorities that
*should* already have been swept into whichever of the two leaders won - except nothing ever picked a
leader, because documentation/adr/0040's `majorityModuleId` returns `undefined` on *any* tie for first, forcing
nothing. Checking the two tied groups' own connectivity confirmed they're genuinely different Louvain
communities with zero import edges between them (one built around `command-executor.ts`, the other
around `index.ts`/`commander-adapter.ts`) - so this isn't the refinement pass being over-eager, it's
the original top-level clustering having already split one directory's files into two substantial,
internally-cohesive-but-mutually-disconnected pieces, each large enough to anchor its own Module, each
exactly tied for "majority" of their shared directory.

documentation/adr/0040's own reasoning for skipping a tie - "forcing one of two equally-sized groups onto the
other isn't resolving fragmentation, it's manufacturing an arbitrary relationship neither side actually
has" - was built entirely around a *literal* two-individuals case: `dude-where-is-my-cli`'s
`src/bin.ts` and `src/index.ts`, one file each, each already fully embedded with its own single
outside dependency. Forcing that tie would have stripped `partner1/x`'s only community-mate away,
leaving it orphaned for no real gain - the "arbitrary relationship" is the *loser's own outside
partner* losing its one real pairing, not the directory vote itself. That mechanism simply doesn't
apply when the tied groups are each already a substantial, self-contained community of their own:
forcing `src/cli`'s 11-file `cli-1` group to join the other 11-file group's Module doesn't strip
either side of an outside partner - both groups' own internal cohesion is untouched either way, only
their directory-identity changes. documentation/adr/0040's protection is for individuals; it was never meant to
also shield two large, independently-real groups from ever being unified, and applying it there anyway
is exactly what left `src/cli` in seven pieces.

## Decision

`majorityModuleId` (`src/clustering/louvain/louvain-module-detector.ts`) now distinguishes the two
shapes by the tied count itself, not by "is there a tie at all." A tie where the top two contenders
each hold exactly one file is left unreconciled, exactly as documentation/adr/0040 established - still
"two individuals," still no real majority to defer to. A tie where the top two contenders each hold
more than one file is resolved by lowest moduleId - documentation/adr/0038's own original tiebreak,
before documentation/adr/0040 narrowed it away for the individuals case specifically. A three-or-more-way tie
is resolved the same way, by whichever tied contender has the lowest id, since the same "already
substantial, nothing stripped" reasoning applies regardless of how many sides are tied.

## Consequences

- Measured on `valora`: `src/cli`'s seven-way split collapses into effectively one real Module for the
  directory's own direct files (joined by whichever of the two 11-file groups the deterministic
  tiebreak favors), with the minority groups (5, 2, 1, 1 files) correctly swept in as before - they
  were never blocked by the tie in the first place, only hostage to it never being resolved.
- The losing side's own moduleId, if it held nothing outside `src/cli` itself, simply ceases to exist
  as a separate Module; `enforceMinimumCommunitySize` (unchanged, already runs after this pass) catches
  the case where forcing the tie strands some *other*, outside file that depended on the losing side
  for its own minimum size - the same cascade documentation/adr/0040's own second test already established
  for a genuine (non-tied) majority, now also reachable via this tiebreak.
- `louvain-module-detector.test.ts` gains a test for the newly-resolved shape (two 2-file groups, each
  independently fully-embedded with its own outside partner, tied for a shared directory) confirming
  both the forced merge and the correctly-orphaned loser's outside partner. documentation/adr/0040's own
  individuals-only test is unchanged and still passes untouched - confirmed by running it, not assumed.
