# 0011: Test files are excluded from the codemap by default

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md) • [Back to USER_GUIDE.md](../USER_GUIDE.md) • [Back to SKILL.md](../../src/integration/skill/SKILL.md)

## Status

Accepted.

## Context

ADR-0010 stops test files from distorting domain clustering, but it does so *after* discovery: a test file is still walked, parsed, and present in the graph as an ordinary File node - it's only pulled out at the clustering step and bucketed into one dedicated `tests` Module. For an AI coding agent consuming the map JSON as context, that File node (and every Symbol under it) is still there, costing context budget for a file that, for most "understand this codebase's structure" tasks, isn't what the agent is looking for.

## Decision

`--include-tests` (CLI/Skill flag) / `includeTests` (MCP tool input, `GenerateCommandInput`/`ReadCommandInput`) defaults to `false`. When false, test files (the same filename convention as ADR-0010: `*.test.<ext>`/`*.spec.<ext>`) are excluded at discovery time - `FilesystemDiscovery` never adds them to `programFiles`, the same way an excluded directory or an ineligible extension never is. A directory containing only test files never materializes as a Directory node either, for the same reason an excluded directory doesn't: `WalkResult.hasFile` only tracks files that actually made it into `programFiles`.

The two convention checks (ADR-0010's clustering-time bucket, this ADR's discovery-time exclusion) must agree on what a "test file" is, or a file could be invisible to one but not the other. They're now one shared function, `isTestFile` in `src/core/test-file.ts`, imported by both `FilesystemDiscovery` and `LouvainModuleDetector`/`deriveModuleNames` - a Shared Kernel (`CODING_RULES/12-domain-duplication-audit.md`) rather than three independent copies of the same regex.

A practical consequence: with the default false, ADR-0010's clustering-time exclusion and `tests`-Module bucketing only ever has test files to act on when `--include-tests`/`includeTests: true` was explicitly passed. ADR-0010 isn't superseded - it's still exactly what happens once test files are visible at all.

`--include-tests` changes the file set handed to `Parser`'s TypeScript program the same way an `exclude` pattern change does, so it's now part of the incremental-cache epoch (`computeEpoch`, documentation/adr/0005) alongside the generator version, tsconfig content, and exclude patterns - flipping it forces a full re-extraction rather than serving stale cached symbols computed against a different file set.

## Consequences

- Every CLI (`generate`), MCP (`generate`/`read`), and Skill (`generate`/`read`) surface exposes the same `--include-tests`/`includeTests` option, threaded through the one shared `GenerateCommandInput`/`ReadCommandInput`/`GenerateMapOptions` contract - no surface can drift from another on this.
- Running the generator on its own codebase with no flag no longer produces the `tests` Module at all (no test File nodes exist to bucket); passing `--include-tests` restores exactly the ADR-0010 behavior.
- `Discovery.discover`'s signature gained an optional third parameter (`includeTests`); the single real implementation (`FilesystemDiscovery`) and every test fake in `generate-map.test.ts` remain valid, since none of them need to pass it to keep their previous (default-false) behavior.

## Update

ADR-0033 extends the TS/JS test-file convention with `test/`, `tests/`, and `__tests__/` directories. The shared `isTestFile` function carries it, so this decision's behavior applies to those files too.
