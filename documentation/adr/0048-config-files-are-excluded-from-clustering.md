# 0048: Known build-tooling config files are excluded from clustering entirely

[Back to LLD.md](../LLD.md) • [Back to USER_GUIDE.md](../USER_GUIDE.md)

## Status

Accepted. Extends documentation/adr/0010's "pull a known file category out of clustering entirely, by
filename convention" precedent to a second category.

## Context

Running the generator against a separate, real, large monorepo (`valora`, 20 packages under
`packages/*` plus a root application package) produced a Module named `"packages"` containing nine
files: the root `eslint.config.js` and eight packages' own `eslint.config.js`, each importing the
root one directly (`import rootConfig from "../../eslint.config.js"`, ESLint flat-config's `extends`
pattern). None of these nine files has any other edge, to anything.

That shape - every leaf's only edge is to one shared hub - is a star graph. Modularity-based
community detection cannot split a star into more than one community: any partition other than "the
whole star together" scores lower, regardless of edge weight (documentation/adr/0007's folder-proximity
weighting doesn't apply here either, since the root config and a package's config share no directory
segment at all). `classify()` correctly measures these nine files as one fully-embedded,
appropriately-sized community - the algorithm is working exactly as designed. The defect is upstream
of it: nine independent, separately-versioned packages' lint boilerplate is not a domain, and `deriveModuleNames`
naming it `"packages"` (the literal shared path segment, stripped of anything more specific) actively
misleads - it reads as if the Module were about the workspace's package layout, not about shared lint
config reuse.

This is the same shape documentation/adr/0010 already solved once, for a different file category: test files
form their own cross-cutting pattern (one file per production file, named by convention) that isn't a
domain either, and participating in Louvain lets a test file's own import shape distort its subject's
community. The fix there was categorical exclusion by filename convention, not a weighting tweak -
the same answer applies here. A config/tooling file is identifiable the same way a test file is:
by a small, well-known set of filenames the JS/TS build-tooling ecosystem has effectively standardized
(`eslint.config.*`, `vitest.config.*`, `jest.config.*`, `babel.config.*`, and similar), not by any
property of the import graph.

The one thing this exclusion must not do is over-match: `"config"` is also an ordinary domain word.
`valora`'s own codebase has `src/config/providers.config.ts`, `src/mcp/mcp-server-config.schema.ts`,
and `packages/valora-plugin-obsidian/src/config.schema.ts` - all real product code, none of them
build tooling, despite the shared word. A pattern like `*.config.*` would silently pull real domain
files out of clustering. The fix is a closed, explicit list of recognized tool names immediately
before `.config.`, not a bare `config` substring match - the same discipline documentation/adr/0010's
`TEST_FILE_PATTERNS` already applies (specific filename/path conventions, never a loose substring).

## Decision

A new `isConfigFile` (`src/core/config-file.ts`), structured identically to `src/core/test-file.ts`:
a list of patterns matching a closed set of recognized JS/TS build-tooling config basenames
(`eslint`, `vite`, `vitest`, `jest`, `babel`, `webpack`, `rollup`, `postcss`, `tailwind`,
`commitlint`, `stylelint`, `prettier`, `playwright`, `cypress`, `stryker`, `lint-staged`, and a
handful of others in the same closed category) immediately followed by `.config.<ext>`, at any
directory depth, plus the equivalent `.<tool>rc.<ext>` dotfile convention for the handful of tools
that still default to it. Deliberately scoped to JS/TS extensions only, the same restriction
`isTestFile`'s own JS/TS-specific patterns already apply, since this is a JS/TS build-tooling
convention, not a cross-language one.

`LouvainModuleDetector` (`src/clustering/louvain/louvain-module-detector.ts`) treats a config file
exactly like a test file structurally, but with the opposite outcome: excluded from `fileIds` before
`buildImportGraph` runs (so it can never bridge two directories' - or two Packages' - communities
together the way the root `eslint.config.js` did), and assigned `{ moduleId: null, unassignedReason:
"config" }` directly in `detect()`'s node-mapping, bypassing `classify()` entirely rather than being
bucketed into a shared pseudo-Module the way test files are. A config file isn't one domain the way
"every test in the repo" was treated as one for documentation/adr/0010's purposes - there's no equivalent
reason to group an unrelated `eslint.config.js` and `vitest.config.ts` together under one name, so
each is simply left unassigned, the same outcome `classify()` already gives a config file with zero
other edges once a cross-package bridge no longer exists to weave it into something else's community.

`UnassignedReason` (`src/core/types.ts`) gains `"config"` as a fifth member, alongside `"isolated"`,
`"undersized"`, `"low-embeddedness"`, and `"degenerate-partition"` - a config file is excluded by
category before `classify()` ever runs, so it needs its own reason distinct from all four, which are
only ever produced by `classify()` or the reconciliation passes that follow it.

## Consequences

- Measured on `valora`: the `"packages"` Module (9 files, 2 Packages) disappears entirely. Each
  `eslint.config.js` is now `{ moduleId: null, unassignedReason: "config" }`, truthfully reporting
  "not a domain" instead of fabricating one.
- `src/core/config-file.ts`'s closed tool-name list is, like `TEST_FILE_PATTERNS`, not exhaustive of
  every build tool that will ever exist - a config file for an unrecognized tool still clusters
  normally (and, per documentation/adr/0049, can no longer bridge two Packages together regardless). Revisit by
  adding to the list, the same maintenance model `isTestFile` already has.
- Does not fix a cross-package merge between genuine source files (documentation/adr/0049 is the fix for that
  shape) - this decision only removes known non-domain tooling files from consideration, it doesn't
  constrain what real domain files may cluster with.
- `module-naming.ts` needs no change: a config file's `moduleId` is `null` from the moment it's
  produced, and `groupFileIdsByModuleId` already excludes every `null`-`moduleId` node from naming
  consideration, the same as any other unassigned file.
- `generate-map.ts`'s `logModuleAssignment` gains an `unassignedByReason` breakdown alongside its
  existing `assigned`/`unassigned` counts, keyed by whichever `UnassignedReason` values actually
  occurred that run - without it, a run where `"config"` quietly became a large share of
  `unassigned` would be indistinguishable in the logs from one dominated by `"low-embeddedness"` or
  `"isolated"`, two very different signals for whoever is reading them.
