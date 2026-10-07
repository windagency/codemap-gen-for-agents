# Branch rulesets and commit security

[Back to 10-commits-and-versioning.md](../../CODING_RULES/10-commits-and-versioning.md) • [Back to CONTRIBUTING.md](../../CONTRIBUTING.md) • [Back to DEPLOYMENT.md](../../documentation/DEPLOYMENT.md) • [Back to GIT.md](../../documentation/GIT.md) • [Back to GITFLOW.md](../../documentation/GITFLOW.md)

Six GitHub repository rulesets, plus the local and CI tooling that backs them.

| File | Targets | Purpose |
| --- | --- | --- |
| `main.json` | Default branch | Production code. Strictest rules. Accepts merges only from `int` or `hotfix-*` (via the `allowed-merge-source` check). |
| `release.json` | `release/**/*` | Maintenance releases for an old major line. |
| `integration.json` | `int` | Shared branch where work meets. |
| `feature.json` | `feat-*`, `fix-*`, `hotfix-*` | Short-lived work branches. |
| `branch-naming.json` | Everything else | Blocks creation of unapproved branch names. |
| `tags.json` | `v*` | Release tags - blocks deletion and moving an existing tag. |

## Before you import

1. **Check the required status checks.** `main`, `release` and `integration` require `verify`, `lint-commits` and `gitleaks` (`ci.yml`) and `Validate PR title` (`pr-title.yml`). `main.json` also requires `allowed-merge-source` (`allowed-merge-source.yml`), and `integration.json` also requires `tdd-order` (`ci.yml`). A required name that no workflow reports blocks every merge, so import `main.json` only after `allowed-merge-source` has reported a green run on a `main`-targeting PR, and `integration.json` only after `tdd-order` has reported on an `int`-targeting PR.
2. **Add a `CODEOWNERS` file.** `main` and `release` require code owner review. Without the file, that rule has no effect.
3. **Check your plan.** Private repositories need GitHub Pro, Team or Enterprise Cloud. On Free, rulesets apply to public repositories only.
4. **Check your automation.** All work rulesets require signed commits. Bots that push unsigned commits will be rejected.

## How to import

Settings, Rules, Rulesets, New ruleset, Import a ruleset. Repeat per file.

Then add bypass actors in the UI - GitHub excludes bypass lists from ruleset JSON, so this is a manual step every time a ruleset is (re-)imported. Two different actors, two different modes, and conflating them is the most common way to weaken these rulesets by accident:

- **A human maintainer** (repository admin role), mode **pull request only**. Lets an admin merge their own already-reviewed PR without needing a second approver. Never use **always** for a human actor - that allows direct, unreviewed pushes.
- **The release automation** (this repo's dedicated release GitHub App, picked by name under "GitHub Apps"), mode **always**, on `main.json`, `release.json` and `tags.json` only. This one *has* to be "always": the version-bump commit and the release tag are pushed outside any pull request, so "pull request only" would reject them. It has to be an App: the bypass list doesn't offer the GitHub Actions identity behind `GITHUB_TOKEN` at all. Know what this costs: "always" bypasses every rule in that ruleset for anything holding a token for that App - which is why its private key lives only in `publish.yml`'s secrets, and why the App must not be reused for anything else. Setup: `documentation/DEPLOYMENT.md`, "Required one-time setup".

Consider switching enforcement to **Evaluate** for the first week. Violations are logged but not blocked.

## Rule reference

| Rule | main | release | int | feat, fix, hotfix | tags |
| --- | --- | --- | --- | --- | --- |
| Block deletion | Yes | Yes | Yes | No | Yes |
| Block force push / move | Yes | Yes | Yes | No | Yes |
| Linear history | Yes | Yes | No | No | n/a |
| Signed commits/tags | Yes | Yes | Yes | Yes | Yes |
| Pull request required | Yes | Yes | Yes | No | n/a |
| Approvals | 1 | 1 | 1 | None | n/a |
| Code owner review | Yes | Yes | No | No | n/a |
| Dismiss stale approvals | Yes | Yes | Yes | No | n/a |
| Last push must be approved | Yes | Yes | Yes | No | n/a |
| Resolve review threads | Yes | Yes | Yes | No | n/a |
| Merge methods | Squash | Squash, rebase | Squash, merge | Any | n/a |
| Status checks | Strict | Strict | Not strict | None | n/a |
| Checks on branch creation | Yes | Skipped | Yes | None | n/a |
| Allowed source branch | `int`, `hotfix-*` (via `allowed-merge-source` check) | Any | Any | n/a | n/a |

Approvals are 1, not a larger number, on every branch that requires them here - matched to a single maintainer with a documented path to a co-maintainer, not a team of several reviewers. Raise it once there's more than one person actually reviewing.

## Ruleset design decisions

### main

Squash only keeps one commit per change. History stays readable and easy to revert. Strict checks mean the branch must be up to date before merging. What was tested is exactly what lands.

Only `int` and `hotfix-*` may merge into `main`. GitHub rulesets have no native rule that restricts a pull request's source branch, so `allowed-merge-source` does it: a required check that fails unless the head branch is `int` or `hotfix-<name>` from this repository. This keeps batched work going through `int`, while still letting an urgent fix ship without waiting for `int`'s unrelated commits. The check is a routing guard, not a security boundary. Review and signed commits remain the actual gate.

### release

Mirrors `main`, as release code is about to ship. Rebase is allowed so cherry-picked fixes keep their original commits. Checks are skipped on creation, so a branch can be cut from a known good commit. Used only for maintenance of an old major line, never as a route into `main`.

### int

Several branches merge here each day. Strict up-to-date checks would force a rebase after every merge. That churn is costly, so it is off. Merge commits are allowed to preserve history before it reaches `main`.

### feat-\*, fix-\* and hotfix-\*

Signed commits only. Work branches are rebased, force-pushed and deleted as normal practice. Blocking that adds friction without protecting anything. Protection belongs on the branch being merged into.

`feat-*` and `fix-*` merge into `int`. `hotfix-*` is cut from `main`, merges into `main` directly, and then merges into `int` as well, so `int` gets the fix without pulling in its unrelated pending commits.

### tags

Blocks deleting or moving a `v*` tag once it exists - creation is left open, since the release automation needs to create new ones. Without this, a release tag can be quietly repointed after the fact, which breaks the exact guarantee npm provenance exists to give: that the published package traces back to one specific, unaltered commit. Requires signed tags for the same reason `main` requires signed commits; the release automation's bypass actor (see "How to import") covers the one tag it creates without a human pushing it.

### branch-naming

Uses the `creation` rule on every branch not explicitly allowed. Only bypass actors can create those. This is the only server-side way to enforce naming on every plan.

Two exclusions exist for GitHub's own tooling:

- `dependabot/**/*` for Dependabot update branches.
- `revert-*` for the Revert button on merged pull requests.

Add more if you use Renovate, Copilot agents or similar bots.

## Local hooks are not security

Read this before the tooling sections.

Git hooks run on the developer's machine. Anyone can skip them with `git commit --no-verify` or `HUSKY=0`. Treat hooks as fast feedback, not enforcement. Every rule that matters must also run on GitHub.

| Concern | Local feedback | Server enforcement |
| --- | --- | --- |
| Commit message format | commitlint in `commit-msg` | PR title check, required status |
| Branch names | `pre-push` script | `branch-naming.json` ruleset |
| Source branch into `main` | None | `allowed-merge-source` required check |
| Secrets | gitleaks in `pre-commit` | Secret scanning push protection |
| Code quality | lint-staged in `pre-commit` | `verify` required check (lint, test, build) |
| Test-first order | None | `tdd-order` required check on `feat-*`/`fix-*` pull requests into `int` |
| Signed commits | `commit.gpgsign` | `required_signatures` rule |
| Versioning | None | semantic-release in CI |

## Tooling setup

Requires Node.js. semantic-release 25 needs Node `^22.14.0` or `>=24.10.0`.

```sh
npm install --save-dev husky @commitlint/cli @commitlint/config-conventional semantic-release
npx husky init
```

`husky init` creates `.husky/pre-commit` and adds `"prepare": "husky"` to `package.json`. Hooks install automatically on `npm install`.

### Commit messages with commitlint

Enforces Conventional Commits. semantic-release relies on this format to pick the next version.

`commitlint.config.mjs`:

```js
export default { extends: ['@commitlint/config-conventional'] };
```

`.husky/commit-msg`:

```sh
npx --no -- commitlint --edit "$1"
```

Accepted types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` and `test`.

### Pull request titles

This matters more than local commit linting.

`main` only allows squash merges. A squash commit message comes from the pull request, not from the original commits. A clean branch history can still land a badly formatted commit on `main`. semantic-release would then miss the release.

Set the squash commit message to use the pull request title. Settings, General, Pull Requests, Allow squash merging, Default commit message.

Then lint titles in CI. `.github/workflows/pr-title.yml`:

```yaml
name: Lint PR

on:
  pull_request_target:
    types: [opened, reopened, edited, synchronize]

jobs:
  main:
    name: Validate PR title
    runs-on: ubuntu-latest
    permissions:
      pull-requests: read
    steps:
      - uses: amannn/action-semantic-pull-request@48f256284bd46cdaab1048c3721360e808335d50 # v6
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Add `Validate PR title` to the required status checks in `main.json`, `release.json` and `integration.json`.

### Branch names on push

Mirrors the `branch-naming` ruleset locally. Developers find out before the push is rejected.

`.husky/pre-push`:

```sh
pattern='^(main|int|release/[0-9]+(\.[0-9]+)?\.x|(feat|fix|hotfix)-[a-z0-9._-]+|dependabot/.+|revert-.+)$'
zero='0000000000000000000000000000000000000000'

while read -r local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "$zero" ] && continue
  case "$remote_ref" in
    refs/heads/*) branch="${remote_ref#refs/heads/}" ;;
    *) continue ;;
  esac
  if ! printf '%s\n' "$branch" | grep -Eq "$pattern"; then
    echo "Branch '$branch' does not match naming rules." >&2
    echo "Use feat-<name>, fix-<name>, or hotfix-<name>." >&2
    exit 1
  fi
done
```

Branch deletions and tags are skipped. Names must be lowercase. Release branches must follow the `release/1.x` or `release/1.2.x` form required by semantic-release.

### Secrets and staged code

`.husky/pre-commit`:

```sh
gitleaks git --pre-commit --staged
npx lint-staged
```

gitleaks is a Go binary, not an npm package. Install it per machine. Without it, the hook fails.

lint-staged is optional and depends on your stack. Install it and configure it per its own documentation.

Also enable secret scanning push protection in the repository security settings. It rejects pushes containing known secret formats on the server. Availability on private repositories depends on your plan.

### Signed commits

Every ruleset here requires signatures. SSH signing is the simplest option.

```sh
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
git config --global tag.gpgsign true
```

Upload the same public key to GitHub as a **signing key**. An authentication key alone is not enough.

Commits created by GitHub, such as squash merges, are signed by GitHub automatically.

### Releases with semantic-release

`.releaserc.json`:

```json
{
  "branches": [
    "main",
    {
      "name": "release/+([0-9])?(.{+([0-9]),x}).x",
      "range": "${name.replace(/^release\\//, '')}"
    }
  ],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/github"
  ]
}
```

`main` publishes normal releases. A branch such as `release/1.x` publishes `1.x` patch and minor releases only. semantic-release requires the version range in the branch name. Free-form names such as `release/hotfix` are ignored.

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches:
      - main
      - 'release/**'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npx semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Add `@semantic-release/npm` to the plugins only if you publish to a registry.

#### Do not commit back to protected branches

Prefer dropping `@semantic-release/git`. It pushes a version commit straight to `main`. These rulesets block that push, as it has no pull request and no signature. The plugin's own README advises against it. Without it, semantic-release only pushes a tag and creates a GitHub release - and `tags.json` above means that tag push isn't exempt either, so it still needs the release automation's bypass actor, just a narrower one (no commit-signing or PR exemption on `main`/`release` to worry about, only the tag ruleset).

This repo keeps `@semantic-release/git` anyway, so the version in `package.json` and `CHANGELOG.md` stay current on `main`. Know what that trades: the "always" bypass actor on `main.json`/`release.json` doesn't just let the version-bump commit through, it exempts anything holding the release App's token from every rule in that ruleset - signed commits included. `GITHUB_TOKEN` can't be that actor at all (the bypass list has no entry for it), so the bypass is tied to a dedicated GitHub App instead, which also keeps the blast radius small:

- Only `publish.yml` holds the App's private key, and it mints the token in the step right before `semantic-release`, so no other workflow or earlier step can use the exemption.
- Settings, Actions, General, Workflow permissions stays **read-only** repo-wide, and `publish.yml` keeps `GITHUB_TOKEN` at `contents: read`, so no workflow's default token can push to a protected branch either.

## Known limitations

- `feat-*`, `fix-*` and `hotfix-*` do not match nested names such as `feat-auth/login`. In GitHub patterns, `*` stops at `/`.
- `allowed-merge-source` checks the head branch name, not who authored it. Anyone with write access can create a branch named `hotfix-x` and open a PR into `main`. Review and the required-signatures rule are what stop an unreviewed change from landing.
- `int` does not publish prereleases. Add it to the semantic-release `branches` with `prerelease` if you need them.
- The release App's bypass on `main`/`release`/`tags` is scoped to whoever holds its private key, not to one workflow file. Keeping that key in `publish.yml`'s secrets only is what scopes it in practice - see "Do not commit back to protected branches".
- Action versions in this project's workflows are pinned to a commit SHA (with a version-tag comment), not a mutable tag, specifically because the release workflow holds an npm publish token and push access - a moved tag on `actions/checkout`, `pnpm/action-setup` or similar would run attacker code with both. Re-pin when bumping versions; don't revert to a bare `@v4`-style tag for convenience.
