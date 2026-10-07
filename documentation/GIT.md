# Rules for using Git repositories

[Back to README.md](../README.md) • [Back to AGENTS.md](../AGENTS.md) • [Back to 10-commits-and-versioning.md](../CODING_RULES/10-commits-and-versioning.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to DEPLOYMENT.md](DEPLOYMENT.md) • [Back to GITFLOW.md](GITFLOW.md) • [Back to TESTING.md](TESTING.md)

## What is Git?

Git is a distributed version control system (DVCS) that allows us to save our work and share it with our collaborators.

It differs from the older TFS, CVS or SVN in its "distributed" nature.\
This means that there is a local source repository on every machine in the system, and that the "central" repository is less rigorously defined, as opposed to the more traditional client/server operation.\
This provides greater security and flexibility, at the cost of slightly greater complexity.

## How does it work?

Here are two old well-done external articles on how Git works in general.\
Although a little long, we recommend that you read at least [Enfin comprendre Git](https://www.miximum.fr/blog/enfin-comprendre-git/), which is more generic, from end to end, in order to fully understand the issues involved in source sharing, and to better react in the event of a problem.\
[Git Rebase](https://www.miximum.fr/blog/git-rebase/) deals with rebase: a rather specific operation that simplifies the history of commits on a repository. It is optional, and more reserved for users with a little more experience.

## Naming conventions for commits

### Commit comments

Commit messages follow **Conventional Commits 1.0.0** (`<type>[optional scope]: <description>`), mapped to SemVer: `fix` → PATCH, `feat` → MINOR, a breaking change (`!` or a `BREAKING CHANGE:` footer, on any type) → MAJOR. Full format, examples, and the version-bump mapping: [`CODING_RULES/10-commits-and-versioning.md`](../CODING_RULES/10-commits-and-versioning.md).

A Husky `commit-msg` hook (`.husky/commit-msg`, one line: `pnpm exec commitlint --edit "$1"`) enforces this Conventional Commits format locally, against `commitlint.config.js`'s `@commitlint/config-conventional` preset. `.husky/pre-commit` runs `lint-staged` (Biome, `.lintstagedrc.json`), `pnpm run backlinks:check` (stale Markdown back-link lines; fix with `pnpm run backlinks:generate`), and a full-repo `pnpm run typecheck`; it does not check branch names.

Local hooks are fast feedback, not enforcement - anyone can skip them with `--no-verify` or `HUSKY=0`. What actually blocks a bad push is server-side: CI's `lint-commits` job (`.github/workflows/ci.yml`) re-runs `commitlint` over a pull request's full commit range, so a commit made with `--no-verify` still gets caught before merge. On `feat-*`/`fix-*` PRs into `int`, the `tdd-order` job also checks test-first commit order. Because `main`/`release/**` only accept squash merges, `pr-title.yml` separately lints the **PR title** - the squash commit's actual message - as its own required check. Full detail: [`DEPLOYMENT.md`](DEPLOYMENT.md#commit-message-enforcement).

`.husky/pre-commit` runs `gitleaks git --pre-commit --staged` ahead of `lint-staged`, so a secret in staged code is caught locally before it's committed; GitHub's server-side secret-scanning push protection remains the backstop for anything that slips past (`--no-verify`, `HUSKY=0`, or a machine without `gitleaks` installed). `pnpm test` runs Vitest only (no coverage threshold is configured in `vitest.config.ts`); Prettier/ESLint aren't part of this toolchain - lint and format are both Biome (`pnpm run lint`, `pnpm run format`). See [`TESTING.md`](TESTING.md) for the full local/CI test command set.

### Signed commits

Every ruleset in `.github/rulesets/` requires signed commits (and tags, on `tags.json`) - enforced server-side via GitHub's `required_signatures` rule, not by a local script or a CI job that re-verifies signatures. There's no `allowed_signers`-style allowlist file in this repo; GitHub checks the signature against whatever key the committer has registered as a **Signing key**.

To sign your commits in this repository:

1. Configure git, per clone (not globally, so it doesn't affect your other projects):

   ```sh
   git config user.signingkey ~/.ssh/<your-signing-key>.pub
   git config gpg.format ssh
   git config commit.gpgsign true
   git config tag.gpgsign true
   ```

2. Add the same public key to GitHub under Settings → SSH and GPG keys → "New SSH key", key type **Signing key** - not "Authentication key"; the two are registered separately even for the same key pair. Until this is done, commits sign locally but still show "Unverified" on GitHub.

Full picture, including the release automation's own signing exemption: [`DEPLOYMENT.md`](DEPLOYMENT.md#commit-signing) and [`.github/rulesets/README.md`](../.github/rulesets/README.md).

## Workflow

[GIT FLOW](./GITFLOW.md)

Branch model (full detail, including why each rule exists: [`CODING_RULES/10-commits-and-versioning.md`](../CODING_RULES/10-commits-and-versioning.md)'s Branches section and [`.github/rulesets/README.md`](../.github/rulesets/README.md)):

- **`main`**: the trunk. Always releasable; every push here is evaluated for a release by `semantic-release`. Accepts merges only from `int` or `hotfix-*`. Squash merge only, 1 approval plus code owner review.
- **`release/<major>.x`** (e.g. `release/1.x`): maintenance branch for a release line no longer on `main`. Squash or rebase merge, same review bar as `main`. Never a route into `main`.
- **`int`**: shared integration branch. Where several `feat-*`/`fix-*` branches land, often daily, before the set of them goes to `main` as one reviewed change. Lighter bar than `main`: no strict up-to-date requirement, no code owner review. Publishes nothing on its own.
- **`feat-<name>` / `fix-<name>`** (hyphen, not slash): short-lived work branches, cut from `main` or `int`, merged into `int`. Only signed commits are required - force-push, rebase, and delete freely; protection lives on the branch being merged into, not here.
- **`hotfix-<name>`** (hyphen, not slash): urgent production fix, cut from `main`. Merged into `main` directly, then the same branch is merged into `int`. Only signed commits are required, same as `feat-*`/`fix-*`.

All of this - branch naming, signed commits, approvals, who can bypass what, which branches may merge into `main`, and test-first order on `feat-*`/`fix-*` PRs into `int` - is enforced server-side by the rulesets in `.github/rulesets/` and the `allowed-merge-source` check (see that directory's `README.md` for the full rule reference and import steps), not just reviewed in a PR. A `branch-naming` ruleset rejects creating anything outside these patterns; `.husky/pre-push` mirrors the same check locally, on push rather than on creation, so a bad branch name fails fast before it reaches the server-side rule.

### Long-term work (separate branch)

In the particular case where a ticket requires long-term work on a separate branch, to avoid conflicts it is possible to rebase your work branch onto its parent branch, so that any conflicts can be dealt with as they arise.\
This is optional, but it avoids having to process a large number of conflicts at once, and therefore limits human error and the loss of other collaborators' modifications.

The process is quite simple, and resembles the part above but in reverse:

1. Go to the parent branch of your development branch: `git switch main` (or `int`, if that's what your `feat-`/`fix-` branch was cut from).
2. Get the latest version of the code: `git pull`
3. Go to your working branch: `git switch feat-<name>` (or `fix-<name>`).
4. Merge your work into this branch: `git rebase <parent_branch>`
5. Correct any conflicts and continue the rebase: `git rebase --continue`
6. Continue development as normal
7. Commit your work
8. Push your codebase: `git push --force-with-lease origin feat-<name>`. The rebase rewrote your branch's history, so a plain push is rejected. `--force-with-lease` overwrites the remote branch only if nobody else pushed to it since your last fetch - and is explicitly allowed on `feat-*`/`fix-*` branches, per the ruleset table above.

This operation can be performed once a day to keep your code up to date.\
At any moment, you can perform a `git rebase --abort` command to cancel your operations.\

**/!\\ NOTE**: Sometimes it's easier to squash commits before rebasing, to manage conflicts more easily.
