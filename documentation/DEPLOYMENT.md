# Deployment

[Back to README.md](../README.md) • [Back to .github/rulesets/README.md](../.github/rulesets/README.md) • [Back to AGENTS.md](../AGENTS.md) • [Back to 10-commits-and-versioning.md](../CODING_RULES/10-commits-and-versioning.md) • [Back to GIT.md](GIT.md) • [Back to GITFLOW.md](GITFLOW.md) • [Back to SEMVER.md](SEMVER.md) • [Back to TESTING.md](TESTING.md)

Releases are commit-driven, not hand-chosen: nobody edits `package.json`'s version, tags a commit, or runs `npm publish` directly. Every push to `main` or a `release/**` maintenance branch is evaluated by [semantic-release](https://semantic-release.gitbook.io/), which decides whether a release is warranted and, if so, performs the release - version bump, changelog, git tag, GitHub Release, and staging the package on npm. The one human step is approving that staged version with 2FA (see Staged publishing below); nothing is installable from npm before that. See [`CODING_RULES/10-commits-and-versioning.md`](../CODING_RULES/10-commits-and-versioning.md) for the Conventional Commits / SemVer policy this automates, that file's Branches section for what `release/**` is for, and [`GIT.md`](GIT.md)/[`SEMVER.md`](SEMVER.md) for the day-to-day contributor side of the same rules (hooks, signing setup, CHANGELOG.md mechanics).

## Pipeline overview

![Pipeline overview: pushing or opening a PR against main, release/**, or int runs ci.yml's verify and lint-commits jobs plus pr-title.yml's Validate PR title check; feat-/fix- PRs into int also run ci.yml's tdd-order job; PRs into main also run allowed-merge-source.yml's check; merging into main or release/** triggers publish.yml, which re-runs verify then runs semantic-release, forking into npm registry, GitHub Release, and a version-bump git commit; merging into int produces no release](images/deployment-pipeline.svg)

`publish.yml` always re-runs the full `verify` suite before releasing - a green PR merge isn't trusted as a release gate on its own, since `main` could in principle move between the PR's last CI run and the merge.

See `CODING_RULES/10-commits-and-versioning.md`'s Branches section for what `main`, `release/**`, and `int` are each for.

## Commit message enforcement

A release's shape depends entirely on well-formed commit messages, so malformed ones are rejected before they can reach `main`:

- **Locally**: a Husky `commit-msg` hook (`.husky/commit-msg`) runs `commitlint` against every commit message, using `commitlint.config.js` (`@commitlint/config-conventional`).
- **In CI**: `ci.yml`'s `lint-commits` job re-runs `commitlint` over the full commit range of a pull request, so a commit made with `--no-verify` or from a client that skips local hooks still gets caught before merge.
- **Test-first order**: on `feat-*`/`fix-*` pull requests into `int`, `ci.yml`'s `tdd-order` job checks that each implementation commit follows a test-only commit whose new tests fail when run at that commit. It is a required check on `int` (`.github/rulesets/integration.json`). Exemptions use a `TDD-Exempt:` trailer that a reviewer approves.
- **The PR title, separately**: `main` and `release/**` only accept squash merges (`.github/rulesets/main.json`, `release.json`), so the squash commit's message is the PR title, not any of the original commits. `pr-title.yml` lints the title itself (via `amannn/action-semantic-pull-request`) as its own required check, `Validate PR title` - the two commit-level checks above can pass while the title that actually lands is still malformed, which is exactly the gap this check closes. Requires the repo's "Allow squash merging" default commit message setting to be "Pull request title" (Settings → General → Pull Requests) - otherwise the title being linted isn't the one that ends up as the commit.

## Release decision

`semantic-release`'s plugin pipeline (configured in [`release.config.js`](../release.config.js)), run in this fixed order:

![Release decision: commit-analyzer maps fix to patch, feat to minor, a breaking-change marker on any type to major, and everything else to no release; its verdict gates release-notes-generator, changelog, npm, git, and github, run in that order](images/deployment-release-decision.svg)

The `releaseRules` in `release.config.js` spell out the same mapping `CODING_RULES/10` documents in prose (`fix` → PATCH, `feat` → MINOR, a breaking-change marker on any type → MAJOR); every other Conventional Commits type (`build`, `chore`, `ci`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`) is explicitly marked as not release-triggering, so a docs-only or refactor-only push to `main` or `release/**` runs the full pipeline and simply produces no release.

## Staged publishing

npm only accepts staged publishes for this package: its Trusted Publisher (repository `windagency/codemap-gen-for-agents`, workflow `publish.yml`, environment `npm`) has neither "publish directly" nor "manage dist-tags" enabled, so `npm stage publish` is the one action CI can take. `release.config.js` sets `@semantic-release/npm` to `npmPublish: false` - it still writes the version into `package.json` and packs the tarball into `release-tarball/` - and `@semantic-release/exec` runs `npm stage publish <tarball> --provenance --tag <channel or latest>`. The npm CLI authenticates through OIDC; there is no npm token anywhere in the pipeline.

A staged version is not installable until a maintainer approves it with 2FA, either `npm stage approve <stage-id>` or the package's Staged Packages tab on npmjs.com. The stage ID is a UUID, not `package@version`: the Publish run's log prints it (`staged with id <uuid>`), and `npm stage list @windagency/codemap-gen-for-agents` lists pending ones. `npm stage view <stage-id>` shows a staged version before approving; `npm stage reject <stage-id>` drops it. The GitHub Release and the `v<version>` tag already exist by then, so approve (or reject) promptly: until approval, npm `latest` still points at the previous version. Staging is what keeps a compromised dependency or Action in the Publish job from shipping a release on its own - it can stage, never publish.

## npm provenance

`package.json`'s `publishConfig.provenance: true` and `npm stage publish --provenance`, together with `publish.yml`'s `id-token: write` permission, attach a provenance attestation to the published package - a verifiable, tamper-evident link from the npm tarball back to this exact GitHub Actions run and commit. This requires the repository to be public; provenance cannot be generated from a private repo.

## Commit signing

Commits pushed to this repository should be signed, so GitHub shows them as "Verified" rather than attributing them to an unauthenticated name/email pair:

![Commit signing: a local commit is signed per the repo's gpg.format, commit.gpgsign, and user.signingkey config, pushed to GitHub, which checks the signature against the committer's registered Signing Key and shows either Verified or Unverified](images/deployment-commit-signing.svg)

Setup steps (per repository clone, not global) live in [`GIT.md`](GIT.md#signed-commits) - this section covers only why it matters for releases: a release's version-bump push and tag creation happen outside any pull request, so every ruleset in `.github/rulesets/` requiring `required_signatures` would reject them the same as any other unsigned push, if not for the release automation's own bypass actor (see Required one-time setup below).

## Release environment and SBOM

`publish.yml`'s job runs in the `npm` GitHub Environment, whose deployment branches are `main` and `release/**` only. npm's Trusted Publisher for the package names that environment, so a publish credential is only issued to a run that passed the branch policy. Before semantic-release runs, `anchore/sbom-action` (syft, pinned) writes a CycloneDX SBOM of the repository's dependency manifests (`.github/syft.yaml` excludes `fixtures/`, `node_modules/` and `dist/`), and `@semantic-release/github` attaches it to the GitHub Release as an asset. It covers the whole lockfile, dev tooling included; the npm tarball's own build provenance is the provenance attestation above.

## Required one-time setup

- **npm Trusted Publisher** on the package (npmjs.com → package Settings → Trusted Publisher): GitHub Actions, repository `windagency/codemap-gen-for-agents`, workflow `publish.yml`, environment `npm`, with "publish directly" and "manage dist-tags" left unchecked so only staged publishes are allowed. No `NPM_TOKEN` secret: a token able to publish directly would bypass the 2FA approval that staging exists for.
- **A registered signing key** per maintainer, per the previous section - otherwise that maintainer's commits push and release fine, just unsigned/unverified.
- **A release GitHub App, on the bypass list of the `main`, `release`, and `tags` rulesets**, mode "Always" (see `.github/rulesets/README.md`). Without it, the rulesets reject the release: `semantic-release`'s version-bump push and tag creation happen outside any pull request and (for the push) unsigned, which `required_signatures`/`pull_request` rules block exactly as designed. The default `GITHUB_TOKEN` can't fill this role: GitHub's ruleset bypass list accepts roles, teams, GitHub Apps and Dependabot, but not the GitHub Actions identity behind `GITHUB_TOKEN`, and [semantic-release's GitHub Actions recipe](https://semantic-release.gitbook.io/semantic-release/recipes/ci-configurations/github-actions) notes that `GITHUB_TOKEN` "cannot be used if branch protection is enabled for the target branch". The App needs Repository permissions Contents: Read and write and Issues: Read and write (semantic-release opens an issue when a release fails), installed on this repository only. Store its Client ID as the `RELEASE_APP_CLIENT_ID` repository variable and a generated private key as the `RELEASE_APP_PRIVATE_KEY` repository secret. `publish.yml` mints a short-lived token from it with `actions/create-github-app-token` right before `semantic-release` runs, so the install, lint and test steps never see it; checkout uses `persist-credentials: false` so the default token isn't left in the git config to shadow it.
- `GITHUB_TOKEN` needs no setup and isn't used for the release; `publish.yml` keeps it at `contents: read`. Unlike `GITHUB_TOKEN`, an App installation token's pushes *do* trigger workflows ([GitHub docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)). What stops the version-bump commit from re-running `publish.yml` and `ci.yml` on `main` is `@semantic-release/git`'s default commit message, which ends in `[skip ci]` - don't override `message` in `release.config.js` without keeping it. The tag push triggers nothing, since no workflow here listens for tags.

## Non-goals

- **No manual release path.** There is no supported way to hand-publish a version; `pnpm publish` run locally would conflict with the next automated release's version derivation. A release only ever happens through `publish.yml`.
- **No pre-release/beta channel.** `release.config.js` configures `main` for normal releases and `release/**` for maintenance releases only - no `next`/`beta` distribution tag, per [semantic-release's branch workflow](https://semantic-release.gitbook.io/semantic-release/usage/workflow-configuration), is configured. `int` doesn't publish anything at all, prerelease or otherwise.
- **No release notifications.** Slack/Discord/email-on-release is not wired up; the GitHub Release and npm listing are the only visible outputs.
