# 0019: JSON envelope gains a top-level `modules` field

[Back to 0004-public-interface-contract.md](0004-public-interface-contract.md) • [Back to documentation/adr/README.md](README.md)

## Status

Accepted. Amends `codemap-json-schema/spec.md`'s closed top-level envelope (`{ schemaVersion, nodes[], edges[] }`) to `{ schemaVersion, nodes[], edges[], modules[] }`.

## Context

`codemap-json-schema/spec.md` fixed the envelope with an explicit closed-world rule: "No other top-level keys - no `generatedAt` timestamp... and no generator-version or summary-count field (nothing currently needs them)." Each `FileNode` carries a `moduleId: number | null` - a bare integer, with no accompanying name anywhere else in the schema. That was a fine, minimal shape in isolation, but it left a real gap: nothing in `{ schemaVersion, nodes[], edges[] }` maps a `moduleId` back to a human-readable Module name. A consumer holding only the envelope can group Files by `moduleId`, but can never *label* a group.

That gap surfaced concretely once the HTML visualization needed to render Module names: `src/output/html/client-shell.ts` reads `rawData.modules` directly, building a `moduleNameById` lookup from it, because `GraphNode`s only ever carry the numeric id. There is no other field, node kind, or derivable value in the original envelope that supplies a name - the lookup table has to exist somewhere, and the only place a JSON consumer (HTML or otherwise) can find it is the envelope itself.

## Decision

`build-map-json.ts` adds a fourth top-level key, `modules: ModuleSummary[]` - an array of `{ id, name }` pairs, one per detected Module (derived via `deriveModuleNames`), serving as the id-to-name lookup table `FileNode.moduleId` needs in order to be useful to any consumer, not just the generator's own internals.

This amends `codemap-json-schema/spec.md`'s "no other top-level keys" rule: the envelope is now `{ schemaVersion, nodes[], edges[], modules[] }`. The rule's original reasoning is otherwise untouched - no `generatedAt` timestamp, no generator-version or summary-count field, since none of those are needed for repeatability or correctness. `modules` isn't a convenience or debug field; it's the one piece of information the schema's own `moduleId` design requires to be legible at all - an oversight in the original schema's field list, not new scope creep.

## Consequences

- `codemap-json-schema/spec.md`'s envelope section and its "no other top-level keys" sentence are corrected to name and describe the fourth key rather than forbid it.
- `codemap-json-schema` ticket 02's checklist line asserting "no extra top-level keys" is annotated (not unchecked) pointing here - it was correct against the schema as specified at the time this ticket shipped; the schema itself has since grown this field.
- Any future need for a per-node lookup should apply the same test this ADR uses: does the envelope already expose enough to compute it, or does it require a new top-level lookup table with nothing else supplying the same information. `modules[]` is the first, and as of this ADR the only, exception to the otherwise-closed envelope.
- `schemaVersion` is not bumped by this ADR - `modules[]` is a purely additive top-level key, and no existing field's name or type changed.
