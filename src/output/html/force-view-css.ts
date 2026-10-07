import { css } from "src/output/html/css-tag";

// Ticket 03's Force-view-only diagram rules -
// categorically coloured nodes, Module-region hulls, neighbourhood highlight, and this screen's own
// filter/highlight combined visual (implemented fresh for this screen, not carried from the
// disposed prototype). Never redefines shell chrome from `shared-css.ts`; colours come from that
// file's component tokens (`--cm-node-*`, `--cm-link-*`).
//
// Same deliberate `px` exception to 06-frontend.md's relative-units rule as `flow-view-css.ts`, for
// the same reason: every length here is SVG user-space diagram geometry (halo `stroke-width`, node
// label `font-size`), not document text, and scales with the diagram rather than with the root
// font size.
export const FORCE_VIEW_CSS = css`
.cm-force-hull {
  stroke: none;
  opacity: 0.12;
}

.cm-force-link {
  stroke: var(--cm-link-color);
  stroke-width: 1;
  transition: opacity 0.15s ease;
  opacity: 0.5;
}

.cm-force-node circle:not(.cm-force-combined-ring) {
  stroke: var(--cm-node-halo-color);
  stroke-width: 1.5;
  transition: opacity 0.15s ease;
}

.cm-force-node text {
  font-family: var(--cm-font-mono);
  font-size: 10px;
  fill: var(--cm-node-fg);
  stroke: var(--cm-node-halo-color);
  stroke-width: 3px;
  stroke-linejoin: round;
  paint-order: stroke;
  transition: opacity 0.15s ease;
}

.cm-force-node,
.cm-force-link {
  transition: opacity 0.15s ease;
}

.cm-force-node.cm-dimmed circle,
.cm-force-node.cm-dimmed text,
.cm-force-link.cm-dimmed {
  opacity: 0.15;
}

.cm-force-node.cm-dimmed.cm-filter-matched circle,
.cm-force-node.cm-dimmed.cm-filter-matched text,
.cm-force-link.cm-dimmed.cm-filter-matched {
  opacity: 1;
}

.cm-force-node.cm-highlighted circle:not(.cm-force-combined-ring) {
  stroke: var(--cm-node-border-color);
  stroke-width: 3;
}

.cm-force-combined-ring {
  display: none;
  fill: none;
  stroke: var(--cm-node-ring-color);
  stroke-width: 2;
  stroke-dasharray: 3 3;
}

/* Keyboard focus indicator for the nodes' own tabindex="0" (see client-force-view.ts): browsers
   are inconsistent about painting an outline on an SVG <g>, so the node's existing ring doubles as
   the focus ring rather than relying on shared-css.ts's :focus-visible outline alone. */
.cm-force-node:focus-visible .cm-force-combined-ring {
  display: block;
  stroke-dasharray: none;
}

.cm-force-node.cm-highlighted.cm-filter-matched .cm-force-combined-ring {
  display: block;
}

.cm-force-link.cm-highlighted {
  stroke: var(--cm-link-color-highlighted);
  stroke-width: 2;
  opacity: 1;
}
`;
