# 0008: Module naming strips the codebase's universal root directory

[Back to 0006-module-naming-from-container-folder.md](0006-module-naming-from-container-folder.md) • [Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows ADR-0006's naming rule. Its own ordinal fallback for the "nothing left after stripping the root" case is further narrowed by documentation/adr/0009-interpolated-module-names.md, which synthesizes a name from the Module's child directories before giving up to `Module <id>`.

## Context

ADR-0006 names a Module after the nearest common ancestor directory of its member files, falling back to an ordinal `Module <id>` label only when the files share no directory at all. Running the generator on its own codebase after ADR-0007's folder-proximity weighting (which made most Modules folder-cohesive) exposed a case ADR-0006 didn't anticipate: this codebase, like most TypeScript projects, keeps every single file under one top-level directory, `src/`. A Module whose files happened to sit directly under `src` (with no further shared subdirectory) got named `"src"` - which is true of literally every file in the codebase, not just that Module. It looked like a real, specific domain name while carrying zero information distinguishing it from any other Module.

This is the same failure ADR-0006's "no common directory at all" fallback was meant to prevent, just one level up: a name is only useful if it says something about *this* Module that isn't equally true of the rest of the codebase.

## Decision

Before taking a Module's nearest-common-ancestor name, `deriveModuleNames` (`src/clustering/module-naming.ts`) first computes whether every File node in the graph shares the same first path segment (e.g. every file starts with `src/`). If so, that segment is stripped from a Module's own common-ancestor path before naming. A Module whose files don't share anything beyond that universal segment is left with nothing to name itself after, and falls back to the existing `Module <id>` label - the same fallback ADR-0006 already uses for the "no common directory at all" case.

This only strips one level, and only when it is truly universal (100% of files in the graph share it). A codebase with more than one top-level directory (e.g. `frontend/` and `backend/`) gets no stripping at all - in that case the top-level segment genuinely does distinguish one part of the codebase from another, so it's exactly the kind of name ADR-0006 wants to keep.

## Consequences

- Running the generator on its own codebase, the Module that previously named itself `"src"` now correctly falls back to `Module <id>`; the other nine Modules (already folder-cohesive one level deeper, e.g. `extraction`, `html`) are unaffected.
- `deriveModuleNames`'s existing collision fallback (two Modules landing on the same name) still runs afterward, on the already-stripped names - the two rules compose rather than conflict.
- Two prior unit tests (`module-naming.test.ts`'s "excludes unassigned files and external nodes", `build-map-json.test.ts`'s "derives a modules array...") asserted a single-file Module directly under the sole top-level directory should be named after that directory (e.g. `"src"`). Those assertions encoded the exact bug this ADR fixes; both were updated to nest the fixture file one level deeper so they still exercise their original purpose (excluding unassigned/external nodes; wiring `buildMapJson` to `deriveModuleNames`) without relying on the now-corrected behavior.

## Update: the universal root is computed over clustered files only

Unassigned files no longer take part in finding the universal root. Once root-level config files such as `vitest.config.ts` started being mapped, their mere presence meant no single root covered every file, so `src` stopped being stripped and nearly every Module collapsed to an ordinal `Module <id>` name. An unassigned file names no Module, so it has no say in how Modules are named.
