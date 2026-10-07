# 0046: An interpolated composite name is capped, falling back past it when exceeded

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Closes documentation/adr/0009's own explicitly flagged gap: "This isn't capped; revisit if a real
codebase produces an unreadably long interpolated name in practice."

## Context

Running the generator against a real, large monorepo (`valora`, after documentation/adr/0044's and documentation/adr/0045's
data-pollution fixes) produced a Module named
`cli+ui+utils+executor+types+mcp+output+llm+exploration+services+plugins+security+session+config+updater+batch+observability+memory+cleanup+di+registry+regression`
- 21 joined segments, 378 files. The root package's own application code is organized into 20+
top-level folders directly under its own `src/` (`src/cli/`, `src/ui/`, `src/utils/`, ...), all
landing in one Louvain community with no common ancestor closer than `src` itself. documentation/adr/0009's
interpolation rule - join every distinct child directory one level past the common ancestor, ordered
by file count - had no upper bound, so it joined all 21.

documentation/adr/0009 anticipated this exact possibility and explicitly declined to address it at the time:
"A Module with many scattered child directories (e.g. 5+ distinct top-level areas) will get a long,
hyphen-free `a+b+c+d+e`-style name rather than a short one - verbose but still more informative than
an ordinal label. This isn't capped; revisit if a real codebase produces an unreadably long
interpolated name in practice." That codebase has now been found. Past a handful of joined segments,
a composite name stops being something a human or agent scanning a Module legend can actually use,
and is no more informative in practice than an ordinal label would have been - just longer.

## Decision

`interpolatedNameAt` (`src/clustering/module-naming.ts`) now returns `null` - "nothing usable to
interpolate" - whenever the number of distinct child directories it would join exceeds
`MAX_INTERPOLATED_SEGMENTS` (4, chosen to match documentation/adr/0009's own illustrative "5+ distinct
top-level areas" threshold for when the case becomes a problem), not only when there are zero
children to interpolate from. `rawSummaryOf` already treats a `null` interpolation result as "fall
back to the owning Package's name" (documentation/adr/0041) - this reuses that existing fallback path
unchanged; no new tier, no new field, no special-casing elsewhere in the naming pipeline.

## Consequences

- Measured on `valora`: the 21-segment Module is now named `@windagency/valora` - the root
  package's own declared name, cleanly settled with no collision (every sibling Module that could
  have contested it had already reserved its own, more specific name at an earlier tier,
  documentation/adr/0042). Every one of `valora`'s 30 Modules still gets a real name; none regressed to an
  ordinal as a side effect of this cap.
- `module-naming.test.ts` gained two tests: a Module scattered across 5 child directories (over the
  cap) falls back to its Package's name instead of joining all 5, and a control case at exactly 3
  children confirms interpolation still produces its composite name normally, unaffected, when
  within the cap. All prior tests - none of which exceed 4 segments - passed unchanged.
- The threshold is a human-judgment call, not derived from the graph itself, the same kind of
  deliberate tuning constant as documentation/adr/0007's `FOLDER_PROXIMITY_BASE`: picked by measuring its
  effect on a real codebase's generated output, not computed from first principles. Revisit the
  constant if a future real codebase's genuinely-informative composite name turns out to need more
  than 4 segments to say something useful.
- A Module whose interpolation is capped and which also has no single owning Package (or no Package
  data in the graph at all) still falls all the way to the ordinal label - this decision doesn't
  invent a third option between "short informative composite" and "Package name"; it only adds the
  one new "composite is too long" trigger for the fallback documentation/adr/0041 already provides.
