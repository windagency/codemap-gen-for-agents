# Frontend Standards

[Back to 13-testing-strategy.md](13-testing-strategy.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md)

Load when touching components, styles, or layout.

## Component structure

- Atomic hierarchy: atoms (Button, Input) → molecules (FormField) → organisms (LoginForm) → templates (PageLayout) → pages.
- Separate smart (container: fetches data, holds state) from dumb (presentational: props in, JSX out) components. A component that both fetches and renders mixes two responsibilities and can't be reused or tested in isolation.

## CSS property order

Within a rule block, group properties in this order: **positioning → display/flexbox/grid → box model (sizing, spacing, overflow) → typography → visual (background, border, shadow) → transforms/animation → misc (cursor, opacity, etc.)**. Enforced by Stylelint's `order/properties-order` - don't hand-order against it.

## Design tokens

Three tiers: primitive (`--color-blue-500`) → semantic (`--text-primary`, `--bg-secondary`) → component (`--button-primary-bg`). Components reference semantic or component tokens only - never a primitive directly, and never a hardcoded hex or px value.

Naming: `--{category}-{variant}-{state}` (e.g. `--button-primary-bg-hover`). Build spacing and sizing from a scale (`--space-1` … `--space-8`), not a bespoke variable per property per component.

## Mobile-first

Base styles are unadorned mobile styles. Add complexity with `min-width` media queries as the viewport grows. Never write desktop styles first and override downward with `max-width`.

## Accessibility - WCAG 2.0 AA baseline

- Semantic HTML for interactive elements (`<button>`, not a `<div onClick>`).
- `aria-label` on icon-only controls.
- Everything clickable is also keyboard-operable (`tabIndex`, `onKeyDown` for Enter/Space, or just use a real `<button>`).
- Modals/dialogs trap focus, restore it on close, and close on Escape - use a maintained library (`@radix-ui/react-dialog`, `@headlessui/react`, `focus-trap-react`) rather than hand-rolling the trap.
- Colour contrast at least 4.5:1 for normal text.
- Relative units (`rem`, `em`, `%`, `ch`) for text, spacing, and widths, not fixed `px`, so the page survives 200% zoom without clipping and reflows at 400% without horizontal scroll.
- Breakpoints in `em`, not `px`, so they respect the user's font-size preference.
- Never disable zoom (`user-scalable=no`, `maximum-scale=1.0` in the viewport meta tag).
- Interactive targets at least 44×44 CSS px.

## Avoid props drilling

If a prop passes through more than two component layers untouched, it belongs in Context or a Zustand store instead.
