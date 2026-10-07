# 0006: Module names are derived from the nearest common container folder

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Resolves the naming question ADR-0001 explicitly deferred ("Module names/labels are themselves a downstream question... resolved separately, not by this decision"). The four-Modules-all-named-`src` example below motivated documentation/adr/0007-folder-proximity-weighted-detection.md, whose final (exponential) weighting eliminated *that* collision on this codebase - but it then surfaced a related gap this decision didn't cover: a single Module landing on `src` alone, with nothing else colliding on it, still looked like a real name. documentation/adr/0008-strip-universal-root-from-module-names.md closes that gap by stripping the codebase's universal top-level directory before this decision's nearest-common-ancestor naming ever runs. documentation/adr/0012-module-names-use-top-level-directory.md later narrows *which segment* of that nearest common ancestor becomes the name - the first one, not the last.

## Context

ADR-0001 fixed Module *detection* as fully algorithmic (Louvain community detection over the static import graph), but left each Module identified only by an opaque integer `moduleId`. The generated HTML visualization's legend surfaced this directly as `"Module " + moduleId`, giving an AI agent or human reader no hint of what domain a Module actually represents.

`CONTEXT.md`'s Module (Domain) section already frames a Module as a DDD-inspired bounded-context boundary, and notes it "frequently coincides with a Directory... but this is a correlation, not a rule." Since directory structure is the closest thing this codebase has to an existing, human-authored signal of domain boundaries, naming derives from it rather than from a second clustering pass, an LLM call, or a config file - consistent with ADR-0001's "no config, no LLM call, no human declaration" constraint.

## Decision

A Module's name is the nearest common ancestor directory shared by all files assigned to it (e.g. files under `src/clustering/louvain/` and `src/clustering/regions/` name the Module `clustering`). A single-file Module is named after that file's immediate parent directory.

When a Module's files share no common directory at all - the nearest common ancestor is the repo root - there is no folder to name the domain after. Rather than guess, the Module keeps the existing ordinal fallback: `"Module " + moduleId`.

A derived name shared by more than one Module is treated the same way. In practice, a Module whose files are genuinely scattered across unrelated directories often bottoms out at the same shallow ancestor (e.g. the package's own `src/` root) as other, equally scattered Modules - running this repo's own generator against itself produced four distinct Modules that all "named" themselves `src`. That's strictly worse than an integer label: it makes different domains look identical instead of merely unlabeled. Any name two or more Modules land on falls back to the ordinal label for each of them.

Unassigned files and External nodes are never part of a Module and don't participate in naming.

This is implemented as a pure function (`deriveModuleNames`, `src/clustering/module-naming.ts`) run by the schema-shaping layer (`buildMapJson`), which adds a top-level `modules: { id, name }[]` array to the map JSON envelope. It is purely additive to the schema - no existing field changes shape.

## Consequences

- The HTML visualization's Module legend (`client-shell.ts`) now shows a real folder-derived name instead of a bare integer.
- Naming stays deterministic and config-free, same as detection: the same input code produces the same names on every run.
- A Module whose files are deliberately scattered across unrelated directories (the case ADR-0001's Consequences calls out as a real limitation of purely algorithmic detection) gets a less informative `"Module N"` label rather than a fabricated one - an honest reflection of the underlying detection limitation, not a naming bug.
- `MapJson`'s envelope gains a `modules` key; any consumer that asserted the envelope's exact key set (e.g. golden-file fixtures) needed updating alongside this change.
