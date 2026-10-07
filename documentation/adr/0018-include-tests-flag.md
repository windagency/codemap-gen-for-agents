# 0018: `includeTests` flag closes a gap in the incremental-caching and public-interface specs

[Back to 0004-public-interface-contract.md](0004-public-interface-contract.md) • [Back to documentation/adr/README.md](README.md)

## Status

Accepted. Reconciles `codemap-incremental-caching/spec.md`'s Epoch definition and `codemap-public-interface/spec.md`'s `GenerateInput`/`ReadInput` shapes with the `includeTests` flag ADR-0011 already decided; amends documentation/adr/0005's three-input epoch and documentation/adr/0004's `GenerateInput`/`ReadInput` shapes, as restated in those two specs.

## Context

ADR-0011 decided that test files (`*.test.<ext>`/`*.spec.<ext>`, ADR-0010's convention) are excluded from discovery by default, and that this is controlled by a public `--include-tests`/`includeTests` flag threaded through every CLI/MCP/Skill surface via the shared `GenerateCommandInput`/`ReadCommandInput` contract. That ADR also already stated the flag "changes the file set handed to `Parser`'s TypeScript program the same way an `exclude` pattern change does, so it's now part of the incremental-cache epoch (`computeEpoch`, documentation/adr/0005) alongside the generator version, tsconfig content, and exclude patterns."

The two specs that actually own those shapes in build-ready form were never mechanically updated to match. `codemap-incremental-caching/spec.md`'s Epoch section still names only three inputs (generator version, resolved tsconfig compilerOptions, exclude patterns), and `codemap-public-interface/spec.md`'s `GenerateInput`/`ReadInput` interface listings don't mention `includeTests` at all. The implementation is correct - `computeEpoch` takes four arguments (`src/core/cache/extraction-cache.ts`), and `includeTests?: boolean` is a real field on both `GenerateCommandInput` and `ReadCommandInput` - but two ticket checklists ended up checked against spec text that no longer describes what shipped: `codemap-incremental-caching` ticket 01's epoch acceptance criteria enumerate only the original three inputs, and `codemap-public-interface` tickets 02/03 check "no query/filter flags... added" and "shapes exactly as specified" against the old three-field `GenerateInput`/`ReadInput`. Both statements were true relative to the spec text at hand, not because the extra field doesn't exist in the real system.

## Decision

`includeTests` is confirmed a deliberate, permanent fourth input to the cache epoch and a permanent field on `GenerateInput`/`ReadInput`, not scope creep to be trimmed back:

- **Epoch**: `computeEpoch(generatorVersion, tsconfigCompilerOptions, excludePatterns, includeTests)`. A flip of the flag must invalidate the cache, because it changes the file set `Parser`'s `ts.Program` is built over and extracts from, exactly as an `exclude` pattern change does. Excluding it from the epoch would let a `--include-tests` run reuse a cache computed without test files (or vice versa), silently serving a map that doesn't match the flag it was requested with.
- **Public shapes**: `GenerateInput`/`ReadInput` (and their CLI/Skill equivalents) both carry `includeTests?: boolean`, default `false` - additive and backward compatible, matching every caller's pre-existing behavior when the flag is omitted.

This ADR makes no behavioural change. It amends `codemap-incremental-caching/spec.md` and `codemap-public-interface/spec.md` to say what ADR-0011 already decided and what the shipped code already does, and annotates the tickets whose checklists read as if the field doesn't exist.

## Consequences

- `codemap-incremental-caching/spec.md`'s Epoch description now lists four inputs, matching `computeEpoch`'s real signature.
- `codemap-public-interface/spec.md`'s `GenerateInput`/`ReadInput` listings now include `includeTests?: boolean`.
- `codemap-incremental-caching` ticket 01 and `codemap-public-interface` tickets 02/03 each get an annotation next to the now-stale-looking checklist line, pointing here, rather than an unchecked box - the criteria were satisfied against the spec as it stood at the time; this ADR is what makes the spec catch up to the code.
