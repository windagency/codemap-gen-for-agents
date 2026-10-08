# Contributing

[Back to README.md](README.md) • [Back to AGENTS.md](AGENTS.md) • [Back to 14-observability.md](CODING_RULES/14-observability.md) • [Back to 0031-zod-confined-to-schema-modules.md](documentation/adr/0031-zod-confined-to-schema-modules.md) • [Back to TESTING.md](documentation/TESTING.md) • [Back to GOVERNANCE.md](GOVERNANCE.md) • [Back to NEXT_STEPS.md](NEXT_STEPS.md)

This repository is built and maintained by AI agents and human engineers working side by side. Every change, whoever writes it, is held to the same bar.

The rules live in `CODING_RULES/`, split by concern so an agent only has to load what the current task touches. This file is the router: read it first, then pull in the specific rule files below.

For how an agent should behave and communicate while doing this work, not what the code should look like, see `AGENTS.md`. It's read automatically at the start of every agent session; this file is not.

## Before you write any code

1. Confirm the task and its success criteria. If they are not defined, define them before writing code.
2. Write the test first for any non-trivial business logic (TDD), and run it to confirm it fails before writing the implementation. See `CODING_RULES/01-principles.md`.
3. Load only the rule files relevant to the files you are about to touch, using the table below.
4. Touch only what the task requires. Do not refactor unrelated code in the same change.

## Before you push

These are enforced server-side by this repo's GitHub rulesets (`.github/rulesets/`), not just reviewed in a PR - get them wrong and the push itself is rejected, not just flagged in review:

- **Branch name** must be `feat-<name>`, `fix-<name>`, or `hotfix-<name>` (or `int`/`release/<major>.x` for release-flow work). Only `int` and `hotfix-*` may open a PR into `main` - `feat-*` and `fix-*` go into `int` first. See `CODING_RULES/10-commits-and-versioning.md`'s Branches section for the full model, and `documentation/GITFLOW.md` for how it fits together visually.
- **Commits must be signed** (SSH or GPG) - see `documentation/GIT.md`'s "Signed commits" section for setup.
- **On `main`/`release/**`, the PR title itself must be a valid Conventional Commit** (`CODING_RULES/10-commits-and-versioning.md` has the exact format). These branches squash-merge, so the PR title - not your individual commit messages - becomes the commit semantic-release actually reads.

## Rule files and when to load them

| You are editing…                                                                       | Load                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Anything, always                                                                       | `CODING_RULES/01-principles.md`, `CODING_RULES/02-language-convention.md` |
| `.ts` / `.tsx` source - naming, types, control flow                                    | `CODING_RULES/03-typescript.md`                                           |
| Module boundaries, DI, repositories, domain workflows                                  | `CODING_RULES/04-architecture.md`                                         |
| API routes, controllers, services, DB access                                           | `CODING_RULES/05-backend-api.md`                                          |
| CSS, design tokens, layout, accessibility                                              | `CODING_RULES/06-frontend.md`                                             |
| React components, hooks, forms, state                                                  | `CODING_RULES/07-react.md`                                                |
| Error handling, retries, external calls                                                | `CODING_RULES/08-resilience.md`                                           |
| Opening or reviewing a PR                                                              | `CODING_RULES/09-enforcement.md`                                          |
| Writing a commit message, cutting a release                                            | `CODING_RULES/10-commits-and-versioning.md`                               |
| Writing or updating any documentation, or finishing a task                             | `CODING_RULES/11-documentation.md`                                        |
| Auditing sibling modules/directories for duplicated domain logic                       | `CODING_RULES/12-domain-duplication-audit.md`                             |
| Deciding what tests a change needs, or writing tests                                   | `CODING_RULES/13-testing-strategy.md`                                     |
| Starting a project/service/feature, or touching logs, metrics, tracing                 | `CODING_RULES/14-observability.md`                                        |
| Choosing a CLI command, or wanting the rationale behind AGENTS.md's tool substitutions | `CODING_RULES/15-shell-tooling.md`                                        |

The two "always" files are kept short by design. Everything else is scoped to one concern so it can be left out of context when it isn't relevant to the task.

## Non-negotiables (CRITICAL - a PR with any of these is blocked)

- No `any` without an inline comment justifying it.
- All external input validated with Zod before use.
- No direct third-party library imports outside an `adapters/` wrapper.
- No architectural rule shipped without a matching `arch-unit-ts` (or an equivalent architecture-boundary test - see `src/__tests__/architecture/dependency-direction.test.ts` for this repo's substitute) test.
- No secrets, tokens, or credentials committed in code, config, or comments.

Full severity table: `CODING_RULES/09-enforcement.md`.

## Definition of done

- [ ] Lint and format (Biome) pass with no warnings suppressed inline without justification.
- [ ] Type-check passes with no new `any`.
- [ ] The test types this change actually needs are present, not unit tests by default (`CODING_RULES/13-testing-strategy.md`; this repo's actual seams: `documentation/TESTING.md`).
- [ ] `arch-unit-ts` (or this repo's substitute, `src/__tests__/architecture/dependency-direction.test.ts`) tests pass for any touched module boundary.
- [ ] Stylelint passes for any touched CSS.
- [ ] New or changed behaviour is observable: logs, metrics, or traces added per `CODING_RULES/14-observability.md`.
- [ ] Documentation affected by this change is updated, following `CODING_RULES/11-documentation.md` - this is checked at the end of every run, not deferred.
- [ ] Commit messages follow Conventional Commits, and any release version bump matches its SemVer impact (`CODING_RULES/10-commits-and-versioning.md`). On `main`/`release/**`, the PR title is what's checked and what lands - see "Before you push" above.
- [ ] For non-trivial business logic, the test was written and seen to fail before the implementation, and `tdd-order` passes on `feat-*`/`fix-*` PRs into `int` (`CODING_RULES/01-principles.md`).
- [ ] The relevant checklist in `CODING_RULES/09-enforcement.md` has been reviewed.

## Required tooling

Biome (lint + format), TypeScript, `arch-unit-ts` (or an equivalent architecture-boundary test - see `src/__tests__/architecture/dependency-direction.test.ts` for this repo's substitute), Husky, Vitest or Playwright, Zod, Stylelint, commitlint (`CODING_RULES/10-commits-and-versioning.md`'s Conventional Commits rule, enforced via a Husky `commit-msg` hook and in CI on pull requests), gitleaks (secret scanning in `.husky/pre-commit` and as a required CI check on every PR), semantic-release (derives the release version from commit history, per the same file's Enforcement section), SSH or GPG commit signing (`documentation/GIT.md`'s "Signed commits" section for setup - required server-side by every GitHub ruleset in `.github/rulesets/`, not optional). Full required and recommended lists: `CODING_RULES/09-enforcement.md`. This repo's actual test seams, fixtures, and commands: `documentation/TESTING.md`.

## Scope note

These rules assume a TypeScript / Node / React stack, because that is what the source guidelines describe. If this factory also generates code in other languages, the language-neutral files (`01`, `02`, `08`, `09`, `10`, `11`, `12`, `13`, `14`, `15`) still apply in principle, though `13`'s and `14`'s named tools (Vitest, Playwright, `vitest-axe`, OpenTelemetry) are stack-specific; `03`, `06`, `07` do not apply at all. Add an equivalent per-language rule file rather than stretching these to fit.
