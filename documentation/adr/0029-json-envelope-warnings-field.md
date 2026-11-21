# 0029: JSON envelope gains a top-level `warnings` field

[Back to 0002-ts-compiler-api-over-tree-sitter.md](0002-ts-compiler-api-over-tree-sitter.md) • [Back to 0003-generator-pipeline-seams.md](0003-generator-pipeline-seams.md) • [Back to 0056-scip-index-resolution-for-tree-sitter-languages.md](0056-scip-index-resolution-for-tree-sitter-languages.md) • [Back to documentation/adr/README.md](README.md) • [Back to TESTING.md](../TESTING.md)

## Status

Accepted. Amends `codemap-json-schema/spec.md`'s envelope. Bumps `schemaVersion` to `1.3.0` (`src/output/json/build-map-json.ts`), following the same minor-bump-for-purely-additive-field precedent as [ADR-0021](0021-external-node-version-disambiguation.md) and the `languages` field's `1.2.0` bump.

## Context

[ADR-0003](0003-generator-pipeline-seams.md)'s Consequences and the extraction spec's Out of Scope section both flagged the same gap: `generateMap()` already computes a `warnings: string[]` array - one entry per file skipped under the unparseable-file policy (ticket 13) or the manifest-less-file policy (ADR-0002) - but that array only ever reached `GeneratedMap.warnings`, a field on the *in-process* return value of `runGenerateCommand`/`runReadCommand`. Neither of those commands' own output types (`GenerateCommandOutput`/`ReadCommandOutput`, locked by `codemap-public-interface`) has a slot for it, so both just logged it and dropped it (`generate-command.ts`'s `logSkippedFileWarnings`).

This meant a `codemap.json` file read back later - by an MCP `read` call, a re-opened HTML view, or any consumer that wasn't the exact process that ran `generate` - had no way to learn that some file was silently missing from the map. The only warning ever left the process as a log line at generation time; documentation/HLD.md listed this explicitly as a milestone non-goal ("Surfacing skipped/unparseable files as a `warnings` field in `codemap.json` - the schema envelope doesn't carry one yet").

## Decision

`build-map-json.ts` adds a fifth top-level key, `warnings: string[]`, threaded through as a second parameter to `buildMapJson(graph, warnings = [])`. `generateMap()` computes the warnings array exactly once and reuses it for both `GeneratedMap.warnings` (the existing, still-logged surface) and the new envelope field, passed to `jsonTransformer.transform(clusteredGraph, { warnings })` via a new `TransformOptions.warnings?: string[]` - mirroring how `TransformOptions.title` already threads an HTML-only option through the same `Transformer` seam, just in the opposite direction: `JsonTransformer` reads `warnings` and ignores `title`; `HtmlTransformer` reads `title` and ignores `warnings` (it keeps calling `buildMapJson(graph)` with no second argument, so its embedded `#cm-data` script always carries an empty `warnings` array - surfacing warnings inside the HTML view itself is not part of this decision).

Order is preserved exactly as `generateMap()` already produces it (manifest-less warnings first, then unparseable-file warnings, each in `Discovery`'s own order-independent-but-deterministic order) - `buildMapJson` never re-sorts it, the same pass-through treatment every other already-resolved field gets.

## Consequences

- `MapJson.warnings: string[]` is a real field; `SCHEMA_VERSION` is `"1.3.0"`.
- All ten checked-in `fixtures/expected/*.codemap.json` golden files gained the field (empty array in every scenario except `broken-file`, which shows `["Skipped unparseable file: src/broken.ts"]`) and had `schemaVersion` bumped to match.
- `GenerateCommandOutput`/`ReadCommandOutput` are unchanged - this was already achievable without touching either locked type, since the warnings only needed to reach `jsonTransformer.transform`, not a new CLI/MCP field.
- The tree-sitter parsers (Go/Rust/Java) still perform no syntax-error detection of their own (confirmed: no `hasError()`/`ERROR`-node check anywhere in `tree-sitter-common`/`tree-sitter-go`/`tree-sitter-rust`/`tree-sitter-java`), so a syntactically-broken non-TS file produces no warning today - it silently extracts whatever partial symbols tree-sitter's error recovery yields, exactly as before this decision. Extending unparseable-file detection to the tree-sitter parsers is a separate, not-yet-specified follow-up; this decision only surfaces what `TsCompilerApiParser` already detects.
- documentation/HLD.md's former milestone non-goal entry for this is removed; documentation/LLD.md's "Divergences" entry noting the gap is removed.

## Update: tree-sitter parsers now skip broken files too

The follow-up this record left open is done. The shared tree-sitter skeleton (`src/extraction/tree-sitter-common/tree-sitter-parser.ts`) drops any file whose tree holds an ERROR or MISSING node, so a broken Go/Rust/Java/Python file produces no FileNode and surfaces as `Skipped unparseable file: <path>`, the same as TS/JS. It is also left out of import resolution, so an import into it is unresolved, never a dangling edge. A file using syntax newer than the pinned grammar understands is reported the same way.
