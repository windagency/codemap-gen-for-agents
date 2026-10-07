# 0044: Exclude globs match underneath a hidden ancestor directory too

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Fixes a latent gap in every exclude pattern this generator has ever shipped
(`src/core/config.ts`'s `DEFAULT_EXCLUDE`, present unchanged since before ADR numbering started) -
not a new policy, a correction to what the existing one was always supposed to do.

## Context

Running the generator against a separate, real, large monorepo (`valora`) produced a Module literally
named `.pnpm-store`, and a second Module whose files were entirely duplicate copies of the project's
own `src/` tree under `.stryker-tmp/sandbox-<id>/`. Both directories are build/tooling artifacts, not
source: `.pnpm-store` is pnpm's local content-addressable package store (observed contents: a vendored
`node-gyp`'s Python internals, reached through `.pnpm-store/v11/links/@/pnpm/<version>/<hash>/node_modules/pnpm/dist/node_modules/node-gyp/...`); `.stryker-tmp/sandbox-*/` is Stryker's mutation-testing
sandbox, a full working copy of the project (`dist/`, `node_modules/`, and a second complete `src/`
alike) that Stryker creates per run and normally deletes afterward.

Traced directly: `PicomatchGlobMatcher` called `picomatch(patterns)` with no options, and picomatch's
default `dot: false` stops a leading `*`/`**` segment from matching into *any* dot-prefixed directory
at all, anywhere in the matched path - not just the common "don't let a glob silently sweep up
`.git/`" case the option exists for. Confirmed directly: `picomatch(["**/node_modules/**"])` matches
`"node_modules/x"` and `"a/node_modules/x"` but not `".pnpm-store/.../node_modules/x"` or
`".stryker-tmp/sandbox/node_modules/x"` - the exact same literal `node_modules` segment, at the exact
same effective depth, excluded or not purely depending on whether something hidden happens to sit
above it. `**/dist/**` behaves identically for `.stryker-tmp/sandbox/dist/`.

This is never the behavior `DEFAULT_EXCLUDE`'s authors intended - nothing in `config.ts`,
`documentation/LLD.md`, or any ADR ever discusses dotfile-glob semantics, because a repo-relative path
Discovery already walked has nothing to do with the shell/editor convention `dot: false` exists to
protect (a human typing `*.ts` not expecting it to also match `.hidden.ts`). Every pattern in this
list was written to mean "anywhere in the tree," and silently meant "anywhere in the tree, except
behind a hidden directory" instead.

## Decision

`PicomatchGlobMatcher` (`src/discovery/filesystem/picomatch-glob-matcher.ts`) now calls
`picomatch(patterns, { dot: true })`. This applies uniformly: every existing default pattern
(`**/node_modules/**`, `**/dist/**`, `**/build/**`, `**/coverage/**`, `**/target/**`, `**/vendor/**`)
and any user-supplied `exclude` pattern in `codemap.config.json` now matches underneath a hidden
ancestor directory exactly as it already matched underneath a visible one.

Separately, `DEFAULT_EXCLUDE` (`src/core/config.ts`) gains two new entries found by this
investigation: `**/.stryker-tmp/**` and `**/.pnpm-store/**`. These are whole-directory exclusions,
not sub-pattern matches - `.stryker-tmp`'s sandbox copy includes plain source files
(`eslint.config.js`, a duplicated `packages/*/src/*.ts`) that don't sit under a `dist/`,
`node_modules/`, or any other already-excluded subdirectory name, so the `dot: true` fix alone
doesn't reach them; the sandbox directory itself has to be named.

## Consequences

- Measured on `valora`: total discovered files dropped from 2,468 to 1,074 (more than halved) -
  `.stryker-tmp`'s duplicate project copy and `.pnpm-store`'s vendored dependency code are both
  gone. The `.pnpm-store` Module and the single largest Module in the entire map (412 files, an
  unreadable ~20-segment interpolated name entirely made of `.stryker-tmp/sandbox-*/src/` files) no
  longer exist. Total graph node count dropped from 28,725 to 13,853.
- `filesystem-discovery.test.ts` gained a regression test: a `node_modules/**`/`dist/**`-excluded
  tree with a `.stryker-tmp/sandbox-.../` prefix in front of both, asserting discovery still prunes
  them - the exact shape that exposed this gap, not a synthetic one-off. `config.test.ts`'s two
  exact-list assertions of `DEFAULT_EXCLUDE` are updated for the two new entries.
- `documentation/LLD.md` and `documentation/USER_GUIDE.md` are updated to list the two new default
  patterns and note that every exclude pattern (built-in or user-supplied) now matches underneath a
  hidden ancestor directory, not just a visible one.
- This is a pure bug fix with no new false-positive risk discovered: `dot: true` only *widens* what
  an existing pattern can match (into previously-missed hidden-directory cases); it cannot narrow
  what already matched a visible path, since every segment comparison is otherwise unchanged. A
  literal directory named to collide with a pattern (e.g. a genuine source folder named `dist/`) was
  already excluded before this change and still is now - this decision doesn't alter that trade-off,
  only closes the hidden-ancestor gap around it.
- `valora` still has at least one large (~378-file) Module with a long interpolated composite name
  (`cli+ui+utils+executor+types+mcp+...`), now confirmed to be genuine source - the whole
  application's `src/` tree, which Louvain groups as one community with no common ancestor closer
  than `src` itself. This is a real instance of the "unreadably long interpolated name" case
  documentation/adr/0009 flagged as unresolved ("revisit if a real codebase produces one in practice") - distinct
  from this decision's data-pollution fix, and not addressed here.
