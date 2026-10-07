# 0043: Force-directed view is scoped to File and External nodes, not Symbol

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted. Narrows the Force-directed view's node scope from "every File/Symbol/External node" to
"every File/External node," matching Flow view's existing scope; also fixes an O(regions × n)
per-tick cost in the same view's region-hull rendering.

## Context

Running the generator against a separate, real, substantially-sized codebase (`valora`: 2,468
files) and opening the generated HTML, Force-directed view was reported as very slow. Measured
directly: the view's `forceNodeKinds` included `symbol`, and `valora`'s graph has 25,773 Symbol
nodes against 2,468 File nodes and 59 External ones - a 28,300-node physics simulation, fed by
~34,762 edges (5,924 file-level imports plus 28,838 symbol-level calls, since the link filter
admitted any edge whose two endpoints were both in the File/Symbol/External node set). Flow view,
by contrast, already scoped itself to File/External only (2,527 nodes, import edges alone) and
wasn't the complaint.

A default d3-force run ticks roughly 300 times before alpha decays below its stop threshold. Every
tick in `client-force-view.ts`'s handler writes a `transform` attribute for every node and
`x1`/`y1`/`x2`/`y2` for every link - at `valora`'s scale, on the order of 19 million DOM attribute
writes across a full run. On top of that, the region-hull redraw re-filtered the *entire* `simNodes`
array once per region to collect that region's current points (`simNodes.filter(...)`, called once
per entry in `regionIds`), and separately re-scanned the whole array again per region just to find
one representative node for the hull's fill color (`simNodes.find(...)`) - an O(regions × n) cost,
every tick, for information (region membership) that is fixed at simulation start and never changes
tick to tick; only each node's `(x, y)` does. At `valora`'s scale (~28 Modules, 28,300 nodes) that's
roughly 237 million redundant iterations across a full run, on top of the DOM-write cost above.
Initial DOM construction alone - one `<g>` with 2-3 children per node, one `<line>` per link - put
on the order of 60,000-90,000 SVG elements in the document before the simulation even started.

A 28,300-node physics hairball isn't legible to a human or useful to an agent reading the map
regardless of render speed - visualizing every individual function, class, and type as its own
simulated particle was never validated against a codebase anywhere near this size, and the node
count it adds (routinely 10x+ the file count) is the reason this view's cost scales so much worse
than Flow view's.

## Decision

Two changes to `src/output/html/client-force-view.ts`:

1. `forceNodeKinds` drops `symbol`, narrowing to `{ file: true, external: true }` - the same scope
   Flow view already uses. `forceLinks`' filter gains an explicit `e.type === "import"` check (Flow
   view already has this; Force view relied implicitly on call edges' symbol-id endpoints no longer
   matching the narrowed node set, which is correct but not self-documenting). The now-unreachable
   `symbol` branches in the file's own local `RADIUS_BY_KIND` and `MODULE_ID_RESOLVER_BY_KIND`
   lookups are removed; `src/output/html/module-regions.ts`'s shared, separately-tested
   `computeRegionId` keeps its own `symbol` case untouched; it's simply never invoked with one now -
   that function's contract isn't specific to this one caller.
2. The per-tick hull computation now bucket-groups `simNodes` by `regionId` into `pointsByRegion` in
   a single O(n) pass, replacing the per-region O(n) filter. `sampleNodeByRegion` (one representative
   node per region, for hull fill color) is computed once before the simulation starts rather than
   re-scanned on every tick, since region membership is fixed at assignment and never changes
   afterward.

## Consequences

- Measured on `valora`: Force view's simulation scope drops from 28,300 nodes / ~34,762 edges to
  2,527 nodes / ~5,924 edges - matching Flow view's existing scale exactly, since both views now
  render the identical File+External node set (over different layouts). The hull computation's
  per-tick cost drops from O(regions × n) to O(n), eliminating on the order of 237 million redundant
  iterations across a full simulation run at that scale.
- This is a real, visible behavior change: Force view no longer renders an individual dot per
  Symbol. Flow view never did either, and Symbol-level detail remains reachable through the existing
  Symbol-kind filter and search facets - this removes a view that wasn't legible at real-world scale
  anyway, not a user-facing capability that worked.
- `html-transformer.a11y.test.ts` (the one harness that executes the generated client scripts rather
  than inspecting their source text) gained a test asserting a Symbol node is never rendered as a
  `.cm-force-node`, with a File and an External node both still present - locking in the narrowed
  scope directly against the compiled, embedded script, not just the source.
- No change to Flow view, to `computeRegionId`'s own exported contract or its test suite, or to the
  JSON envelope - `codemap.json` still carries every Symbol node for path/symbolKind/search filtering
  and other consumers; only the Force view's client-side rendering scope narrowed.
