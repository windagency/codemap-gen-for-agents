# 0054: The Package-name fallback's restriction applies regardless of why interpolation failed, and its filler is the real directory, not an ordinal

[Back to LLD.md](../LLD.md)

## Status

Accepted. Generalizes documentation/adr/0050 (which only covered the "too many children" case) and fixes an
interaction gap between documentation/adr/0050 and documentation/adr/0052 that let a dishonest Package-name
fallback slip through naming as a per-Module ordinal before documentation/adr/0052's numbering ever saw it.

## Context

documentation/adr/0053 fixed `valora`'s `src/cli` directory-tie problem, merging most of its stray fragments
into far fewer Modules. One of the resulting Modules - 31 files, all sitting directly in `src/cli/`
with no further subdirectory - still came out named `"@windagency/valora"`: exactly the original
finding this whole investigation started from, reappearing in a new shape.

The cause was a gap in documentation/adr/0050's own condition. That decision blocked the Package-name fallback
only for a Module that *overflowed* `MAX_DIRECTORY_BREADTH` (too many children to interpolate) - it
left the original, zero-children case (documentation/adr/0041's `singlePackageNameOf(...) ?? ...` fallback)
unconditional, on the assumption that "nothing to interpolate" only ever meant a small, single-purpose
package whose own entrypoint files sit directly in its `src/`. This 31-file Module is exactly the
zero-children shape (every file directly in `src/cli/`, nothing nested below it) - but its owning
Package (`@windagency/valora`) is the exact opposite of "small and single-purpose": it already owns
over a dozen other, separately-named Modules. documentation/adr/0050's own stated reasoning ("naming a leftover
Module after a Package it merely shares with several other, cleanly-named Modules would misrepresent
it as if it stood for the whole Package") applies identically here - the *reason* interpolation found
nothing usable (zero children vs. too many) was never actually what made the Package-name fallback
dishonest; whether the Package owns other Modules is the only thing that ever mattered, and
documentation/adr/0050 checked it for only one of the two cases.

Fixing just that, though, surfaced a second, subtler gap. The natural fix - route both the zero- and
overflow-children cases through the same "is this Package's name honest" check, falling to
`Module ${moduleId}` when it isn't - doesn't actually reach documentation/adr/0052's numbering step at all. A
`Module ${moduleId}` filler is unique by construction (every Module has a different id), so two
Modules in the identical "dishonest Package name" situation each privately "succeed" at the
interpolated-name tier with their own distinct ordinal-shaped string, rather than colliding with each
other and cascading down to documentation/adr/0052's deepName-based numbering. The two sibling `src/cli`
Modules documentation/adr/0053 exposed would each reach the right *kind* of fallback but the wrong *value* -
an ordinal that happens to already be unique, defeating the numbering mechanism built specifically for
this shape.

## Decision

`rawSummaryOf` (`src/clustering/module-naming.ts`) drops the `childSegments.size === 0 ||` half of
the honesty check entirely - the Package-name fallback (`packageFallbackIsHonest`) is now gated purely
on whether the owning Package has more than one Module (`moduleCountByPackage`), regardless of which
of the two interpolation failures got a Module here.

When the fallback isn't honest, the filler used in its place is the Module's own deepest *real*
directory segment (`meaningfulDir[meaningfulDir.length - 1]`, the same value the `deepName` field
itself holds) - not `Module ${moduleId}`. Two Modules that both lack an honest Package name for the
same reason already share this value (it's what makes them collide at the `deepName` tier in the
first place), so reusing it as their shared filler lets them continue colliding honestly through the
remaining tiers, reaching documentation/adr/0052's numbering step instead of bypassing it on a technicality. A
bare `Module ${moduleId}` ordinal is reserved for the one case with no real directory segment to fall
back on at all - every file's common ancestor is empty, the original pre-documentation/adr/0009 "nothing in common"
shape - where there genuinely is nothing non-fabricated left to offer.

## Consequences

- Measured on `valora`: the 31-file `src/cli/` Module settles as `"cli"` directly (no numbering
  needed in this specific shape, since no sibling Module also lands on bare `"cli"` once
  `commands+types` separately settles on its own real interpolated name) - `"@windagency/valora"` is
  gone from the output a second time, this time for good within the shapes this investigation chain
  actually exercised.
- Two existing tests changed expected output, deliberately: a no-Package-data collision
  (`src/foo/*`, two Modules) now numbers as `"foo-1"`/`"foo-2"` instead of `"Module 0"`/`"Module 1"` -
  the same documentation/adr/0052 benefit, now reaching the no-Package-data case too, since it was never
  really about Package data specifically. A documentation/adr/0050 fixture (an overflowing Module whose Package
  owns a second Module) now settles on its own real directory segment (`"src"`) rather than an
  ordinal, since that segment turned out to be unique once a sibling Module took a different real
  name - both changes reviewed and accepted as the intended, more informative behavior, not
  incidental regressions.
- A new test covers the shape that motivated this decision directly: two zero-children Modules
  sharing a leaf directory, owned by a Package that already has a third, cleanly-named Module -
  numbered against each other (`cli-1`/`cli-2`) rather than each landing on its own private ordinal.
