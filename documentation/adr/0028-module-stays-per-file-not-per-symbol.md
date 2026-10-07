# 0028: Module stays a per-File label, even for Rust's per-Symbol inline test items

[Back to documentation/adr/README.md](README.md)

## Status

Accepted

## Context

[ADR-0010](0010-test-files-are-their-own-module.md) established that a test file's domain is "testing," not whatever domain its production sibling files belong to - implemented as a per-*File* label, since TS/JS's test convention (`*.test.ts`/`*.spec.ts`) is itself file-granularity. Go and Java's own test conventions (`_test.go`; `src/test/`/`*Test.java`) are also file-granularity, so they fit that existing model unchanged.

Rust's inline test convention doesn't: a `#[test]`-attributed function or a `#[cfg(test)]`-tagged `mod tests { ... }` block lives inside an otherwise-ordinary production file, at Symbol (item) granularity, not file granularity. That ticket's design flagged a genuine fork here: should an included (`--include-tests`) inline test item get ADR-0010's "testing is its own domain" treatment - which would require Module becoming a per-*Symbol* assignment, at least for this one case - or should it simply inherit its containing file's ordinary domain Module, leaving Module a strictly per-File label exactly as documented today?

## Decision

Module stays a per-File label, unconditionally - `CONTEXT.md`'s existing definition is preserved unchanged, `ModuleDetector`'s interface and implementation are untouched, and the JSON schema gains no per-Symbol Module field. A Rust inline test item revealed by `--include-tests` inherits its containing file's ordinary domain Module, the same as every other Symbol in that file - it does *not* get bucketed into the shared `tests` Module the way a whole test *file* does under ADR-0010.

This was resolved in favor of the smaller blast radius: extending Module to per-Symbol granularity for the sake of one language's one inline-test convention would ripple into `ModuleDetector`'s interface, the JSON schema, the HTML client's own per-File Module-coloring/legend logic, and every existing consumer's "one Module per File" assumption - a structural change to the domain model, not a Rust-specific extraction detail.

## Consequences

- A `--include-tests` run on a Rust file containing an inline `#[cfg(test)] mod tests { ... }` shows that module's functions grouped into whatever domain Module the rest of the file belongs to, not a `tests` Module - a real, disclosed fidelity gap relative to ADR-0010's "a test's domain is testing" principle, scoped specifically to Rust's inline convention (Rust's own *file*-level integration-test convention, `tests/*.rs`, gets the full ADR-0010 treatment unchanged, since that one is file-granularity).
- Where this is enforced: the item-granularity test-hiding logic itself lives in `generate-map.ts`'s `stripHiddenTestItems`, which runs *before* `GraphBuilder`/`ModuleDetector` ever see the symbols - the orchestrator's own seam, not "inside Rust's own Parser" the way Go/Java/TS's file-granularity exclusion sits inside Discovery. This was the one seam available without changing `Parser.parse`'s fixed three-argument signature: the Rust Parser has no way to know `--include-tests` at all (that flag reaches `Discovery.discover` and `generate-map.ts` directly, never `Parser`), so it always emits every item, tagged; the orchestrator is the first point downstream that both knows the flag and hasn't yet handed anything to `GraphBuilder`/`ModuleDetector`. Either way, a stripped-then-revealed Symbol was never treated as anything other than an ordinary member of its file for clustering purposes.
- A future maintainer extending Module to per-Symbol granularity for some other reason should revisit this decision's tradeoff explicitly, rather than assume today's per-File model is load-bearing for a reason unrelated to this one.
