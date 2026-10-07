# 0012: Module names use the top-level directory of the common ancestor, not the deepest one

[Back to 0006-module-naming-from-container-folder.md](0006-module-naming-from-container-folder.md) • [Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows ADR-0006's naming rule (which named a Module after its files' *nearest* common ancestor directory), on top of ADR-0008's root-stripping and ADR-0009's interpolation fallback. documentation/adr/0013-deeper-name-disambiguates-top-level-collisions.md later narrows the collision consequence described below: two Modules colliding on the top-level name now fall back to their (still real) deeper names before reaching for the ordinal label.

## Context

ADR-0006 names a Module after the last segment of its member files' nearest common ancestor directory. Running the generator on its own codebase surfaced an inconsistency this produces: a Module folder-cohesive one level below `src` (e.g. everything under `src/clustering/`) gets the readable name `clustering`, but a Module cohesive two levels down (e.g. everything under `src/discovery/filesystem/`, or `src/output/html/`) gets named `filesystem` or `html` instead of `discovery` or `output`. Both are equally valid directory names, but they sit at different depths, so the resulting Module list mixes top-level domain names with second-level implementation-detail names, with no way to tell which is which from the name alone. `Discovery` and `discovery/filesystem` are different granularities of the same domain; a reader scanning the Module list has no signal for why one Module surfaced the domain and another surfaced a leaf detail.

The same inconsistency would show up in a monorepo. If every file lives under some `packages/<name>/` prefix, ADR-0008 strips the universal `packages` segment before naming, same as it strips `src` in a single-package repo. But a Module cohesive at `packages/billing/src/invoices/` would still be named `invoices` (the deepest segment) rather than `billing` (the package - the actual domain boundary in a multi-package codebase), for the same reason `src/output/html/` was named `html` instead of `output`.

## Decision

`deriveModuleNames` (`src/clustering/module-naming.ts`) now takes the *first* segment of a Module's root-stripped common-ancestor path as its name, not the last. Concretely: `src/clustering/louvain/` and `src/output/html/` both still strip the universal `src` root (ADR-0008), but where the name used to be the deepest remaining segment (`louvain`, `html`), it's now the shallowest one (`clustering`, `output`). Every Module name now sits at the same depth - one level below the codebase's stripped root - regardless of how deep that particular Module's files happen to be nested.

This is the same rule the interpolation fallback (`childSegment`/`interpolatedName`, ADR-0009) already used - it takes each file's immediate child of the root, not its deepest directory - so this decision just brings the primary naming path into line with the fallback path instead of leaving them inconsistent.

In a monorepo, this makes the package the Module name whenever every file shares a `packages/<name>/`-shaped (or similar) universal prefix: the package is the first segment after that stripped prefix, exactly analogous to how a top-level `src/` subdirectory is the first segment in a single-package repo. No separate "detect the package boundary" logic was needed - it falls out of the existing root-stripping plus this decision's first-segment rule.

## Consequences

- Running the generator on its own codebase, Modules that previously named themselves `filesystem`, `html`, `json`, and `mcp` (all one level deeper than their true top-level domain) now name themselves `discovery`, `html`, `json` (see ADR-0013 - these two collide on `output` and fall back to their still-real deeper names), and `integration`. Modules already cohesive at the top level (`clustering`, `extraction`, `core`, `graph-building`) are unaffected, since their first and last segment were already the same.
- A collision is now more likely than before, precisely because names are coarser - two Modules that both happen to be cohesive somewhere under the same top-level directory now collide on it. ADR-0013 resolves most of these by falling back to the deeper (pre-this-decision) name rather than going straight to `Module <id>`; only a collision that persists at that deeper level still reaches the ordinal label.
- This only strips one universal prefix (ADR-0008's constraint) and then takes one segment below it. A monorepo whose packages live under more than one distinct top-level directory (e.g. both `apps/` and `packages/`) has no single universal segment to strip, so this decision's benefit doesn't reach that layout - names would still be `apps` or `packages` rather than the package name. No codebase this generator has run against exhibits that layout yet; revisit if one does, the same way ADR-0008 and ADR-0009 each narrowed a case found by dogfooding rather than by speculation.
- `module-naming.test.ts`'s assertions that encoded the old deepest-segment behavior (a two-level-deep Module named after its leaf directory) were updated to expect the top-level directory instead; a new test asserts the monorepo/package case.
