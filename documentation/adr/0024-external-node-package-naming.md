# 0024: An External node's package name reflects the resolved manifest's own identity, not a local import alias

[Back to documentation/adr/README.md](README.md)

## Status

Accepted. Documentation-only - no behavior change. Supersedes the stale "package name = the path segment(s) after the last `node_modules`" description in extraction-algorithm tickets 03 and 11 (see the "Comments" section added to each).

## Context

A full-history code-review pass flagged a real ambiguity: what does an `ExternalNode`'s `name` mean when a repo declares an aliased npm dependency (e.g. `"foo": "npm:bar@1.0.0"` in `package.json`)? The extraction-algorithm tickets that originally specified File-vs-External classification describe deriving the package name from the *realpath's own path segment* after the last `node_modules` - for an npm-style alias installed as an actual (non-symlinked) copy under `node_modules/foo`, that segment is the local alias `foo`, not the upstream package's own name `bar`.

That description turned out not to match what `TsCompilerApiParser` actually ships. `resolveImportTarget` (`src/extraction/ts-compiler-api/ts-compiler-api-parser.ts`) uses the `node_modules` path-segment check only to *classify* File vs. External (`isUnderNodeModules`). Once something is classified External, the `name` itself comes from a second, separate step: `resolveExternalManifest` walks to the resolved target's own `packageJsonDirectory` (as TypeScript's checker/program already computed it) and reads that manifest's own declared `"name"` field - never the path segment, and never the importer's local alias.

## Decision

This is confirmed as the intended behavior, not a bug to fix: an `ExternalNode.name` is the resolved package's own installed manifest's declared name. A locally-declared import alias plays no part in it. Two different aliases in two different `package.json` files that both resolve to the same real upstream package are therefore recognized as the exact same `ExternalNode` - correct, since they really are the same code on disk, at the same version, regardless of what any one importer chose to call it locally.

No code changes. `ts-compiler-api-parser.ts`'s `resolveExternalManifest`/`resolveImportTarget` already implement this; `default-graph-builder.ts`'s External dedup-by-name (ADR-0021) already keys on that same manifest name.

## Consequences

- `CONTEXT.md`'s External entry is sharpened to state this explicitly.
- The stale path-segment-derivation text in extraction-algorithm tickets 03 and 11 is annotated as superseded by this ADR, so a future reader isn't misled into thinking the shipped behavior is a bug.
- `ExternalNode.id`/`.name`/`.version` computation is unchanged; no schema/`schemaVersion` impact.
