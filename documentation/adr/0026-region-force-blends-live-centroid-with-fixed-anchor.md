# 0026: The Force-directed view's region force blends a live centroid with a fixed anchor point

[Back to documentation/adr/README.md](README.md)

## Status

Accepted. Documentation-only - no behavior change; this records the rationale for code that has existed, unexplained, since the original implementation commit.

## Context

The visualization spec (line 36) describes Force-directed view's region-grouping force as pulling "each node toward the live centroid of its own Module region." `regionForce` in `src/output/html/client-force-view.ts` does not do that: on every simulation tick, each node's target point is `centroidX * 0.55 + anchor.x * 0.45` (and the same 0.55/0.45 split on Y), where `centroidX`/`centroidY` is the live mean position of every node currently in that region and `anchor` is `anchorByRegion`'s fixed point for that region - a point on a circle of radius `ANCHOR_RADIUS` around `(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2)`, computed once at simulation start from each region's index among `regionIds`, and reused as-is for every node's initial scatter position (`simNodes.forEach` right after `anchorByRegion` is built).

This blend has shipped, uncommented, since the feature's original implementation (`460bbf2`), and survived every subsequent full-history code-review pass (`7886d77`, `c14863c`, `8d0af72`, `c77c9c9`, `4bc94f9`) without ever being flagged, questioned, or reconciled with the spec's "live centroid" wording.

**Why a pure-centroid force is unstable.** A region-grouping force whose target is purely its own region's live centroid is self-referential feedback: the target every node in a region is pulled toward is itself just the mean of those same nodes' current positions, recomputed every tick. Nothing in that formulation references anything outside the region. Over many ticks, in combination with the shared `charge`/`collide`/`link` forces already acting on every node regardless of region, a whole region's node cluster (and its centroid with it) is free to drift arbitrarily across the canvas, and two regions' centroids have no force keeping them apart - they can converge and visually merge, defeating the entire point of a "soft colored hull renders behind each region's nodes" (spec.md line 36).

**Why the fixed anchor fixes it.** `anchorByRegion` gives each region one fixed point, spaced evenly around a circle so that no two regions start (or get pulled back toward) the same sector of the canvas. Blending 45% of that fixed point into `regionForce`'s target every tick means each region is continuously pulled back toward its own stable sector, bounding how far its centroid can drift and keeping two regions' sectors from ever coinciding - while the 55% live-centroid component still lets a region's nodes self-organize and breathe around their own real layout rather than being rigidly pinned to the anchor point itself.

## Decision

This blend is confirmed as a deliberate region-force stabilization mechanism, not an oversight to be reverted to a pure centroid pull, and not a bug the spec's wording should be read literally against. The spec's "live centroid" description is treated as the intent for the *breathing* half of the force, not a complete specification of the whole target computation - the fixed-anchor half is necessary supporting machinery the spec didn't anticipate needing.

No code change to the blend ratio (`0.55`/`0.45`) or to `anchorByRegion`'s construction. The only change alongside this ADR is a comment directly above `regionForce` in `client-force-view.ts` pointing here, so a future reader (including a future full-history review pass) finds the rationale instead of re-flagging this as an unexplained divergence from the spec.

## Consequences

- `client-force-view.ts`'s `regionForce` now carries a comment citing this ADR and explaining the blend, immediately above the function.
- The original ticket spec is left unchanged - it is a historical ticket spec, not living documentation, and this ADR is the durable record of where shipped behavior diverges from it (the same pattern used for `documentation/adr/0024`'s similar spec/shipped-behavior reconciliation).
- Anyone tuning Force view's layout (the 0.55/0.45 split, `ANCHOR_RADIUS`, or `VIRTUAL_WIDTH`/`VIRTUAL_HEIGHT`) should read this ADR first: lowering the anchor's weight materially reintroduces the drift/merge risk described above, and removing it entirely reintroduces the unbounded self-referential feedback loop.
