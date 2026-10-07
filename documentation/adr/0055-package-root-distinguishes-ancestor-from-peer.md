# 0055: The Package-name fallback requires being the Package's root, not just its only claimant

[Back to LLD.md](../LLD.md)

## Status

Accepted. Corrects a regression documentation/adr/0054 itself introduced while fixing `src/cli/`'s naming.

## Context

documentation/adr/0054 restricted the Package-name fallback to "this Module is the only one its Package owns" -
simpler than, and intended to subsume, documentation/adr/0050's narrower overflow-only version. Applying it
immediately regressed a different, real `valora` Module: `valora-plugin-memory-vault`'s own entrypoint
files (`index.ts`, `manager.ts`, `store.ts`, and others, directly in the package's `src/`) lost their
name `"@windagency/valora-plugin-memory-vault"`, falling to the bare, uninformative `"src"` instead -
because that package *also* owns other Modules (`migration`, `embeddings`, `consolidation+retrieval`),
documentation/adr/0054's "owns no other Module" test now failed it too, exactly like `src/cli/`.

The two cases look identical by moduleCount alone but are structurally opposite. `src/cli/`'s files
are a *peer* of `src/security/`, `src/services/`, and over a dozen other Modules the same root package
owns - all sitting at the same directory depth, none nested inside another. `valora-plugin-memory-vault`'s
entrypoint files are the package's actual root: `migration/`, `embeddings/`, and the rest are each a
subdirectory *beneath* the very `src/` the entrypoint files live directly in. Naming the `cli` Module
after its package would claim it stands for the whole package, when a dozen equally-valid siblings
exist beside it. Naming the memory-vault entrypoint after its package doesn't - every other Module the
package owns is already understood as a sub-area of it, the same way a filesystem's own root directory
isn't "just another sibling" of the directories inside it.

The two cases are already structurally distinguishable without any new information: a Module's own
common ancestor (`meaningfulDir`) is a Package root exactly when every other Module the same Package
owns has that ancestor as a *prefix* of its own - i.e. every sibling Module lives somewhere underneath
it. For `cli`, this fails immediately: `security`'s ancestor (`src/security`) doesn't extend `cli`'s
(`src/cli`) - they diverge at the second segment, confirming they're peers. For memory-vault's
entrypoint, it holds for every sibling: `migration`'s ancestor (`.../src/migration`) and `embeddings`'s
(`.../src/embeddings`) both extend `.../src` exactly.

That prefix check alone isn't quite sufficient either, though: an *overflowing* Module's own common
ancestor is often unusually shallow precisely because its files scattered across many directories, not
because it's anyone's conceptual root - and a shallow ancestor is structurally a "prefix" of almost
anything. `valora`'s original 83-file Module (meaningfulDir `src` alone, before documentation/adr/0051 split it
up) would satisfy the prefix check against literally every other `src/*` Module in the repo, exactly
the misrepresentation documentation/adr/0050 was written to stop. The prefix check has to be paired with the
same "zero children, not overflow" condition documentation/adr/0050 already established - but only when the
Package actually has other Modules to fail the check against; documentation/adr/0041's original single-Module-Package
case (an overflowing Module that happens to be its Package's *only* Module, documentation/adr/0046's own test)
is still allowed through unconditionally, since there's no sibling for it to misrepresent itself against.

## Decision

`isPackageRootModule` (`src/clustering/module-naming.ts`, replacing documentation/adr/0054's simpler
`moduleCountByPackageName`) now checks, for a given Module and its owning Package: does every *other*
Module sharing that Package have this Module's own common ancestor as a prefix of its own. If the
Package has no other Module at all, the check passes vacuously (documentation/adr/0041's original case,
unconditionally). If it does have other Modules, the prefix condition must hold for all of them *and*
this Module must have zero children left to interpolate (not have gotten here via overflow) - an
overflowing Module's shallow ancestor doesn't earn root status just because it happens to prefix a
real sibling's deeper one.

`deriveModuleNames` now computes every Module's `meaningfulDir` and owning-Package name in a
dedicated pre-pass before deriving any single Module's raw summary, since `isPackageRootModule`
needs to compare one Module's directory against every other same-Package Module's - information only
available once all of them have been computed once.

## Consequences

- Measured on `valora`: `valora-plugin-memory-vault`'s entrypoint Module is
  `"@windagency/valora-plugin-memory-vault"` again; `src/cli/`'s Module is still plain `"cli"`
  (unaffected - it never passed the prefix check to begin with, so this decision doesn't reopen
  documentation/adr/0054's fix for it). No bare `"src"`, `"config"`-the-generic-word, or similar
  under-qualified directory-segment name remains anywhere in the output from this specific mechanism.
- `module-naming.test.ts` gains a dedicated test for the restored case - a Package-root Module (every
  sibling nested beneath it) keeping its Package's name - built the same way the `src/cli/`-shaped
  documentation/adr/0054 test was, including the same "keep `packages` from being stripped as the universal
  root" and "give it a real sibling to collide with at the deepName tier" construction, confirmed by
  first watching it fail for the wrong reason (settling one tier early, on the bare word `"src"`,
  without ever reaching the Package-root check this test exists to cover) before fixing the fixture.
- `singlePackageNameOf` and `owningPackageOf` (documentation/adr/0041, documentation/adr/0049) are unchanged - this
  decision only adds a second, independent condition (`isPackageRootModule`) alongside them, it
  doesn't alter how a file's owning Package is found in the first place.
