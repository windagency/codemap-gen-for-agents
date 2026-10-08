# Enforcement

[Back to AGENTS.md](../AGENTS.md) • [Back to 01-principles.md](01-principles.md) • [Back to 13-testing-strategy.md](13-testing-strategy.md) • [Back to 14-observability.md](14-observability.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to 0022-structured-logging-adapter.md](../documentation/adr/0022-structured-logging-adapter.md) • [Back to GOVERNANCE.md](../GOVERNANCE.md)

Load before opening or reviewing a PR.

## Severity levels

| Level                            | Meaning                      | Examples                                                                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL - blocks the PR         | Security or correctness risk | Security vulnerability, missing input validation, missing architecture test, unjustified `any`, third-party library used without an adapter, no security test on a new auth or input boundary                                                               |
| HIGH - fix before merge          | Breaks a house standard      | Naming violations, missing error handling, no observability added for a new feature, props drilling past 2 levels, missing WCAG compliance or accessibility test, missing e2e coverage on a critical path, documentation not updated for a behaviour change, non-trivial business logic written without a failing test first (TDD, `01-principles.md`) |
| MEDIUM - fix in a fast follow-up | Quality debt, not a blocker  | Code duplication, complexity > 10, relative imports, `switch` used for a simple value mapping, commit message doesn't follow Conventional Commits                                                                                                           |
| LOW - nice to have               | Polish                       | Formatting nits, missing JSDoc, minor performance, long functions                                                                                                                                                                                           |

## Review checklist - all code

- [ ] Naming conventions followed (`03-typescript.md`).
- [ ] `interface`/`type` used correctly.
- [ ] Object literal lookups used where a `switch` would do a simple mapping.
- [ ] No duplicated logic.
- [ ] Cyclomatic complexity ≤ 10.
- [ ] Absolute imports only.
- [ ] Exported functions have explicit return types; no unjustified `any`.
- [ ] `Set`/`Map` used where appropriate.
- [ ] Error handling present.
- [ ] For non-trivial business logic, the PR shows TDD order: a test-only commit precedes the implementation commit, and its new tests fail at that commit. CI's `tdd-order` job enforces this on `feat-*`/`fix-*` PRs into `int`; exempt a commit only with a `TDD-Exempt: <reason>` trailer that a reviewer approves (`01-principles.md`).
- [ ] The right test types for this change are present, not unit tests by default (`13-testing-strategy.md`).
- [ ] Architecture tests added/updated for any touched boundary.
- [ ] Logs, metrics, or traces added for new or changed behaviour (`14-observability.md`).
- [ ] Commit messages follow Conventional Commits (`10-commits-and-versioning.md`).
- [ ] Documentation updated for any behaviour change, following the two-audience structure (`11-documentation.md`).

## Review checklist - backend

- [ ] Zod validation on external input.
- [ ] FSM used for multi-step workflows.
- [ ] AuthN/AuthZ enforced via guard/middleware.
- [ ] DB transactions where a mutation spans multiple writes.
- [ ] Operations that matter are idempotent.
- [ ] Structured logging, metrics, and tracing in place, per `14-observability.md`.
- [ ] Security tests cover any new externally-facing endpoint or input boundary (`13-testing-strategy.md`).
- [ ] Rate limiting on public endpoints.
- [ ] Third-party libraries wrapped in an adapter.

## Review checklist - frontend

- [ ] Atomic structure followed.
- [ ] Smart/dumb split maintained.
- [ ] Mobile-first CSS.
- [ ] WCAG 2.0 AA checks pass, including an automated `vitest-axe` run (`13-testing-strategy.md`).
- [ ] No props drilling past 2 levels.
- [ ] Server state in Tanstack Query, client state in Zustand.
- [ ] Forms use React Hook Form + Zod.
- [ ] Error boundaries in place.
- [ ] Loading and empty states handled.

## Metrics targets

| Metric                     | Target                      |
| -------------------------- | --------------------------- |
| Test coverage              | > 60%                       |
| Type coverage              | 100% (no unjustified `any`) |
| Cyclomatic complexity      | < 10                        |
| Duplicated code            | < 3%                        |
| Function length            | < 50 lines                  |
| Frontend bundle (initial)  | < 200KB                     |
| Architecture test coverage | 100% of stated rules        |

## Tooling

**Required:** Biome (lint + format), TypeScript, `arch-unit-ts` (or an equivalent architecture-boundary test - see `src/__tests__/architecture/dependency-direction.test.ts` for this repo's substitute), Husky, Vitest/Playwright, Zod, commitlint, gitleaks, semantic-release.

**Recommended:** default library picks for a practice that's already mandatory above. The practice is not optional; the specific package is. Swap it for an equivalent, don't drop it.

- Backend: Pino/Winston (logging), Prometheus (metrics), OpenTelemetry (tracing), XState, Fastify/NestJS.
- Frontend: Tanstack Query, Zustand, React Hook Form, Vite, Storybook, `vitest-axe` (accessibility testing), Stylelint.
