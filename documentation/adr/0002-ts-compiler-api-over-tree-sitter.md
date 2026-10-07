# 0002: TypeScript Compiler API chosen over tree-sitter/LSP for the TS/JS milestone

[Back to 0027-tree-sitter-multi-language-extraction.md](0027-tree-sitter-multi-language-extraction.md) • [Back to documentation/adr/README.md](README.md) • [Back to HLD.md](../HLD.md)

## Status

Accepted

## Context

The generator's longer-term vision is language-agnostic (TS/JS, Python, Java, Go, Rust), which points toward a generic structural parser like tree-sitter (broad grammar coverage, one extraction approach reused across languages) with an optional LSP-based enrichment layer for higher-fidelity symbols. The target is TS/JS only, and TypeScript ships its own compiler API (`typescript` on npm) with full type-checked AST access - a tool built specifically for this one language, more accurate than tree-sitter's name-based heuristic matching, and requiring no separate LSP process to get semantic information.

## Decision

Extraction layer uses the TypeScript Compiler API directly, not tree-sitter and not an external LSP server. Adopting tree-sitter now would only pay off once a second language is actually being added - for a single-language milestone it's strictly extra indirection for the same or lower fidelity.

## Consequences

- It gets type-checked, high-fidelity symbol and call extraction "for free," without integrating a separate parser toolchain.
- The parser Factory seam (ADR-pending / see architecture-skeleton ticket) still needs to be designed so a tree-sitter- or LSP-based implementation can be registered later for other languages, since this decision only fixes *which* parser ships with, not the extension point.
- This means extraction code is TypeScript-specific and cannot be reused as-is for the next language; the multi-language follow-on map will need its own extraction strategy decision, informed by whatever tree-sitter/LSP tradeoffs look like at that time.

## Update

Status: Accepted, amended. Supersedes this ADR's Context/Decision text wherever it describes classic, in-process `ts.Program`/`ts.TypeChecker` access (including `ts.resolveModuleName` for import resolution) - `TsCompilerApiParser` (`src/extraction/ts-compiler-api/ts-compiler-api-parser.ts`) does not use that API at all.

**What changed.** The implementation is built on `typescript@7`'s `unstable/sync` and `unstable/ast` subpaths instead. That package's root export is only a version stub: there is no classic `ts.createProgram`, no in-process synchronous `TypeChecker`, and therefore no `ts.resolveModuleName`. The real compiler is exposed only under `unstable/*`, backed by a spawned native process that the `sync` API's `API`/`Snapshot`/`Project` types talk to over a synchronous IPC channel per parse call; `unstable/ast` is the separate pure-syntax half (no process, no type information), used here for syntactic node classification. Import resolution instead goes through `checker.getSymbolAtLocation` on the specifier's string-literal node, which resolves it exactly the way the spawned process's program already resolved the import (including through pnpm-style workspace symlinks), rather than through a classic `ts.resolveModuleName` call this API does not expose.

**Why this wasn't caught up front.** This ADR's original Decision assumed "TypeScript ships its own compiler API... with full type-checked AST access" meant the classic synchronous, in-process API most tooling documents. That assumption held for every `typescript` major version prior to 7; it stopped holding once `typescript@7` shipped with the classic Program/TypeChecker surface removed from its public entrypoint. The gap was only discovered while implementing extraction, not during this ADR's original research.

**Consequences of the pivot:**

- Every extraction call now spawns and tears down a native process (`API`/`Snapshot` lifecycle in `TsCompilerApiParser.parse`) rather than staying purely in-process - a cost and a failure mode (process spawn, IPC) this ADR's original Consequences section didn't anticipate.
- The "one `ts.Program` for the whole repo" whole-program design this ADR's sibling decisions rely on (documentation/adr/0003, documentation/adr/0005) is preserved: `unstable/sync`'s `Project` still yields one Program-equivalent shared across every extracted file in a `parse()` call. The pivot changes *how* that access is obtained, not the whole-program shape itself.
- **Known limitation surfaced by this pivot's review, left undecided:** `src/discovery/filesystem/filesystem-discovery.ts`'s walk only assigns a file to `programFiles`/`fileOwners` when it has a resolvable ancestor `package.json` (a non-null `packageId`). A file with no ancestor manifest anywhere above it - an unmanaged `rootDir`, or a manifest-less subtree - is silently invisible to the structural tree and never reaches the parser at all. This ADR does not specifies what should happen in that case (a synthetic fallback package, an error, or the current silent-skip behavior), so no fix was guessed at here; see the comment directly above the gate in `filesystem-discovery.ts` for where this is enforced.

## Update: manifest-less-file gap resolved

**Options considered:**

- **Silent drop (status quo):** keep the file invisible with no warning at all. Rejected - a developer has no way to discover the file was ever seen and dropped, let alone why.
- **Synthetic Package node:** invent a fallback `PackageNode` (e.g. keyed by `rootDir` itself) to own manifest-less files so they still appear in the structural tree. Rejected - it would break the Cluster hierarchy's exact "Package = one per real `package.json` manifest" definition (`CONTEXT.md`) for a node that corresponds to no real manifest at all, and no fixture or spec ever asked for that structural-tree change.
- **Warn-and-skip:** keep the file excluded from `programFiles`/`fileOwners` exactly as today (no structural-tree change, no synthetic node), but surface its exclusion as a warning distinguishable from the unparseable-file warning. **Chosen** - it closes the actual gap (a developer now finds out the file was dropped and why) with the smallest possible change, reusing the exact warning-surfacing mechanism ticket 13 already established for the same purpose.

**Where the fix lives, and why:**

- `DiscoveredStructure` (`src/core/types.ts`) gains a `manifestlessFiles: string[]` field, populated by `FilesystemDiscovery`'s walk (`src/discovery/filesystem/filesystem-discovery.ts`) at the exact point a would-be-eligible file is found to have a null `packageId`. This lives in the Discovery seam - not the orchestrator - because only Discovery's walk knows, at the moment it's walking, which specific files it declined to place; reconstructing that after the fact from `programFiles` alone (e.g. by diffing against a separate full-tree walk) would duplicate the walk itself.
- The orchestrator (`createCodemapGenerator` in `src/core/generate-map.ts`) turns each of `structure.manifestlessFiles` into one `Skipped manifest-less file: <path>` warning, appended to the same `warnings: string[]` surface the unparseable-file policy already returns on - worded distinctly (`manifest-less` vs. `unparseable`) so a reader knows whether to fix a syntax error or add/relocate a `package.json`, without any new top-level field or `codemap.json` schema change at the time this decision was made - [ADR-0029](0029-json-envelope-warnings-field.md) later added `warnings` as a top-level `codemap.json` field carrying this same array.
- `filesystem-discovery.test.ts` covers the Discovery-seam half (a manifest-less file stays absent from `programFiles`/`fileOwners` but appears in `manifestlessFiles`); `generate-map.test.ts` covers the orchestrator half (a Discovery-reported manifest-less file becomes the correctly-worded warning) - mirroring ticket 13's own two-layer testing shape.

## Update: the deferred second-language decision

This ADR's Consequences section named the still-open question directly: "the multi-language follow-on map will need its own extraction strategy decision, informed by whatever tree-sitter/LSP tradeoffs look like at that time." [ADR-0027](0027-tree-sitter-multi-language-extraction.md) is that decision - tree-sitter for Go/Rust/Java, deliberately at lower (syntactic-only) fidelity than this ADR's TS/JS Compiler API approach, not an attempt to match it. This ADR's own scope (TS/JS via the Compiler API) is otherwise untouched.
