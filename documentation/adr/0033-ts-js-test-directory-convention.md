# 0033: TS/JS test files are also recognized by `test/`, `tests/`, and `__tests__/` directories

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md) • [Back to USER_GUIDE.md](../USER_GUIDE.md)

## Status

Accepted. Amends ADR-0010 and ADR-0011's definition of a TS/JS test file.

## Context

ADR-0010 and ADR-0011 defined a TS/JS test file by filename alone: `*.test.*`/`*.spec.*`. Many JS projects (AVA, Mocha, and Jest's `__tests__` layout) keep tests in a directory with ordinary file names instead, for example execa's `test/methods/create.js`. Those files were treated as product code: included by default, clustered into domain Modules, and distorting them.

## Decision

`isTestFile` (`src/core/test-file.ts`) also matches a `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs` file (and its `.d.ts` form) anywhere under a directory named `test`, `tests`, or `__tests__`, at any depth. The rule is restricted to JS/TS extensions, the same way Rust's `tests/*.rs` rule is restricted to `.rs`, so a same-named directory in another language's part of a polyglot repo is unaffected.

Every consumer of `isTestFile` inherits the rule: discovery-time exclusion (ADR-0011), the `tests` Module bucket (ADR-0010), module naming, and Go's import filter.

## Consequences

- A real source directory named `test/` is excluded by default. A test-utilities package whose product code lives in `src/test/index.ts` disappears from the map unless `--include-tests`/`includeTests: true` is passed.
- `--include-tests` restores those files, bucketed into the `tests` Module.
