# Testing Strategy

[Back to pull_request_template.md](../.github/pull_request_template.md) • [Back to 09-enforcement.md](09-enforcement.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to TESTING.md](../documentation/TESTING.md)

Load when deciding what tests a change needs, or when writing or reviewing tests.

This file is the decision table, stack-agnostic. This repo's actual test seams, fixtures, CI commands, and QA checklist: `documentation/TESTING.md`.

## The default is wrong

"Add tests" defaults to unit tests. That default misses most of what actually breaks in production: a unit passing in isolation while the integration with the database is wrong, a flow that only fails when a real browser tabs through it, a component invisible to a screen reader, an endpoint that happily accepts a payload it should reject. Decide test type by what the change touches, not by habit.

## The six types

| Type | Answers | Required when | Tooling |
|---|---|---|---|
| Unit | Does this function or class behave correctly in isolation | Any new or changed business logic | Vitest |
| Integration | Do these units work together across a real boundary | The change crosses a DB, queue, external adapter, or service boundary; any new API endpoint | Vitest against a real or containerised dependency |
| E2E | Does the critical user flow work end to end | The change touches a critical path: auth, checkout or payment, onboarding, or any flow spanning multiple pages or screens | Playwright |
| Accessibility | Can every user, including assistive-tech users, use this | Any new or changed UI component or page | `vitest-axe` automated check, plus the manual keyboard and contrast check in `06-frontend.md` |
| Security | Can this be bypassed, injected into, or made to leak data | The change touches auth, an input-validation boundary, an externally-facing endpoint, or a dependency bump | Dependency audit (`pnpm audit` or equivalent), a test proving a Zod schema rejects a bad payload, a targeted authorisation-bypass test on the new endpoint |
| Architecture | Does this still respect the module boundaries and patterns already decided | The change touches a module boundary, adds an adapter, or adds a layer | `arch-unit-ts`, mandatory per `04-architecture.md` |

## Deciding fast

Ask these in order and stop at the first "yes" that applies; a change often needs more than one.

- Is it a pure function with no I/O? Unit test is enough.
- Does it cross a boundary, another service, the database, an adapter? Add integration.
- Would a user notice if this broke, and is the path critical? Add e2e.
- Does it render UI? Add accessibility.
- Does it touch a trust boundary, input from outside the system, or who's allowed to do what? Add security.
- Does it move code between layers or introduce a new dependency direction? Add architecture.

## What "when needed" does not mean

It does not mean skip a type because it's inconvenient this sprint. A payment endpoint with only unit tests has not been tested for the thing most likely to break it in production: the integration with the payment gateway, and the authorisation check that decides who can call it. If a type from the table applies and is skipped, the reviewer needs a stated reason, not silence.

## Enforcement

Reviewed against `09-enforcement.md`'s checklists. A missing test type that applied is a review finding, not a nitpick: state which type was needed and why, per `01-principles.md` rule 7, and verify against the actual diff before asserting it's missing.
