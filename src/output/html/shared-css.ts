import { css } from "src/output/html/css-tag";

// Ticket 01's shared design system:
// tokens (background, panel background, border, text tiers, gold accent, cyan filter-match colour,
// radii, sidebar width, font stacks) plus shell components (`.cm-app`, `.cm-sidebar`, `.cm-card`,
// `.cm-list-item`, `.cm-legend`, `.cm-section-label`, `.cm-hint`, `.cm-zoom-controls`,
// `.cm-tooltip`) common to both screens. Both sidebars sit on the right. Screen-specific stylesheets
// (`flow-view-css.ts`, `force-view-css.ts`) add only diagram rules on top of this - never redefine
// this chrome.
//
// Token structure follows CODING_RULES/06-frontend.md's three tiers: primitive (raw values,
// `--cm-color-*`) -> semantic (`--cm-bg`, `--cm-text-primary`, `--cm-gold`) -> component
// (`--cm-tooltip-bg`, `--cm-badge-bg`, `--cm-zoom-control-bg`). Rules below reference semantic or
// component tokens only, never a primitive and never a literal colour.
//
// Layout is mobile-first per the same rule: the base rules are the narrow-viewport layout (stage
// above a full-width details panel) and every `min-width` media query at the bottom of this file
// only *adds* to them. There are deliberately no `max-width` overrides anywhere.
export const SHARED_CSS = css`
:root {
  /* Tier 1 - primitives. Raw values live here and nowhere else; only the semantic tier below may
     reference them. Gold/white/black are stored as bare "R G B" channel triples so one definition
     serves both the solid colour and every alpha variant derived from it in the semantic tier -
     an alpha variant is never re-typed as a hand-copied rgb() literal that can drift. */
  --cm-color-ink-900: #14161c;
  --cm-color-ink-800: #1c1f27;
  --cm-color-ink-600: #2c303c;
  --cm-color-ink-500: #3a3d47;
  --cm-color-slate-400: #6b6e7a;
  --cm-color-slate-200: #a7a9b4;
  --cm-color-paper-50: #e8e6e1;
  --cm-color-gold-500-rgb: 212 175 55;
  --cm-color-cyan-400: #4fd7e0;
  --cm-color-white-rgb: 255 255 255;
  --cm-color-black-rgb: 0 0 0;

  /* Scale primitives (06-frontend.md's "build spacing and sizing from a scale, not a bespoke
     variable per property per component"). Relative units throughout so the whole chrome reflows
     with the user's font-size preference. */
  --cm-space-1: 0.25rem;
  --cm-space-2: 0.375rem;
  --cm-space-3: 0.5rem;
  --cm-space-4: 0.625rem;
  --cm-space-5: 0.75rem;
  --cm-space-6: 1rem;
  --cm-space-7: 1.25rem;
  --cm-space-8: 2rem;
  --cm-font-size-1: 0.6875rem;
  --cm-font-size-2: 0.75rem;
  --cm-font-size-3: 0.8125rem;
  --cm-font-size-4: 1.25rem;

  /* Tier 2 - semantic. What a colour *means* in this UI, independent of which component uses it. */
  --cm-bg: var(--cm-color-ink-900);
  --cm-panel-bg: var(--cm-color-ink-800);
  --cm-border: var(--cm-color-ink-600);
  --cm-text-primary: var(--cm-color-paper-50);
  --cm-text-secondary: var(--cm-color-slate-200);
  --cm-text-tertiary: var(--cm-color-slate-400);
  --cm-gold: rgb(var(--cm-color-gold-500-rgb));
  --cm-gold-soft: rgb(var(--cm-color-gold-500-rgb) / 12%);
  --cm-cyan: var(--cm-color-cyan-400);
  --cm-external-color: var(--cm-color-ink-500);
  --cm-surface-hover: rgb(var(--cm-color-white-rgb) / 6%);
  --cm-surface-hover-strong: rgb(var(--cm-color-white-rgb) / 8%);
  --cm-shadow-raised: 0 var(--cm-space-1) var(--cm-space-5) rgb(var(--cm-color-black-rgb) / 40%);
  --cm-focus-ring-color: var(--cm-cyan);
  --cm-radius-sm: 0.25rem;
  --cm-radius-md: 0.5rem;
  --cm-font-ui: -apple-system, "Segoe UI", helvetica, arial, sans-serif;
  --cm-font-mono: "SFMono-Regular", "Consolas", "Liberation Mono", monospace;

  /* Tier 3 - component. The per-component surfaces, sizes and states, named
     --cm-{component}-{property}-{state}. Components below reference only these (or a semantic
     token where the component genuinely has no opinion of its own). */
  --cm-topbar-bg: var(--cm-panel-bg);
  --cm-topbar-border-color: var(--cm-border);
  --cm-topbar-gap: var(--cm-space-4);
  --cm-sidebar-bg: var(--cm-panel-bg);
  --cm-sidebar-border-color: var(--cm-border);
  --cm-sidebar-width: 18.75rem;
  --cm-sidebar-max-height: 45vh;
  --cm-card-bg: var(--cm-bg);
  --cm-card-border-color: var(--cm-border);
  --cm-list-item-fg: var(--cm-text-secondary);
  --cm-list-item-fg-active: var(--cm-text-primary);
  --cm-list-item-bg-hover: var(--cm-surface-hover);
  --cm-list-item-bg-active: var(--cm-gold-soft);
  --cm-field-bg: var(--cm-panel-bg);
  --cm-field-fg: var(--cm-text-secondary);
  --cm-field-border-color: var(--cm-border);
  --cm-field-width: 10.625rem;
  --cm-switcher-bg: var(--cm-bg);
  --cm-switcher-border-color: var(--cm-border);
  --cm-switcher-fg-active: var(--cm-gold);
  --cm-switcher-border-color-active: var(--cm-gold);

  /* 2.75rem is the 44x44 CSS px WCAG 2.5.8 / 06-frontend.md touch-target minimum at the default
     root font size, and grows from there with the user's font-size preference. */
  --cm-zoom-control-size: 2.75rem;
  --cm-zoom-control-bg: var(--cm-panel-bg);
  --cm-zoom-control-fg: var(--cm-text-primary);
  --cm-zoom-control-border-color: var(--cm-border);
  --cm-zoom-control-bg-hover: var(--cm-surface-hover-strong);
  --cm-tooltip-bg: var(--cm-panel-bg);
  --cm-tooltip-fg: var(--cm-text-primary);
  --cm-tooltip-border-color: var(--cm-border);
  --cm-tooltip-shadow: var(--cm-shadow-raised);
  --cm-tooltip-max-width: 16.25rem;

  /* Diagram component tokens, consumed by flow-view-css.ts / force-view-css.ts. They live here so
     both screens share one definition of "a node", "a link", "a step badge". */
  --cm-node-bg: var(--cm-panel-bg);
  --cm-node-fg: var(--cm-text-primary);
  --cm-node-border-color: var(--cm-gold);
  --cm-node-halo-color: var(--cm-bg);
  --cm-node-ring-color: var(--cm-cyan);
  --cm-link-color: var(--cm-text-tertiary);
  --cm-link-color-highlighted: var(--cm-gold);
  --cm-badge-bg: var(--cm-gold);
  --cm-badge-fg: var(--cm-bg);
}

* { box-sizing: border-box; }

html, body {
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: var(--cm-font-ui);
  background: var(--cm-bg);
  color: var(--cm-text-primary);
}

button, input, select {
  font-family: inherit;
  color: inherit;
}

:focus-visible {
  outline: 0.125rem solid var(--cm-focus-ring-color);
  outline-offset: 0.125rem;
}

/* Base = narrow viewport: the diagram stage stacks above the details sidebar. The
   min-width: 48em block at the bottom turns this into the side-by-side desktop layout. */
.cm-app {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

.cm-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.cm-topbar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--cm-topbar-gap);
  padding: var(--cm-space-3) var(--cm-space-4);
  background: var(--cm-topbar-bg);
  border-bottom: 1px solid var(--cm-topbar-border-color);
}

/* Purely decorative separator: it only reads as a separator once the topbar is a single
   unwrapped row, so it appears at the wide-viewport breakpoint and not before. */
.cm-topbar-divider {
  display: none;
  flex: none;
  align-self: stretch;
  width: 1px;
  background: var(--cm-topbar-border-color);
}

.cm-topbar-filters {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--cm-space-5);
}

.cm-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: row;
  min-height: 0;
  overflow: hidden;
}

.cm-stage {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.cm-stage[hidden] { display: none; }

.cm-stage svg {
  display: block;
  width: 100%;
  height: 100%;
}

.cm-sidebar {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--cm-space-6);
  width: 100%;
  max-height: var(--cm-sidebar-max-height);
  padding: var(--cm-space-6);
  overflow-y: auto;
  background: var(--cm-sidebar-bg);
  border-top: 1px solid var(--cm-sidebar-border-color);
}

.cm-card {
  padding: var(--cm-space-5);
  background: var(--cm-card-bg);
  border: 1px solid var(--cm-card-border-color);
  border-radius: var(--cm-radius-md);
}

.cm-section-label {
  margin: 0 0 var(--cm-space-3);
  font-size: var(--cm-font-size-1);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  /* --cm-text-tertiary only clears WCAG AA (4.5:1) for decorative strokes, not text - this label
     uses --cm-text-secondary instead (manual contrast pass, see html-transformer.a11y.test.ts). */
  color: var(--cm-text-secondary);
}

/* .cm-card's own disclosure label, when the card is a <details> rather than a plain <div> - a
   collapsible card's "Modules"/"Step detail" header needs no custom JS/ARIA wiring at all this
   way: <summary> is natively focusable, keyboard-toggleable (Enter/Space), and announced as a
   disclosure control by a screen reader on its own (CODING_RULES/06-frontend.md's "semantic HTML
   for interactive elements"). */
.cm-card > summary.cm-section-label {
  cursor: pointer;
}

/* Safari ignores ::marker on <summary>; its own ::-webkit-details-marker pseudo-element needs
   addressing separately for the marker to pick up the label's colour in every browser alike. */
.cm-card > summary.cm-section-label::marker,
.cm-card > summary.cm-section-label::-webkit-details-marker {
  color: var(--cm-text-secondary);
}

.cm-hint {
  margin: var(--cm-space-1) 0 0;
  font-size: var(--cm-font-size-2);
  line-height: 1.4;
  color: var(--cm-text-secondary);
}

.cm-list-item {
  display: flex;
  align-items: center;
  gap: var(--cm-space-3);
  padding: var(--cm-space-2) var(--cm-space-3);
  font-size: var(--cm-font-size-3);
  color: var(--cm-list-item-fg);
  border-radius: var(--cm-radius-sm);
  cursor: default;
}

/* Interactive legend rows are real <button> elements (keyboard-operable by default) rather than
   clickable <div>s - this resets button chrome so they still read as plain list rows. */
button.cm-list-item {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
}

button.cm-list-item:hover {
  background: var(--cm-list-item-bg-hover);
}

.cm-list-item.is-active {
  background: var(--cm-list-item-bg-active);
  color: var(--cm-list-item-fg-active);
}

.cm-legend {
  display: flex;
  flex-direction: column;
  gap: var(--cm-space-2);
}

.cm-legend-swatch {
  display: inline-block;
  flex: none;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
}

.cm-field {
  display: flex;
  flex-direction: column;
  gap: var(--cm-space-1);
  margin-bottom: var(--cm-space-5);
}

.cm-topbar-filters .cm-field {
  flex: 1 1 8rem;
  min-width: 0;
  margin-bottom: 0;
}

.cm-field label {
  font-size: var(--cm-font-size-2);
  color: var(--cm-field-fg);
}

.cm-field input,
.cm-field select {
  width: 100%;
  padding: var(--cm-space-2) var(--cm-space-3);
  font-size: var(--cm-font-size-3);
  background: var(--cm-field-bg);
  border: 1px solid var(--cm-field-border-color);
  border-radius: var(--cm-radius-sm);
}

.cm-view-switcher {
  display: flex;
  gap: var(--cm-space-1);
}

.cm-view-switcher button {
  flex: 1 1 auto;
  padding: var(--cm-space-2) var(--cm-space-3);
  font-size: var(--cm-font-size-2);
  background: var(--cm-switcher-bg);
  border: 1px solid var(--cm-switcher-border-color);
  border-radius: var(--cm-radius-sm);
  cursor: pointer;
}

.cm-view-switcher button.is-active {
  color: var(--cm-switcher-fg-active);
  border-color: var(--cm-switcher-border-color-active);
}

.cm-zoom-controls {
  position: absolute;
  right: var(--cm-space-6);
  bottom: var(--cm-space-6);
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: var(--cm-space-1);
  padding: var(--cm-space-1);
  background: var(--cm-zoom-control-bg);
  border: 1px solid var(--cm-zoom-control-border-color);
  border-radius: var(--cm-radius-md);
}

.cm-zoom-controls button {
  width: var(--cm-zoom-control-size);
  height: var(--cm-zoom-control-size);
  font-size: var(--cm-font-size-4);
  line-height: 1;
  background: transparent;
  color: var(--cm-zoom-control-fg);
  border: none;
  border-radius: var(--cm-radius-sm);
  cursor: pointer;
}

.cm-zoom-controls button:hover {
  background: var(--cm-zoom-control-bg-hover);
}

.cm-tooltip {
  position: absolute;
  z-index: 10;
  max-width: var(--cm-tooltip-max-width);
  padding: var(--cm-space-2) var(--cm-space-4);
  font-size: var(--cm-font-size-2);
  background: var(--cm-tooltip-bg);
  color: var(--cm-tooltip-fg);
  border: 1px solid var(--cm-tooltip-border-color);
  border-radius: var(--cm-radius-sm);
  box-shadow: var(--cm-tooltip-shadow);
  transition: opacity 0.1s ease;
  opacity: 0;
  pointer-events: none;
}

.cm-tooltip.is-visible { opacity: 1; }

/* Progressive enhancement only - a lower bound on the viewport, never an upper one, so nothing
   below overrides a base style downward. Written in Media Queries Level 4 range notation
   (width >= 48em), which is the same condition as min-width: 48em and is what Stylelint's
   media-feature-range-notation rule requires here. The unit is em so the breakpoint respects the
   user's font size (06-frontend.md); 48em is ~768px at the default root size, the point from
   which there is room for the details sidebar to sit beside the stage instead of under it. */
@media (width >= 48em) {
  :root {
    --cm-topbar-gap: var(--cm-space-7);
  }

  .cm-app {
    flex-direction: row;
  }

  .cm-topbar {
    padding: var(--cm-space-4) var(--cm-space-6);
  }

  .cm-topbar-divider {
    display: block;
  }

  .cm-topbar-filters {
    flex: 0 1 auto;
    gap: var(--cm-space-6);
  }

  .cm-topbar-filters .cm-field {
    flex: 0 0 var(--cm-field-width);
    width: var(--cm-field-width);
  }

  .cm-sidebar {
    flex: 0 0 var(--cm-sidebar-width);
    width: var(--cm-sidebar-width);
    max-height: none;
    border-top: none;
    border-left: 1px solid var(--cm-sidebar-border-color);
  }
}
`;
