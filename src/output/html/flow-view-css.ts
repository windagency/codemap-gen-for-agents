import { css } from "src/output/html/css-tag";

// Ticket 02's Flow-view-only diagram rules -
// stage-column boxes, curved connectors, Module/import-chain highlight, and the filter/highlight
// combined visual. Never redefines shell chrome from `shared-css.ts`; colours come from that file's
// component tokens (`--cm-node-*`, `--cm-link-*`, `--cm-badge-*`) so a diagram never carries its own
// copy of a colour.
//
// Deliberate `px` exception to 06-frontend.md's relative-units rule: everything inside the `<svg>`
// below (`font-size`, `stroke-width`, `rx`) is *diagram geometry* in the SVG's own user-coordinate
// space, sized against the box/column constants in `client-flow-view.ts` - not document text. It
// scales as one with the diagram under browser zoom and under the view's own zoom controls, so
// expressing only the type in `rem` would make labels grow out of their boxes at a larger root
// font size instead of improving legibility. Chrome outside the `<svg>` (`.cm-step-detail-title`)
// follows the rule and uses the shared scale.
export const FLOW_VIEW_CSS = css`
.cm-flow-node rect:not(.cm-flow-combined-ring) {
  fill: var(--cm-node-bg);
  stroke: var(--cm-node-border-color);
  stroke-width: 1.5;
  rx: 6px;
}

.cm-flow-node text {
  font-family: var(--cm-font-mono);
  font-size: 11px;
  fill: var(--cm-node-fg);
}

.cm-flow-node.cm-is-external rect {
  stroke-dasharray: 4 3;
}

.cm-flow-link path {
  fill: none;
  stroke: var(--cm-link-color);
  stroke-width: 1;
  opacity: 0.6;
}

.cm-flow-node,
.cm-flow-link {
  transition: opacity 0.15s ease;
}

.cm-flow-node.cm-dimmed,
.cm-flow-link.cm-dimmed {
  opacity: 0.15;
}

.cm-flow-node.cm-dimmed.cm-filter-matched,
.cm-flow-link.cm-dimmed.cm-filter-matched {
  opacity: 1;
}

.cm-flow-node.cm-highlighted rect:not(.cm-flow-combined-ring) {
  stroke-width: 3;
}

.cm-flow-combined-ring {
  display: none;
  fill: none;
  stroke: var(--cm-node-ring-color);
  stroke-width: 2;
  stroke-dasharray: 3 3;
}

/* Keyboard focus indicator for the nodes' own tabindex="0" (see client-flow-view.ts): browsers
   are inconsistent about painting an outline on an SVG <g>, so the node's existing ring doubles as
   the focus ring rather than relying on shared-css.ts's :focus-visible outline alone. */
.cm-flow-node:focus-visible .cm-flow-combined-ring {
  display: block;
  stroke-dasharray: none;
}

.cm-flow-node.cm-highlighted.cm-filter-matched .cm-flow-combined-ring {
  display: block;
}

.cm-flow-link.cm-highlighted path {
  stroke: var(--cm-link-color-highlighted);
  stroke-width: 2;
  opacity: 1;
}

.cm-flow-badge {
  cursor: pointer;
}

.cm-flow-badge circle {
  fill: var(--cm-badge-bg);
}

.cm-flow-badge text {
  font-size: 10px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
  fill: var(--cm-badge-fg);
}

.cm-flow-column-header {
  font-family: var(--cm-font-mono);
  font-size: 12px;
  font-weight: 700;
  text-anchor: middle;
}

.cm-step-detail-title {
  margin: 0;
  font-size: var(--cm-font-size-3);
  color: var(--cm-text-primary);
}

.cm-step-detail-links {
  margin: var(--cm-space-1) 0 0;
  padding-left: var(--cm-space-6);
  font-size: var(--cm-font-size-2);
  line-height: 1.5;
  color: var(--cm-text-secondary);
}

.cm-step-detail-links li {
  font-family: var(--cm-font-mono);
}
`;
