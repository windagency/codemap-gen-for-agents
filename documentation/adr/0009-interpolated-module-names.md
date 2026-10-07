# 0009: Module names interpolate distinct child directories when there's no closer common ancestor

[Back to 0008-strip-universal-root-from-module-names.md](0008-strip-universal-root-from-module-names.md) • [Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows the ordinal-fallback case left by ADR-0006 and ADR-0008. The motivating `core+__tests__` example below was itself later addressed at the source by documentation/adr/0010-test-files-are-their-own-module.md, which stops test files from entering domain clustering at all - this decision's interpolation still applies whenever a Module's *production* files are genuinely scattered.

## Context

ADR-0006 names a Module after the nearest common ancestor of its files, falling back to an ordinal `Module <id>` label when they share no directory at all. ADR-0008 extended that fallback to also cover the case where the only shared ancestor is the codebase's universal top-level directory (e.g. `src`), since that says nothing distinguishing.

Running the generator on its own codebase after ADR-0008 still produced one Module with an opaque `Module 1` label: 14 files, 13 of them under `src/core/`, one outlier under `src/__tests__/golden/`. The single stray file broke the "nearest common ancestor" match entirely, even though the Module is overwhelmingly a `core`-shaped domain. An ordinal label discarded directory information the Module's files clearly did carry, just not as a single unanimous ancestor.

## Decision

When a Module's files share no ancestor closer than the (stripped) codebase root, `deriveModuleNames` (`src/clustering/module-naming.ts`) now looks one level below that: it takes each file's immediate child directory of the root, counts how many files fall under each one, and joins the distinct child names into a composite name ordered by file count (ties broken alphabetically) - e.g. `core+__tests__`. This is still derived purely from file ids already in the graph, no fabrication. Only when there are truly no child directories to interpolate from (every file sits with zero directory depth) does the ordinal `Module <id>` label remain.

The interpolated name still participates in ADR-0006's existing collision rule: if two Modules land on the same interpolated string, both still fall back to their ordinal labels.

## Consequences

- Running the generator on its own codebase, every one of its 10 Modules now gets a real, derived name; none are left with an opaque `Module <id>`.
- A Module with many scattered child directories (e.g. 5+ distinct top-level areas) will get a long, hyphen-free `a+b+c+d+e`-style name rather than a short one - verbose but still more informative than an ordinal label. This isn't capped; revisit if a real codebase produces an unreadably long interpolated name in practice.
- `CONTEXT.md`'s Module naming bullet is updated to describe this as a fallback below "nearest common ancestor," not a replacement for it - a Module with any real shared ancestor beyond the root still gets that simpler name, unaffected by this decision.
