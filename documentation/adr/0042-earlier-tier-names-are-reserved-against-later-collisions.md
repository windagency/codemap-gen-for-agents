# 0042: An earlier naming tier's unique name is reserved against a later collision

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows every prior naming-collision tier (documentation/adr/0013, documentation/adr/0035, documentation/adr/0041) -
none of them previously distinguished *when* a Module reached a given candidate string, only
*whether* it currently collided with another Module's current candidate.

## Context

Running the generator against `biological-memory` after documentation/adr/0041 still left two Modules ordinal:
the real `packages/raiminiscence-mcp/src/core/` directory (27 files) and an unrelated, scattered
three-file Module (`id.ts`, `logger.ts`, `server.ts`) elsewhere in the same package. Traced
precisely: the 27-file Module settles cleanly on `"core"` at the *second* tier (`deepName`) - its
common ancestor is exactly that directory, no same-tier rival. The three-file Module only *reaches*
the identical string `"core"` at the *third* tier (`interpolatedName`) - one of its three files
happens to sit under `core/adapters/`, and interpolating one level past its own (different, shallower)
common ancestor lands on that same word, purely by coincidence.

Every tier-collision rule up to this point (documentation/adr/0013's `resolveTierCollisions`, generalized by
documentation/adr/0035 and documentation/adr/0041) worked by recomputing name counts over *all* Modules' *current*
candidates at each step and pushing every Module whose current name collided down to its own next
tier - with no memory of *which tier* produced a given name. So when the three-file Module's
tier-3 value collided with the 27-file Module's already-settled tier-2 value, the rule saw only
"two Modules currently named `\"core\"`" and pushed *both* of them down to documentation/adr/0041's Package-name
tier - even though the 27-file Module had already found a perfectly good, unique, more-specific name
one tier earlier and had no reason to give it up. Both ended up sharing `"raiminiscence-mcp"` at the
Package tier too (the same package), cascading to the ordinal label for both.

## Decision

`resolveNamesByPriority` (`src/clustering/module-naming.ts`) replaces the four sequential
`resolveTierCollisions` calls with a single pass that walks the same four tiers in order
(`topName`, `deepName`, `interpolatedName`, `packageName`) but tracks a *reserved-names* set across
all of them. At each tier, a Module settles on its candidate there only if that candidate is both
unique among the Modules still unsettled *and* not already reserved by a Module that settled at an
*earlier* tier. A name a Module settles on is immediately reserved, permanently, for the rest of the
resolution. Two or more Modules that collide at the exact same tier are unaffected by this change -
neither has priority over the other, so both still fall through together exactly as before (`src/output/html/`
and `src/output/json/` both reach their deepName at the same tier and both settle there, unchanged).

## Consequences

- Measured on `biological-memory`: all 7 detected Modules now get a real name (previously 5 of 7).
  The 27-file `core/` directory keeps `"core"`, reserved at the deepName tier; the unrelated
  three-file Module falls past the now-taken `"core"` to its own Package's name,
  `"raiminiscence-mcp"` (free, since nothing else claims it).
- This is a strict improvement on documentation/adr/0041's own test fixture, not just the real-world case: a
  Module that cleanly settles on its own directory name one tier earlier no longer gets needlessly
  bumped to its Package name just because some unrelated Module's fallback chain happens to land on
  the identical string later. That test's expected names changed from `{"app", "widget"}` to the
  better `{"core", "widget"}` - caught by actually re-running the fixture after the refactor, not by
  re-deriving the expectation by hand (the four-tier collision cascade is easy to mis-predict
  manually, as documentation/adr/0041 itself noted).
- `module-naming.test.ts`'s full suite - every prior collision tier's tests, including documentation/adr/0013's
  `output/html`-vs-`output/json` same-tier case - passed unchanged, confirming same-tier collisions
  are untouched by this decision.
- Determinism is preserved: tier order is fixed, grouping is order-preserving over an already
  id-sorted input, and the reserved-names set is built deterministically from that same fixed
  order - no new source of run-to-run variance.
- This remains a heuristic, not a guarantee: a Module whose *only* available name at *every* tier
  happens to coincide with another Module's reserved name still falls to the ordinal label (e.g. two
  Modules in the same Package that both bottom out at the identical interpolated string with no
  earlier tier to distinguish either of them). documentation/adr/0041's own residual case - two Modules sharing
  one Package with no distinguishing structure at all - is unaffected by this decision; it was never
  the shape this fixes.
