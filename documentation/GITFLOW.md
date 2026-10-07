# Git flow

[Back to README.md](../README.md) • [Back to AGENTS.md](../AGENTS.md) • [Back to 10-commits-and-versioning.md](../CODING_RULES/10-commits-and-versioning.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to GIT.md](GIT.md) • [Back to SEMVER.md](SEMVER.md)

The model for this repository is trunk-based with one shared integration branch: `main` is always releasable, `feat-<name>`/`fix-<name>` work branches land (often daily) on `int` before the set of them goes to `main` as one reviewed change, `hotfix-<name>` branches carry an urgent production fix straight into `main` (and then into `int`), and `release/<major>.x` branches carry maintenance fixes for a line no longer on `main`. See "Naming conventions for commits" and "Workflow" in [`GIT.md`](./GIT.md): a Husky `commit-msg` hook enforces Conventional Commits locally, and branch naming, approvals, signing, and the allowed source of merges into `main` are enforced server-side by the rulesets in [`.github/rulesets/`](../.github/rulesets/), not by a local hook.

![Git flow branch graph: feat- and fix- branches merge into int, int merges into main as one change, hotfix-urgent merges into main and then int, and release/1.x branches off main](images/gitflow-branches.svg)

A `feat-<name>`/`fix-<name>` branch is cut from `int` (or `main`), developed and reviewed in isolation, then merged into `int`. `int` merges into `main` as one reviewed change once its set of work is ready. `main` accepts merges only from `int` and from `hotfix-*` branches; the `allowed-merge-source` check blocks anything else. Work-branch PRs into `int` also pass the `tdd-order` check, which enforces test-first commit order (`CODING_RULES/01-principles.md`).

A `hotfix-<name>` branch is cut from `main`, tested, and merged into `main` directly, so the fix ships without waiting for whatever else is sitting in `int`. Then the same branch is merged into `int`, so the fix is not lost the next time `int` goes to `main`. Merging a hotfix into `int` does not release anything, since `int` never releases.

Neither merge into `main` is tagged by hand: pushing to `main` or a `release/**` branch runs `semantic-release` (`publish.yml`), which decides on its own whether a release is warranted and, if so, derives the version bump from the Conventional Commits it contains (per [`CODING_RULES/10-commits-and-versioning.md`](../CODING_RULES/10-commits-and-versioning.md)) and creates the tag itself. `int` never triggers a release. Full pipeline: [`DEPLOYMENT.md`](DEPLOYMENT.md).

A `release/<major>.x` branch is only for a major line that `main` has already moved past. Fixes for that line go into the `release/<major>.x` branch and never into `main`.
