# 0041: A Module's owning Package name is a fourth naming tier

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Extends documentation/adr/0012's "top-level segment" rule and documentation/adr/0035's interpolation tier with
a fourth fallback, drawn from Discovery's already-computed Package boundary rather than directory
structure alone.

## Context

Running the generator against a separate real monorepo (`biological-memory`, laid out as
`packages/<name>/src/...` plus a sibling top-level `benchmarks/` directory) left 4 of 7 Modules
ordinal. Two different, compounding reasons:

- The repo has more than one top-level directory (`packages/` and `benchmarks/`), so
  documentation/adr/0008's universal-root stripping never fires - `packages` stays in every `packages/*`
  Module's common ancestor, and it's exactly as uninformative as a true universal root would be,
  just not literally universal. Every `packages/*` Module's top-level name collided on the literal
  string `"packages"`.
- Falling back to the deepest segment (documentation/adr/0013) didn't help either: two of those Modules
  (`raiminiscence-cli`, `raiminiscence-hooks`) keep their package's own entrypoint files directly in
  that package's `src/`, with no further subdirectory - so both deepNames were the equally generic
  `"src"`, colliding with each other too. Nothing was left to interpolate from (documentation/adr/0035) since
  there was no directory information beyond `"src"` itself.

documentation/adr/0012's own reasoning ("In a monorepo where every file lives under some `packages/<name>/`
prefix, that same rule makes `<name>` - the package - the top-level segment") assumed the repo's
*only* top-level directory was the packages wrapper, so stripping the universal root would land
exactly on the package name. That assumption breaks the moment a sibling top-level directory exists
(a `benchmarks/`, `tools/`, `scripts/`, or similar) - a genuinely common shape, not a corner case.

The information needed to fix this was already present and already computed: Discovery produces a
`Package` node for every manifest-rooted directory (`DiscoveredStructure.packages`,
`src/graph-building/default/default-graph-builder.ts`), each with its own declared `name` (or
directory basename fallback). A Package's id is a real directory-path prefix of every file it owns
(`<dir>`, or `<dir>@<family>` for a co-located manifest, documentation/adr/0034's `parsePackageDir` already
parses this) - so a file's owning Package, and that Package's name, is derivable purely from ids
already on the graph, the same "no fabrication" standard every other naming tier holds to.

## Decision

`deriveModuleNames` (`src/clustering/module-naming.ts`) gains a fourth candidate name, `packageName`:
the owning Package's declared name, when every one of a Module's files resolves to the *same*
Package (`singlePackageNameOf`/`owningPackageNameOf`, matching the longest Package directory prefix
of each file, so a nested Package wins over an enclosing one). It's tried in two places:

- As `interpolatedName`'s own fallback, replacing the direct-to-ordinal jump used before: when
  there's nothing to interpolate (zero directory depth past the common ancestor), a Module falls
  back to its Package's name rather than straight to `Module <id>`.
- As an explicit fifth tier in the collision chain (topName → deepName → interpolatedName →
  packageName → ordinal), for the case where interpolation *does* find something, but that
  something still collides with another Module's already-settled name.

A Module whose files span more than one Package, or whose graph carries no Package nodes at all
(an older graph, or one built without Discovery's Package data), gets `undefined` from
`singlePackageNameOf` and falls straight through to the ordinal label at that tier, unchanged from
prior behavior.

## Consequences

- Measured on `biological-memory`: 5 of 7 Modules now get a real name (previously 3 of 7).
  `raiminiscence-cli` and `raiminiscence-hooks` - both hitting the "nothing to interpolate" case -
  are fixed outright.
- Two Modules remain ordinal, and are expected to: both are scattered pieces of the *same* Package
  (`raiminiscence-mcp`) that happen to collide on the literal string `"core"` (one Module genuinely
  is that package's `core/` directory; the other is an unrelated scattered trio whose interpolated
  name coincidentally lands on the same word). Package name can't disambiguate two Modules that
  share one Package - this fix narrows the ordinal-fallback case, it doesn't remove it.
- `module-naming.test.ts` gained four tests: the "nothing to interpolate, single Package each" case
  (fixed), the "interpolation succeeds but still collides, each falls back to its own distinct
  Package" case (also fixed, via the explicit fourth tier), and the "both Modules share one Package"
  case (correctly still ordinal - verified by actually running the fixture, not just reasoning about
  it, since the collision cascade through four tiers is easy to mis-predict by hand). All prior
  tests, which build no `PackageNode` fixtures, are unaffected - `singlePackageNameOf` returns
  `undefined` whenever no Package nodes are present, identical to the pre-existing direct-to-ordinal
  behavior.
- `src/clustering/module-naming.ts` now imports `parsePackageDir` from `src/core/languages.ts` - a
  normal downward dependency (clustering already depends on `src/core/test-file.ts`), unaffected by
  the pipeline dependency-direction rules (`dependency-direction.test.ts`), which only forbid `core/`
  reaching into an implementation subfolder, not the reverse.
