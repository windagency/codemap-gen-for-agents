# 0013: A top-level naming collision falls back to the deeper common-ancestor name before giving up

[Back to 0012-module-names-use-top-level-directory.md](0012-module-names-use-top-level-directory.md) • [Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows documentation/adr/0012's collision handling.

## Context

ADR-0012 names a Module after the top-level directory of its files' common ancestor rather than the deepest one, so every Module name sits at a comparable depth. Its own stated consequence: this makes collisions more likely, since two Modules that are each cohesive somewhere under the same top-level directory (e.g. `src/output/html/` and `src/output/json/`, both under `output`) now collide on that shared top-level name where they previously had distinct deeper names. ADR-0012 accepted this and let ADR-0006's existing collision rule apply, falling both Modules back to their ordinal `Module <id>` label.

Running the generator on its own codebase after ADR-0012 confirmed exactly this: the Module built from `src/output/html/*` and the Module built from `src/output/json/*` both collided on `output` and became `Module 7` / `Module 8`. But those two Modules aren't actually indistinguishable - they're two disjoint, genuinely different domains (the HTML visualization vs. the JSON schema shaping) that happen to share a parent directory. Discarding `html` and `json` - names that were already sitting right there, unambiguous, and just as legitimately derived from the graph as `output` - to fall all the way to an opaque ordinal label throws away more information than the collision actually justifies.

## Decision

`deriveModuleNames` (`src/clustering/module-naming.ts`) now computes two candidate names per Module: `topName` (ADR-0012's top-level segment) and `deepName` (ADR-0006's original deepest-segment name). It first checks `topName` for collisions across all Modules. A Module whose `topName` is unique keeps it. A Module whose `topName` collides with another's uses its `deepName` instead. Only after this substitution does the final collision check (ADR-0006's original rule, unchanged) run again over the resulting names - a Module whose `deepName` also turns out to collide (or which has no deeper segment to fall back to, i.e. `topName` and `deepName` were already identical) still falls back to the ordinal `Module <id>` label.

This is a two-tier fallback, not a size change to the naming search space: `topName` and `deepName` were already both derived from the same common-ancestor path computed for ADR-0012, just read from opposite ends of it.

## Consequences

- Running the generator on its own codebase, the `src/output/html/*` and `src/output/json/*` Modules are now named `html` and `json` again instead of `Module 7` / `Module 8`, while every Module unaffected by ADR-0012 (`discovery`, `extraction`, `graph-building`, `integration`, `core+clustering`) is unchanged.
- A collision that would have been resolved by ADR-0006's simpler single-name rule is now resolved the same way only as a last resort; most real collisions between two folder-cohesive Modules under a shared parent will resolve via `deepName` instead, and only genuinely indistinguishable Modules (identical `topName` and `deepName`, e.g. two Modules that both bottom out at the same single segment with no closer common ancestor) still reach the ordinal label.
- `module-naming.test.ts` gained a test asserting the `html`/`json` disambiguation and a test asserting the ordinal fallback still applies when the deeper name collides too.
