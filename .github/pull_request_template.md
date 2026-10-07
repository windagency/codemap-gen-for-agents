## What and why

<!-- What changed, and why. Link the issue if there is one. -->

## Definition of done

- [ ] Lint and format (Biome) pass with no warnings suppressed inline without justification.
- [ ] Type-check passes with no new `any`.
- [ ] The test types this change actually needs are present (see `CODING_RULES/13-testing-strategy.md`).
- [ ] Architecture-boundary tests pass for any touched module boundary.
- [ ] Stylelint passes for any touched CSS.
- [ ] New or changed behaviour is observable (logs, metrics, or traces).
- [ ] Documentation affected by this change is updated (`CODING_RULES/11-documentation.md`).
- [ ] Commit messages follow Conventional Commits, and any version bump matches its SemVer impact.

## Non-negotiables

- [ ] No `any` without an inline comment justifying it.
- [ ] All external input validated with Zod before use.
- [ ] No direct third-party library imports outside an `adapters/` wrapper.
- [ ] No architectural rule shipped without a matching architecture-boundary test.
- [ ] No secrets, tokens, or credentials committed.
