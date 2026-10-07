# 0039: Modules are ordered by execution flow (dependency order), not by id

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Adds a new, independent concern to `src/output/json/build-map-json.ts`'s existing
canonical-ordering rules (nodes by id, edges by a 4-key sort) alongside documentation/adr/0019's
`modules` field.

## Context

`deriveModuleNames` returns Modules in ascending order of the raw numeric `moduleId` Louvain happened
to assign them during community detection - an artifact of the library's own internal processing
order, carrying no meaning a reader could rely on. Asked directly why the generated `modules` array
read the way it did, the honest answer was "no reason" - not alphabetical, not organized by any
property of the codebase itself.

A reader of a codemap - human or agent - benefits from a more legible order: see the foundational
pieces a codebase is built from before the things built on top of them, the way `documentation/LLD.md`
itself already introduces this generator's own seams (`Discovery`, then `Parser`, then
`GraphBuilder`, then `ModuleDetector`, then the `Transformer`s) in roughly the order data flows
through them. That ordering isn't available as a declared property of an arbitrary target
codebase, though - only the import graph is. The generalizable version of "introduce foundations
first" is a dependency order: a Module that supplies something another Module imports should be
listed first.

Real codebases don't always form a clean dependency chain, though. Checked directly on this
repo's own generated map: `src/core/` is a classic composition root - it supplies shared types
(`core/types.ts`) to `cache/`, `clustering/`, `discovery/`, `extraction/`, and `graph-building/`
alike, and it also wires each of their concrete implementations back in (`compose.ts`,
`generate-map.ts`). That's a genuine, mutual two-way dependency between `core/` and each of those
five Modules - a real cycle, not a modeling mistake. A naive "place a Module once everything it
depends on is already placed, otherwise break the tie alphabetically" approach degenerates
immediately here: in round one, *nothing* is ready (`core/` depends on all five satellites;
each satellite depends on `core/`), so every single Module falls through to the alphabetical
fallback and the entire array ends up purely alphabetical - exactly what this decision set out to
improve on, just reached a different way.

## Decision

`orderModulesByExecutionFlow` (`src/clustering/module-ordering.ts`) first collapses the Module
dependency graph's strongly connected components with Tarjan's algorithm - every maximal set of
Modules that mutually reach each other, directly or through a longer cycle, as one unit. A
composition root and its satellites collapse into a single component this way, since there's no
meaningful "before" among them. The condensation of a directed graph's strongly connected
components is always itself acyclic, so topologically sorting the *components* - a component is
placed once every other component any of its members depends on is already placed - always
succeeds without needing a cycle-breaking fallback (one is kept anyway as a defensive floor, never
expected to fire, the same pattern this codebase already uses for `MIN_COMMUNITY_SIZE`,
documentation/adr/0015). Within a multi-Module component, and for any tie between independently-placeable
components, the order falls back to alphabetical by name - ordinal (non-locale) comparison,
matching every other sort in `build-map-json.ts`, for the same byte-identical-repeatability
reason.

Dependency edges are derived from file-level `import`-kind edges only (the same convention
`louvain-module-detector.ts` already uses), resolved to each file's `moduleId`: an edge whose two
endpoints share a Module, or touches an unassigned file, carries no inter-Module information and is
ignored.

## Consequences

- Measured on this repo's own generated map: `cache`, `clustering+output`, `core`, `discovery`,
  `extraction`, `graph-building` - the composition-root component - are listed first (alphabetically
  among themselves, since nothing orders them relative to each other); `integration`, `mcp`,
  `output`, the `tree-sitter-*` Modules, and `ts-compiler-api` - every Module that depends on the
  first group but isn't depended on back - follow. `tree-sitter-common` sorts before
  `tree-sitter-go`/`-java`/`-python`/`-rust` in this particular codebase, consistent with those four
  genuinely depending on it; that case happens to coincide with plain alphabetical order too, so it
  doesn't by itself distinguish this decision's dependency-based ordering from a simpler
  alphabetical-only one - the composition-root case above is the one that does.
- `module-ordering.test.ts` (new) covers: a direct two-Module dependency, a three-Module chain, a
  plain tie with no dependency between two Modules, a dependency cycle between exactly two Modules,
  a same-Module edge (ignored), an edge touching an unassigned file (ignored), and the
  composition-root-plus-satellites shape above - the last with Module names deliberately chosen so
  alphabetical order and the required dependency order disagree, so the test only passes if the
  strongly-connected-component logic is actually driving the result, not coincidentally agreeing
  with a simpler sort.
- `ModuleSummary`'s public contract (`documentation/USER_GUIDE.md`) is updated to describe this ordering
  explicitly, since a caller addressing the array by position rather than by `id` would now see a
  different, meaningful order - though the schema version is unchanged, since this reorders an
  existing field rather than changing any shape, and every documented consumer (`documentation/USER_GUIDE.md`'s
  own description of `modules` as an `{id, name}` lookup table) already addresses it by `id`, never
  by position.
- This is a heuristic, not a guarantee: a real dependency cycle collapses cleanly, but the
  within-component and tie-break order is "alphabetical," not "more foundational first" - there's no
  general way to rank Modules that depend on each other equally. Accepted as the honest limit of
  what's derivable from the import graph alone, consistent with documentation/adr/0001's "no config, no
  declaration" stance - this decision adds a derived *view* over already-computed Modules, not a new
  input to detection itself.
