# 0017: ExternalNode dedup-by-name silently keeps only the first-seen version across a monorepo

[Back to 0021-external-node-version-disambiguation.md](0021-external-node-version-disambiguation.md) • [Back to documentation/adr/README.md](README.md)

## Status

Superseded by [documentation/adr/0021-external-node-version-disambiguation.md](0021-external-node-version-disambiguation.md), which implements the real fix this ADR deferred. Kept for the historical record of why the fix was deferred at the time; the "Decision"/"Consequences" below no longer describe current behavior.

## Context

The extraction spec's External node & lockfile version resolution decision has `Parser` resolve a package's version by walking upward from the *exact resolved path* an import reached, "correctly handling divergent versions across a monorepo" - e.g. a workspace with `packages/a/node_modules/left-pad@1.2.3` and `packages/b/node_modules/left-pad@2.0.0` both hoisted or nested independently. `Parser` does this correctly: each `RawImport.resolvedTarget` carries the version actually installed at the path that specific import resolved to.

`DefaultGraphBuilder.buildImportGraph` (`src/graph-building/default/default-graph-builder.ts`) then throws that precision away. Because the JSON schema's `ExternalNode.id` is the package name alone (`documentation/LLD.md`: "External id = package name"), `buildImportGraph` dedupes by name in an `externalsByName` map and keeps only the first version it happens to see, in `symbols` iteration order:

```ts
if (resolvedTarget.kind === "external" && !externalsByName.has(target)) {
  externalsByName.set(target, {
    id: target,
    kind: "external",
    name: target,
    version: resolvedTarget.version,
  });
}
```

A second import of the same package name resolving to a genuinely different installed version (the exact monorepo scenario the extraction spec calls out) silently loses its own version: the emitted graph shows every importer of `left-pad` pointing at one `ExternalNode` stamped `1.2.3`, even for the importer that actually resolved `2.0.0`. This isn't a bug introduced by an oversight in `buildImportGraph` - it's a direct consequence of the schema's own `id = name` decision, which never anticipated two different versions needing two different ids for the same name.

## Decision

Do not silently special-case this in `GraphBuilder`. Document it instead, and make the current behavior an intentional, tested contract rather than an unverified gap:

1. **The limitation is accepted for now.** `buildImportGraph` keeps deduping `ExternalNode`s by package name, first-seen version wins.
2. **"First-seen" is made deterministic**, not incidental: `symbols` is iterated in `Discovery`'s `programFiles` order (already deterministic - repo-relative POSIX paths, stable per run), and within one file, `imports` is iterated in `Parser`'s own extraction order (also deterministic, per the extraction spec's repeatability requirement). So although only one version survives, it is always the *same* one across repeated runs on unchanged input - reproducible, just not lossless.
3. **A real fix is deferred, not attempted here**, because it isn't a `GraphBuilder`-local decision:
   - Making `ExternalNode.id` version-qualified (e.g. `left-pad@1.2.3`) would change the shape of a `codemap-json-schema` type the spec explicitly calls a locked contract - "any change that would rename or retype an existing field here is a breaking change and should bump `schemaVersion` and get its own ADR".
   - It would also change what `GraphBuilder.build`'s seam is allowed to assume about `ExternalNode` construction, which documentation/adr/0003 fixes as part of the generator pipeline's seam contracts; ADR-0004 records the same project's general rule that a breaking change to a fixed contract "needs its own decision record, not a silent addition."
   - Committing to a specific version-qualified id scheme here - inside a data-clump/dedup bugfix - would make that seam-and-schema decision by accident, without weighing alternatives (e.g. should two versions of the same package still share one node with a `versions: string[]` field instead? does every consumer of `codemap.json` need to be updated in lockstep?). That deserves its own ADR when it's actually prioritized, not a side effect of this ticket.

## Consequences

- Given two `ExtractedSymbols` entries whose imports resolve the same package name to two different versions, the resulting graph has exactly one `ExternalNode` for that name, carrying whichever version was attached to the import seen first in `symbols`/per-file `imports` order - deterministic across runs, but not version-accurate for every importer. `default-graph-builder.test.ts` ("keeps the first-seen version, deterministically, when two imports resolve the same package name to different versions across a monorepo") pins this down as intentional, regression-tested behavior instead of an unverified gap.
- The code comment directly above `buildImportGraph` in `src/graph-building/default/default-graph-builder.ts` now points at this ADR by path, so a future reader hits the documented tradeoff instead of independently rediscovering it.
- A real monorepo containing genuinely divergent versions of the same external package will show every one of that package's importers pointing at a single `ExternalNode` version, understating cross-version drift an agent reasoning about the map might care about. Anyone hitting this in practice should raise fixing `ExternalNode.id` (and the schema/seam ADR that requires) as its own piece of work, not patch around it locally in `GraphBuilder`.
- No fixture or golden-file test needs updating: none of the existing fixtures exercise two divergent versions of the same package name, so this ADR's regression test is additive, not a change to any existing expected output.
