# Commits & Versioning

[Back to AGENTS.md](../AGENTS.md) • [Back to CHANGELOG.md](../CHANGELOG.md) • [Back to 09-enforcement.md](09-enforcement.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to DEPLOYMENT.md](../documentation/DEPLOYMENT.md) • [Back to GIT.md](../documentation/GIT.md) • [Back to GITFLOW.md](../documentation/GITFLOW.md) • [Back to SEMVER.md](../documentation/SEMVER.md) • [Back to GOVERNANCE.md](../GOVERNANCE.md)

Load when writing a commit message or cutting a release.

This is the normative rule. The practical, day-to-day companions: `documentation/GIT.md` (hooks, signing setup, branch workflow), `documentation/GITFLOW.md` (the branch flow as a diagram), `documentation/SEMVER.md` (CHANGELOG.md mechanics), `documentation/DEPLOYMENT.md` (the release pipeline itself).

## Commit messages - Conventional Commits 1.0.0

Format:

```plaintext
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

- `type` is required. `feat` = a new feature. `fix` = a bug fix. Other types don't affect versioning on their own but are allowed and expected: `build`, `chore`, `ci`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`.
- `scope` is optional - a noun in parentheses naming the affected area: `feat(parser): add ability to parse arrays`.
- `description` is a short, imperative summary on the same line as the type.
- A breaking change is marked with `!` right before the colon (`feat(api)!: ...`), a `BREAKING CHANGE: <description>` footer, or both. It can ride on any type, not just `feat`.
- Footers follow git trailer format: `Token: value` or `Token #value`, tokens hyphenated (`Reviewed-by: Z`, `Refs: #123`). `BREAKING CHANGE` is the one token that keeps its space, and it must be uppercase.
- One logical change per commit. A change that's two types at once, a fix bundled with an unrelated feature, is two commits, not one.

Examples:

```plaintext
fix: prevent racing of requests

feat(lang): add Polish language

feat!: drop support for Node 6

BREAKING CHANGE: use JavaScript features not available in Node 6.
```

Mapping to version bump: `fix` → PATCH. `feat` → MINOR. A breaking change, on any type → MAJOR.

## Versioning - SemVer 2.0.0

Format `MAJOR.MINOR.PATCH` - non-negative integers, no leading zeroes, each increments numerically (`1.9.0 → 1.10.0 → 1.11.0`).

- **PATCH**: backward-compatible bug fix only.
- **MINOR**: backward-compatible new functionality, or deprecating part of the public API. Resets PATCH to 0.
- **MAJOR**: any backward-incompatible change to the public API. Resets MINOR and PATCH to 0.
- `0.y.z` is initial development: anything may change at any time, the public API isn't considered stable. Move to `1.0.0` once the software is in production with users depending on a stable API - don't linger in `0.y.z` past that point.
- A released version's contents are immutable. A fix to an already-shipped version is a new version, never an edit to the old one.
- Pre-release: hyphen plus dot-separated identifiers (`1.0.0-alpha`, `1.0.0-alpha.1`). Sorts below its normal version: `1.0.0-alpha < 1.0.0`.
- Build metadata: plus sign plus dot-separated identifiers (`1.0.0+20130313144700`). Ignored for precedence.

## Branches

- `main` - trunk. Always releasable; `publish.yml` cuts a normal release from every push here. Accepts merges only from `int` or `hotfix-*` (enforced by the `allowed-merge-source` required check). Squash merge only, one PR per logical change, 1 approving review plus code owner review.
- `release/<major>.x` or `release/<major>.<minor>.x` (e.g. `release/1.x`, `release/2.4.x`) - maintenance branches for a line that's no longer on `main`. `publish.yml` cuts a release scoped to that range (`release.config.js`'s second `branches` entry) - a differently-named release branch is invisible to semantic-release. Squash or rebase merge (rebase keeps a cherry-picked fix's original commit), 1 approving review plus code owner review. Never a route into `main`.
- `int` - shared integration branch. Where several `feat-*`/`fix-*` branches land before the set of them goes to `main` as one reviewed change. No strict up-to-date requirement (branches land here daily; forcing a rebase after every merge would be constant churn) and no code owner review (lower-stakes than `main` by design - review happens again when `int` itself goes to `main`). Squash or merge commit. Publishes nothing on its own.
- `feat-<name>` / `fix-<name>` - short-lived work branches, merged into `int`. Only signed commits are required; force-push, rebase, and delete freely. Protection lives on the branch being merged into, not here.
- `hotfix-<name>` - urgent production fix, cut from `main`. Merged into `main` directly so it ships without waiting for `int`, then merged into `int` so the fix isn't lost at the next `int` → `main`. Only signed commits are required, same as `feat-*`/`fix-*`.

Enforced server-side by the rulesets in `.github/rulesets/` (see that directory's `README.md` for the full rule reference and import steps), a `branch-naming` ruleset that blocks creating anything outside these patterns, and the `allowed-merge-source` required check (`.github/workflows/allowed-merge-source.yml`) that restricts which branches may merge into `main`.

## Enforcement

- Commit messages are linted against Conventional Commits before merge.
- A release's version bump is derived from the commits it contains, not chosen by hand: the highest of PATCH/MINOR/MAJOR implied by the commit types and any breaking-change markers present wins.
- `main` and `release/**` merge by squash only (or squash/rebase for `release/**`) - the squash commit's message, not the original commits', is what semantic-release reads. See `.github/rulesets/README.md`'s "Pull request titles" section for why the PR title has to carry the Conventional Commits format on these branches, and the required workflow that enforces it.
