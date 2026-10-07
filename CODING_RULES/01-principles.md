# Core Principles

[Back to AGENTS.md](../AGENTS.md) • [Back to 09-enforcement.md](09-enforcement.md) • [Back to 13-testing-strategy.md](13-testing-strategy.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to GITFLOW.md](../documentation/GITFLOW.md)

Always load this file.

## Code quality

- **Clean Code** - code documents itself. Naming and structure carry intent; comments explain *why*, not *what*.
- **DRY** - no duplicated logic. Extract, don't copy.
- **KISS** - the simplest design that satisfies the requirement wins over the cleverest one.
- **SOLID**, for object-oriented design:
  - Single responsibility - one reason to change per class.
  - Open/closed - extend behaviour without modifying existing code.
  - Liskov substitution - a subtype must work anywhere its base type is expected.
  - Interface segregation - small, specific interfaces over large general ones.
  - Dependency inversion - depend on abstractions, not concretions.
- Favour clarity over cleverness. If a reviewer has to pause to decode it, it's too clever.

## Development methodology

- **TDD** for all non-trivial business logic: write the test first, run it and confirm it fails for the expected reason (RED), write the minimum code to pass it (GREEN), then refactor with the suite passing. Only pure configuration and one-line passthroughs are exempt, each marked with a `TDD-Exempt: <reason>` commit trailer that a reviewer approves.
- **BDD** for user-facing features: describe the behaviour from the user's perspective before implementing.
- **DDD** for backend systems: model the domain's language and boundaries in code, not just in the database schema. For auditing whether similar-looking logic across sibling modules is real duplication or legitimate per-context divergence, see `12-domain-duplication-audit.md`.
- No untested code in critical paths (payments, auth, data mutation).
- Complex business logic gets its tests written before the implementation, not after.
- Observability is designed in at the start of a project or feature, not added after an incident, and stays in use through every phase after that. See `14-observability.md`.

## Enforcement

- Cyclomatic complexity: max 10 per function.
- No duplicated code blocks.

Full review checklist and severity levels: `09-enforcement.md`.
