# 0050: An overflowing Module's Package-name fallback is skipped when the Package owns other Modules

[Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows documentation/adr/0046's "too many children to interpolate -> fall back to the owning
Package's name" rule.

## Context

Running the generator against `valora` again after documentation/adr/0048 and documentation/adr/0049 (which removed two
other spurious Modules) left a Module literally named `"@windagency/valora"` - the repo's own root
application package. It held 83 files scattered across seven top-level directories directly under
the package's own `src/` (`cleanup/`, `cli/`, `config/`, `executor/`, `output/`, `session/`, `ui/`):
more than documentation/adr/0046's `MAX_INTERPOLATED_SEGMENTS` (4), so interpolation declined to join them and,
per documentation/adr/0046, fell back to the Module's owning Package's declared name instead.

That fallback is correct when a Package's own entrypoint files are the *only* Module it owns -
documentation/adr/0041's original motivating case (`raiminiscence-cli`, `raiminiscence-hooks`): a small package
with nothing nested below its `src/`, where the Package's name genuinely is a fair, specific
description of its one Module. It stops being honest the moment the same Package *also* owns several
other, separately and cleanly named Modules of its own - which is exactly `valora`'s root package's
situation: alongside this scattered 83-file Module, the same `"@windagency/valora"` Package already
owns upward of a dozen other Modules with their own clean, specific names (`security`, `services`,
`memory`, `ast`, and more, each settling normally at an earlier tier). Naming the leftover, scattered
Module after the Package it happens to share with all of those is not a "fair description that
happens to be broad" - it actively misrepresents one of many Modules as if it stood for the Package as
a whole, which is worse than admitting no good name was found: `CONTEXT.md`'s own words, "a derived
name that more than one Module lands on is... worse [than no name], it makes distinct Modules look
identical," apply just as much to a name that makes one scattered Module indistinguishable from "the
whole Package" as they do to two Modules sharing a literal string.

documentation/adr/0046 only ever needed to distinguish "nothing to interpolate" (zero child directories - the
small-package case) from a *successful* interpolation; both "zero children" and "too many children"
collapsed to the same `null` and were handled identically, since at the time there was no case on
record where that mattered. `valora`'s own root package is exactly that case: the owning-Package name
is the right fallback for "zero children," and the wrong one for "too many," but only when that
Package isn't this Module's sole claim to it.

## Decision

`interpolatedNameAt` (`src/clustering/module-naming.ts`) is split into `distinctChildSegments`
(the raw per-child-directory tally) and `joinChildSegments` (documentation/adr/0046's join-or-`null` decision over
that tally), so `rawSummaryOf` can see *how many* distinct children there were, not just whether
joining succeeded. A new `moduleCountByPackageName`, computed once in `deriveModuleNames` over every
Module's own `singlePackageNameOf` result, answers "how many Modules does this Package already own."

`rawSummaryOf` now offers the owning Package's name as `joinChildSegments`'s fallback only when
either of two things is true: there were genuinely zero children to interpolate (documentation/adr/0041's
original case, unchanged), or this Module is in fact that Package's only Module
(`moduleCountByPackage.get(ownPackageName) <= 1`). When neither holds - too many children *and* the
Package owns other Modules too - the fallback is the ordinal `Module <id>` label directly, the same
label a Module with no Package data at all would get.

The explicit, standalone Package-name tier (documentation/adr/0041's fourth collision tier, used when
interpolation *succeeds* but the resulting string collides with another Module's) is untouched - this
decision only narrows the *implicit* fallback `joinChildSegments`'s own `null` result reaches for, not
the Package name's availability as a tier in its own right.

## Consequences

- Measured on `valora`: `"@windagency/valora"` no longer appears as a Module name. The 83-file Module
  falls through to its ordinal label (`Module <id>`) instead - still not a *good* name, but an honest
  one, and no longer indistinguishable from "this Module represents the whole package."
- This is a naming-only decision, not a reclustering one: the 83 files stay one Module exactly as
  Louvain found them (a plausible, if unlabeled, "application composition root" domain - CLI command
  handling, console output, session lifecycle, and config loading cross-reference each other
  constantly in exactly the way a CLI tool's own wiring code would). Splitting that cluster into
  smaller, better-named pieces would be a clustering change, a materially bigger and riskier one than
  this naming fix, and is out of scope here.
- `module-naming.test.ts`'s existing documentation/adr/0046 test ("falls back to the owning Package's name
  instead of an unreadably long composite...") is unaffected: its fixture's overflowing Package
  (`app`) owns only the one Module in that test, so `moduleCountByPackage.get("app") <= 1` is already
  true and the fallback still fires exactly as before. A new test covers the narrowed case this
  decision actually changes: an overflowing Module whose Package also owns a second, cleanly-named
  Module, now falling to the ordinal label instead of the Package's name.
