# 0038: A single directory's production files are never split across Modules

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows documentation/adr/0001's purely algorithmic detection and the "can split one directory's
files into different Modules" half of `CONTEXT.md`'s Module boundaries bullet, which this decision
removes.

## Context

documentation/adr/0036 and documentation/adr/0037 fixed two cases where Louvain's folder-proximity weighting
arbitrarily merged a shared dependency, or a dispatcher, into one of several structurally-equivalent
siblings. Running the generator on this repo's own codebase (`src/` only) afterward still showed
`src/core/`'s 21 files split three ways: 18 of them their own Module, `test-file.ts` merged into
`clustering/`'s Module, and `cargo-toml.ts`/`pyproject-toml.ts`/`toml-section.ts` merged into
`discovery/`'s. Checked for the same order-dependent instability documentation/adr/0036 and documentation/adr/0037 fixed
(the same file list re-clustered across seven different file-order permutations) - this one wasn't
that. Both splits were stable in every permutation: `test-file.ts` is imported from three external
directories, but two of its four importing files happen to live in `clustering/`, against one each
elsewhere - two votes beats one, every time. The three TOML files have zero edges to the other 18
`core/` files at all, and `discovery/manifest-detection.ts` alone imports both of them, against one
edge each from two `extraction/tree-sitter-*` directories - again decisively, not by chance.

So this wasn't noise to dilute away - it was `classify()` correctly measuring that a handful of
`core/`'s own files are, by the numbers, more tightly coupled to one specific outside directory than
to their 18 directory-mates. `CONTEXT.md`'s Module section had always allowed exactly this ("a strong
enough import signal can... split one directory's files into different Modules") as a real,
structural possibility, not a bug. The project opted to foreclose that possibility anyway: a
directory's files always belong together, regardless of how the import graph happens to weigh them
file-by-file.

## Decision

`reconcileDirectoryFragmentation` (`src/clustering/louvain/louvain-module-detector.ts`) runs as a
final pass over `classify`'s output, after Louvain and the embeddedness/community-size gates have
otherwise finished. For every exact directory (the full path, not just its top-level segment) whose
assigned, production files carry more than one distinct `moduleId`, every file in that directory is
reassigned to whichever `moduleId` already holds the most of them - a simple majority vote, ties
broken toward the lower (earlier-assigned) id for determinism. A directory with no `/` in its file
ids at all (a bare root-level id) is exempt, since "every such file shares one directory" would
wrongly fuse unrelated root-level files that merely lack a path prefix, not a real common directory.
Test files are excluded on both sides of the vote and as something to be moved - documentation/adr/0010
already buckets them together regardless of directory, the opposite grouping rule, so they have
nothing to contribute here.

This is a directory-level invariant, not a Module-level one: `src/core/cache/` and
`src/core/observability/` remain their own, separate Modules from the rest of `src/core/` after this
decision, exactly as before - they're different exact directories, each already internally
consistent (every file in each one already shared a single `moduleId`), so there was never anything
for this pass to reconcile there. Only a directory whose *own* files disagreed about their Module is
touched.

## Consequences

- Measured on this repo's own generated map: `src/core/`'s 21 files are now one Module, full stop.
  `clustering/`'s Module and `discovery/`'s Module each lost the stray `core/` file(s) they'd picked
  up, reverting to their own directories' files only.
- `louvain-module-detector.test.ts` gained a test mirroring this exact shape: two files that only
  import each other (a directory's majority) plus a third file in the same directory with no edge to
  either of them, only to an unrelated external triangle (the minority, pulled elsewhere by
  `classify` on its own). All three end up in the majority's Module; the external triangle, having no
  fragmentation of its own, is left untouched.
- `CONTEXT.md`'s Module boundaries bullet is updated to drop the "or split one directory's files into
  different Modules" half of its "not an enforced rule" caveat - that half is now actually enforced,
  with a cross-reference to this decision. The other half (a Module's files spanning multiple
  directories) is unaffected and still exactly as free as before.
- This is a genuine step away from documentation/adr/0001's "no config, no declaration, purely the import
  graph" framing - not by adding a config file or a human-declared boundary, but by asserting a
  structural rule (directories are atomic) the algorithm alone doesn't derive from the import graph.
  Accepted deliberately: a human decided this invariant matters more than always following
  `classify`'s per-file numbers to the letter, the same kind of call documentation/adr/0007's exponential
  weighting constant already made once before.
- A directory whose files are *genuinely* torn between two real domains (not just one outvoted file,
  but something closer to an even split) would still be forced together under the majority's Module
  by this rule, with no signal left in the output that the vote was ever close. No such case is known
  to exist in this codebase today; revisit if one surfaces and the forced merge turns out to hide a
  real, useful split rather than resolve a spurious one.
