# 0004: Public interface contract - CLI, MCP tools, config discovery, and the Skill

[Back to 0056-scip-index-resolution-for-tree-sitter-languages.md](0056-scip-index-resolution-for-tree-sitter-languages.md) • [Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Amended by [documentation/adr/0018-include-tests-flag.md](0018-include-tests-flag.md), which adds `includeTests` to `GenerateInput`/`ReadInput` below, and by [documentation/adr/0019-json-envelope-modules-field.md](0019-json-envelope-modules-field.md), which adds a `modules` field to the JSON output this contract's `generate`/`read` tools ultimately produce. Kept for the historical record of the original contract shape; the `GenerateInput`/`ReadInput` listings below no longer match what's shipped on their own - see those two ADRs for the current fields.

## Context

Ticket 05 needed to fix the exact shape of every surface an outside caller touches: the MCP server's `generate`/`read` tools, the CLI's flags, the config file's filename/format/schema, and how the Skill actually invokes the shared core - the last of these already flagged as unresolved in ADR-0003's own Consequences ("Ticket 05 must design the Skill's contract as its own adapter surface... not as documentation routing an agent between the CLI and MCP tools").

Three complications surfaced while grilling this ticket:

- The generator can be installed at project, user, or global scope. A naive "the config file's own directory is the analyzed repo's root" rule breaks the moment the config isn't sitting inside the repo being mapped (a global install run from an arbitrary directory), so `rootDir` and "where are my settings" had to be resolved independently rather than assuming one implies the other.
- An MCP `read` call has no guarantee a `generate` call happened first, or that the on-disk map isn't stale relative to the repo's current files. Requiring the caller to sequence `generate` then `read` manually is a foot-gun; `read` needed its own freshness story.
- ADR-0003 already settled that `SkillAdapter` is a peer of `CliAdapter`/`McpAdapter`, calling core directly rather than delegating - but "calling core directly" needed a concrete mechanism, since a Claude Code Skill is fundamentally prose (`SKILL.md`) plus, optionally, scripts it tells Claude to run.

## Decision

**`rootDir` and config discovery are decoupled.** `rootDir` defaults to `process.cwd()`, overridable only via CLI `--root <dir>` / MCP `rootDir` param - never inferred from wherever `codemap.config.json` is found. Config discovery is a flat, non-walking lookup: `<rootDir>/codemap.config.json`, or an explicit `--config`/`configPath` override; no upward directory search, no user-level or global fallback location. The config schema itself carries no `rootDir` field, to avoid two competing sources of truth for the same concept:

```ts
interface CodemapConfig {
  outDir?: string;    // default ".codemap/"
  exclude?: string[]; // glob patterns, layered on the always-applied default excludes
}
```

**The CLI is generate-only:**

```
codemap generate [--root <dir>] [--out <dir>] [--config <path>] [--force]
```

No query/filter subcommand - that would triplicate filter logic already needed for the MCP `read` tool and the HTML's client-side Filter UI.

**The MCP tools:**

```ts
interface GenerateInput { rootDir?: string; configPath?: string; outDir?: string; force?: boolean; }
interface GenerateOutput { jsonPath: string; htmlPath: string; nodeCount: number; edgeCount: number; }

interface ReadInput {
  rootDir?: string; configPath?: string; outDir?: string;
  path?: string;                          // prefix/subtree match
  symbolKind?: SymbolNode["symbolKind"];
  search?: string;
}
interface ReadOutput { nodes: Node[]; edges: Edge[]; }
```

`generate` returns paths and a count summary, never the graph inline, so a large map never has to cross the tool-call response. `read` self-heals - it always re-runs ticket 06's incremental pipeline before filtering, which is why it needs the same location params as `generate`. Multiple `read` filters AND together; `path` matches by prefix/subtree; the response includes each match's ancestor Cluster chain (File/Directory/Package) for navigability, plus edges already fully inside the resulting node set - not a full induced subgraph over every edge touching a match.

**The Skill ships a companion script**, not prose over the CLI. It calls `core/compose.ts`'s `createDefaultPipeline()` directly, exposes the same `generate`/`read` subcommands and flags as the CLI, and prints one JSON object to stdout matching the corresponding MCP tool's return shape. `SKILL.md` instructs Claude to run it and parse stdout - one contract shape shared across all three adapters instead of three that can drift independently.

## Consequences

- Ticket 07's spec assembly can lift these signatures verbatim; nothing here is speculative or deferred.
- A future second parser/output-format Factory registration (ADR-0003) doesn't touch this contract at all - it's a pure `core`-internal concern.
- If a second config-file location is ever needed (e.g. per-package overrides in a monorepo), that's a breaking change to the "flat, non-walking lookup" rule above and needs its own decision record, not a silent addition.
- The Skill's companion script and the CLI now need to be kept in sync deliberately (same flags, same subcommands) - an `arch-unit-ts`-style test asserting their argument parsing matches is worth adding when both exist.
