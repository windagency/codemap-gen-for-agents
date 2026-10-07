# 0010: Test files are excluded from domain clustering and bucketed into one dedicated Module

[Back to 0009-interpolated-module-names.md](0009-interpolated-module-names.md) • [Back to 0028-module-stays-per-file-not-per-symbol.md](0028-module-stays-per-file-not-per-symbol.md) • [Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md) • [Back to USER_GUIDE.md](../USER_GUIDE.md) • [Back to SKILL.md](../../src/integration/skill/SKILL.md)

## Status

Accepted.

## Context

A file's Module is meant to be its domain - the bounded context it belongs to (`CONTEXT.md`). A test file's import edges mostly point at the thing it tests, so treating it as an ordinary node in the import graph makes it cluster with (and get named after) whatever it happens to test, or drag unrelated domains together when a broader test (e.g. a golden-file/integration test) imports across several of them. Running the generator on its own codebase surfaced exactly this: a single stray integration test file pulled into an otherwise-clean `core` community forced its name to interpolate to `core+__tests__` (documentation/adr/0009) - a test file was, structurally, distorting a production domain's identity.

A test file's own domain is "testing", not whatever it happens to import. That's a real, consistent property of every test file in the codebase, independent of folder location or which production files it touches.

## Decision

`LouvainModuleDetector` (`src/clustering/louvain/louvain-module-detector.ts`) now identifies test files by convention - filename matching `\.(test|spec)\.<ext>` - and excludes them from the import graph handed to Louvain entirely, the same way External nodes are already excluded. Every identified test file is then unconditionally assigned to one dedicated Module, shared across the whole codebase regardless of folder or which production files it imports. This bucket bypasses the usual `MIN_COMMUNITY_SIZE`/`MIN_EMBEDDEDNESS`/degenerate-partition checks - those measure confidence in an algorithmically-discovered grouping, and this one isn't discovered, it's asserted by convention, the same way ADR-0006/0008/0009's naming rules are.

`deriveModuleNames` (`src/clustering/module-naming.ts`) mirrors the same test-file convention: a Module whose files are *all* test files is named `"tests"` directly, bypassing the folder-derived/interpolated naming rules - its identity comes from the convention, not from where its files happen to live.

## Consequences

- Running the generator on its own codebase, the Module previously named `core+__tests__` is now cleanly `core` (8 files), and a new `tests` Module (26 files, every `*.test.ts` in the repo) appears alongside it.
- Real side effect, not a bug: removing test files from the import graph also removes the edges they contributed. Two small production slices (`integration/cli/{main,cli-adapter}.ts` and `integration/skill/{main,skill-adapter}.ts`) previously reached `MIN_COMMUNITY_SIZE` (3) only by counting their own colocated test file; with test files excluded, each is left with 2 production files and now falls below the floor, becoming `undersized`/unassigned rather than a named Module. This is judged correct rather than a regression: a domain's confidence shouldn't be propped up by its test file's mere presence, but it does mean very thin production slices (adapter + entry point, no other collaborators) may now show less clustering granularity than before.
- Determinism is preserved: whether a file is a test file is a pure function of its own id, computed the same way on every run.
- The reserved test-Module id is computed as one past the highest real community id Louvain returns, so it never collides with a real community.

## Update

ADR-0033 extends the TS/JS test-file convention with `test/`, `tests/`, and `__tests__/` directories. The shared `isTestFile` function carries it, so this decision's behavior applies to those files too.
