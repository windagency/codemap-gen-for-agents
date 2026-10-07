# 0045: Discovery always follows the project's own root `.gitignore`

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Adds a second, independent source of exclusions alongside `DEFAULT_EXCLUDE` and
`codemap.config.json`'s `exclude` (documentation/adr/0044) - neither replaces the other.

## Context

documentation/adr/0044 fixed two confirmed data-pollution bugs on a real, large monorepo (`valora`) by hand-adding
`**/.stryker-tmp/**` and `**/.pnpm-store/**` to `DEFAULT_EXCLUDE`, on top of a glob-matcher bug fix.
Checked directly afterward: `valora`'s own `.gitignore` already listed `node_modules/`,
`.pnpm-store`, `dist/`, and `.stryker-tmp/` - every directory that investigation spent real effort
discovering by hand, one at a time, was already named by the project's own maintainers, in the one
file whose entire purpose is exactly that list.

`DEFAULT_EXCLUDE` is, and will always be, a fixed, hand-maintained guess at the common cases
(`node_modules`, `dist`, `build`, `coverage`, build-tool-specific directories as they're
discovered). It can never be complete - every real project accumulates its own tool-specific,
machine-generated, or vendored directories that a generic list can't anticipate, and the only
previous way to close a gap was a human noticing a bad Module name, tracing it back to a stray
directory, and hand-adding one more pattern. The project's `.gitignore` is a far more complete and
self-maintaining source for the same information: the project's own maintainers already enumerated
exactly what isn't "their code" for an unrelated, orthogonal reason (keeping it out of version
control), and that list updates itself as the project adopts new tooling, with no action needed
from this generator at all.

## Decision

`GitignoreMatcher` (`src/discovery/filesystem/gitignore-matcher.ts`) wraps the `ignore` package
(the same Adapter pattern `PicomatchGlobMatcher` already uses for picomatch,
CODING_RULES/04-architecture.md) behind the existing `GlobMatcher` interface. It reads
`<rootDir>/.gitignore` once at construction - a flat, non-walking lookup, the same convention
`config.ts`'s `loadConfig` already uses for `codemap.config.json` (documentation/adr/0004): only the root
`.gitignore`, no per-directory nested ones, no upward search. A missing file degrades to "nothing
additionally excluded," the same way a missing `codemap.config.json` degrades to built-in defaults,
rather than throwing.

`FilesystemDiscovery.discover`'s exclude matcher now consults three sources, a file excluded by any
one of them: `DEFAULT_EXCLUDE`, `codemap.config.json`'s own `exclude`, and the project's root
`.gitignore`. None of the three replaces another - `DEFAULT_EXCLUDE` still matters for a project
with no `.gitignore` at all (an extracted snapshot, a non-git-tracked directory), and
`codemap.config.json`'s `exclude` still matters for excluding something the project's own
`.gitignore` has no reason to mention (e.g. a subtree that *is* committed to git but the generator's
caller still wants left out of the map).

A directory-only `.gitignore` pattern (a trailing `/`, e.g. `dist/`) only matches a pathname that
itself ends in `/` as far as the `ignore` package is concerned - it has no independent way to tell a
directory entry from a file one, since both arrive as the same plain relative-path string.
`GitignoreMatcher.isMatch` checks both the bare path and the path with a trailing `/` appended, so a
bare directory entry (`"dist"`, checked during the walk before descending into it) is correctly
pruned - matching real git semantics - without requiring `FilesystemDiscovery`'s walk loop to thread
"is this a directory" through the shared `GlobMatcher` interface. This is the same tolerance
`PicomatchGlobMatcher`'s own bare-directory workaround already accepts: every pattern is checked
against every entry regardless of its actual file-vs-directory type.

## Consequences

- Measured on `valora`: identical file count (539) to documentation/adr/0044's hand-fixed result - the
  project's own `.gitignore` already covered both directories that investigation found by hand, for
  free, with no generator-side pattern list needing to grow to match. The two new `DEFAULT_EXCLUDE`
  entries from documentation/adr/0044 are kept, not removed - they're the fallback for a project with no
  `.gitignore` to consult at all.
- `ignore` (MIT, `7.0.11`) is a new production dependency - `THIRD_PARTY_LICENSES.md` regenerated
  and passes the permissive-license allowlist (`licenses:check`).
- `filesystem-discovery.test.ts` gained four tests: gitignore-only exclusion with no `exclude`
  config at all, gitignore combined with `exclude` (either excludes), a missing `.gitignore`
  degrading cleanly, and - mirroring the existing picomatch-specific case one test above it -
  pruning descent into a `.gitignore`-excluded directory entirely (a `package.json` placed one
  level inside it proves the walk never entered, not just that files found there were filtered
  out).
- Scope is deliberately root-only, matching documentation/adr/0004's existing `codemap.config.json` convention:
  a nested `packages/some-pkg/.gitignore` with package-specific rules isn't consulted. Accepted as a
  known limitation, not an oversight - revisit if a real monorepo's nested `.gitignore` turns out to
  matter in practice, the same way documentation/adr/0004 left its own scope open to the same kind of
  revisit.
- This is additive only: a file that was excluded before this decision is still excluded (none of
  the three sources' contributions were removed), and a project with no `.gitignore` sees no
  behavior change at all. The only new effect is files that a project's own `.gitignore` already
  named, but that weren't in `DEFAULT_EXCLUDE` or the project's own `codemap.config.json`, are now
  excluded too.
