# Setup checklist

One-time manual actions needed to finish taking this repo public and wiring
up the rulesets in `.github/rulesets/`. Everything here happens
outside this repo's files - GitHub's UI, an external token, or a judgement
call - which is why it isn't automated. Delete this file once everything
below is checked off.

## Local environment (Docker Sandboxes)

Commits are made inside the `.sbx/codemap-dev` sandbox, which has `gitleaks`
and the rest of the hook toolchain; the host doesn't. `sbx` 0.47.0
and `gh` 2.102.0 are installed on the host (Homebrew, 2026-10-07). Each step
below opens a browser or asks for a passphrase, so only the operator can run it.

- [x] `sbx login` - Docker sign-in as `windagency` (2026-10-07); the daemon
      starts on the first `sbx` command. `sbx kit validate` doesn't accept
      v3 source kits - they build when a sandbox is created. The kit built and
      ran as sandbox `codemap-bootstrap` (2026-10-07): the forwarded agent
      works and the full `.husky/pre-commit` passes inside it. The image
      needs `socat`, which sbx uses to expose the agent socket. sbx 0.47.0
      doesn't enforce the kit's `sign: [git]` bound: a `file`-namespace
      signature also went through. `sbxenv.yaml` (clone mode) is still
      unvalidated: every commit so far was made in the direct-mode
      `codemap-bootstrap` sandbox (see Repo bootstrap).
- [x] `sbx policy init balanced` - the one-time global network policy
      (2026-10-07). Unmatched destinations ask for approval.
- [ ] Approve the sandbox's `github` credential binding. The secret source
      is stored (`sbx secret set github --command '/opt/homebrew/bin/gh auth
      token'`), but sbx sends it only once a binding authorizes it: run
      `sbx run --name codemap-bootstrap` in a terminal and accept the prompt.
      Until then `git push` and `gh` inside the sandbox are unauthenticated;
      so far every push ran on the host through `gh auth git-credential`
      (still not approved, rechecked 2026-10-08).
- [x] `gh auth login --hostname github.com --git-protocol https --web` -
      `sbxenv.yaml` sources the sandbox's GitHub secret from `gh auth token`.
      This also unblocks every `gh api` re-check in this file.
- [x] `ssh-add ~/.ssh/wind_ed25519` - loaded into this session's agent
      (`SSH_AUTH_SOCK`), verified identical to `wind_ed25519.pub`
      (2026-10-07). Repeat after a reboot: sbx forwards whatever the creating
      session's agent holds.

## Repo bootstrap

- [x] First commit + push (2026-10-07): `b67a21f`
      `feat: initial release of codemap-gen-for-agents`, signed in the
      direct-mode `codemap-bootstrap` sandbox. The `main` ruleset had no
      bypass yet and required checks that couldn't exist before the first
      push, so it was set to disabled for that one push and back to active,
      diffed identical before/after. That pass needed an uncommitted
      `supportedArchitectures` block in `pnpm-workspace.yaml`, so the
      sandbox's hooks found Linux binaries in the host's `node_modules`. Later
      direct-mode commits repeated that block, never committed. Clone mode
      (`sbx env run`) avoids it now that `main` has commits.
- [x] 1.0.0 released (2026-10-07): `@windagency/codemap-gen-for-agents@1.0.0`
      on npm with SLSA provenance, tag `v1.0.0`, GitHub Release, and the
      `chore(release): 1.0.0 [skip ci]` commit pushed by the release App. It
      took four `hotfix-*` PRs, each fixing what the previous Publish run
      exposed: #1 CRLF licence files made `licenses:check` fail on a fresh
      checkout; #2 setup-node's `registry-url` placeholder `.npmrc` hid
      `NPM_TOKEN`; #3 a commitlint-hoisted `conventionalcommits@10` preset broke
      `release-notes-generator`'s writer 8; #4 husky hooks installed on the
      runner broke the release commit (`HUSKY: 0` at workflow level in
      `ci.yml` and `publish.yml`).
- [x] File modes: 307 staged data files carried the executable bit, inherited
      from the working tree (found 2026-10-07). Stripped in the index and on
      disk. Only the Husky hooks and files starting with a shebang stay
      `100755`: `.husky/*`, `scripts/generate-*.mjs`,
      `.sbx/codemap-dev/install-tools.sh`, `src/integration/*/main.ts`.
- [x] PR into `main` from `int` or `hotfix-*` with `verify`, `lint-commits`,
      `Validate PR title` and `allowed-merge-source` all reporting - #1-#4
      (`hotfix-*`) and #6 (`int`).
- [x] PR from a `feat-*` branch into `int` with `tdd-order` green - #5
      (`feat-ci-gitleaks`, `TDD-Exempt` trailer) and #7
      (`fix-golden-determinism-timeout`, test-only change).
- [x] `int` created (2026-10-08) from `main` at `5e5e57c`. The `integration`
      ruleset blocks the branch's own creation, so it was set to disabled for
      that one call and back to active, diffed identical before/after.
- [x] README.md's "1.0, published to npm" status line is now accurate (npm
      `latest` = 1.0.0, 2026-10-07).
- [x] `int` re-synced with `main` (2026-10-08): `main` merged into `int` with a
      real merge commit, in #10 and again at the start of the hardening PR.
      Squash merges into `main` split their history each time; do the same
      merge-commit PR whenever an `int` -> `main` PR shows a conflict.

## GitHub repo settings (Settings > General)

- [x] **Social preview** -> uploaded `documentation/images/social-preview.png`
      manually (no REST API for this field; UI-only).
- [x] **Pull Requests > Allow squash merging > Default commit message** ->
      set to "Pull request title" (`squash_merge_commit_title: PR_TITLE`,
      `squash_merge_commit_message: BLANK`, applied via `gh api`).
- [x] **Code security > Secret scanning > push protection** -> already
      enabled (confirmed via `gh api repos/windagency/codemap-gen-for-agents
      --jq .security_and_analysis` - this is on by default for this repo, not
      something this checklist turned on). `gitleaks` also runs in
      `.husky/pre-commit` as a local check - see Optional hardening below.

## Commit signing (Settings > SSH and GPG keys)

- [x] Confirm `~/.ssh/wind_ed25519.pub` is uploaded as a **Signing key**, not
      just an Authentication key. It's already configured locally
      (`commit.gpgsign=true`). Confirmed by the operator directly; not
      independently re-verified via API - `GET /user/ssh_signing_keys` needs
      the `admin:ssh_signing_key` token scope, which the current `gh` session
      doesn't have.

## CI secrets (Settings > Secrets and variables > Actions)

- [x] Confirm `NPM_TOKEN` is set (confirmed via `gh secret list`, last
      updated 2026-10-07T17:31:32Z, rechecked 2026-10-07) - `publish.yml` references it and will
      fail the `semantic-release` step without it. This is a short-lived
      bootstrap token, not a permanent one - npm has no way to configure
      Trusted Publishing (OIDC) for a package that has never been published,
      so the first release has to go out on a token before OIDC can take
      over.
- [ ] **npm Trusted Publishing** (operator, npmjs.com): package settings ->
      Trusted Publisher -> GitHub Actions, repository
      `windagency/codemap-gen-for-agents`, workflow `publish.yml`, environment
      `npm`. Then the follow-up PR removes `NPM_TOKEN` from `publish.yml`, and
      the operator deletes the npm token and the GitHub secret.
      `@semantic-release/npm` already tries OIDC first ("Verifying OIDC
      context" in every Publish run) and `publish.yml` requests
      `id-token: write`. The next release is the first real test.

## Importing the rulesets (Settings > Rules > Rulesets)

- [x] Import all 6: `main.json`, `release.json`, `integration.json`,
      `feature.json`, `branch-naming.json`, `tags.json` - created via
      `gh api repos/windagency/codemap-gen-for-agents/rulesets -X POST
      --input <file>.json`, one call per file. All 6 live with
      `enforcement: active` (ruleset IDs 24375251/52/55/58/61/62 at
      creation; the live IDs are now `main` 24375251, `release` 24375252,
      `integration` 24375255, `feature-and-fix` 24375258, `branch-naming`
      24375261, `tags` 24375262 - rechecked 2026-10-04).
- [x] **Re-sync the live rulesets to the repo files** (2026-10-08), each
      after its new required check had reported green on a real PR:
      `branch-naming` (excludes `hotfix-*`, 2026-10-07), then `main` (adds
      `allowed-merge-source`, `gitleaks`), `release` (adds `gitleaks`),
      `integration` (adds `tdd-order`, `gitleaks`), `feature-and-fix` (adds
      `hotfix-*`). Each PUT carried the live `bypass_actors`; afterwards all six
      live rulesets matched their repo files apart from GitHub's own defaults
      (`required_reviewers: []`,
      `require_extra_approval_for_unattributed_changes`).
- [x] On **integration**: add bypass actor - Repository admin role, mode
      **Pull request only** (2026-10-08). Without it a sole maintainer can't
      merge into `int` at all (1 approving review, no bypass). Matches `main`
      and `release`.
- [x] Update `.github/rulesets/README.md`'s "Before you import" item 1 - now
      lists `verify`, `lint-commits`, `Validate PR title`, plus
      `allowed-merge-source` (`main`) and `tdd-order` (`int`), matching the
      ruleset JSON (2026-10-07).
- [x] On **main**: add bypass actor - Repository admin role, mode
      **Pull request only** (live: `RepositoryRole` 5, `pull_request`;
      checked via `gh api`, 2026-10-07).
- [x] On **release**: add bypass actor - Repository admin role, mode
      **Pull request only** (same check).
- [x] **Create the release GitHub App** (owner settings > Developer settings >
      GitHub Apps > New). GitHub Actions itself can't be a bypass actor (the
      picker doesn't offer it), so `publish.yml` pushes as this App instead.
      Repository permissions: Contents **Read and write**, Issues **Read and
      write**, nothing else. Webhook off. Install it on this repository only.
      Use it for nothing else. Done 2026-10-07: `codemap-gen-for-agents-release`,
      App ID 5229758, installation 169028318 (selected repos: this one);
      permissions verified by authenticating as the App.
- [x] Repository variable `RELEASE_APP_CLIENT_ID` = the App's Client ID
      (Settings > Secrets and variables > Actions > Variables).
- [x] Repository secret `RELEASE_APP_PRIVATE_KEY` = a private key generated
      on the App's settings page (the whole `.pem` contents). The local copy
      was moved out of the repo to `~/.github-apps/` (mode 600); delete it
      once you're sure you won't need it - a new key can be generated any time.
      `.gitignore` now excludes `*.pem`.
- [x] On **main**: add bypass actor - the release App, mode **Always**
      (lets `@semantic-release/git`'s push land).
- [x] On **release**: add bypass actor - the release App, mode **Always**
      (same reason, for maintenance releases).
- [x] On **tags**: add bypass actor - the release App, mode **Always**
      (lets `@semantic-release/github` create the release tag).

  The three App bypasses were added via `gh api ... -X PUT` on 2026-10-07 as
  `{actor_type: Integration, actor_id: 5229758, bypass_mode: always}` - the
  App ID verified by authenticating as the App, every other ruleset field
  diffed unchanged before/after. A re-sync PUT from the repo JSON drops
  bypass actors (the JSON has none), so re-add both the admin and the App
  entries after any re-sync.

- [x] Decide enforcement for week one: **Active**, matching the rulesets as
      created - no trial/Evaluate period, no change needed from how the 6
      rulesets above were already created.

## Keeping the release bypass narrow (Settings > Actions > General)

From the security review: the "Always" bypass above exempts anything
holding a release-App token from every rule on `main`/`release`/`tags`.
Only `publish.yml` holds the App's key; this setting keeps every other
workflow's default token from pushing to a protected branch either.

- [x] **Workflow permissions** -> set to **Read repository contents
      permission** (read-only), not read-and-write. Already in place
      (confirmed via `gh api repos/windagency/codemap-gen-for-agents/actions/
      permissions/workflow`: `default_workflow_permissions: read`,
      `can_approve_pull_request_reviews: false`) - this is GitHub's current
      default for new repos, not something this checklist changed. Forces
      any workflow that wants `contents: write` to say so explicitly in its
      own YAML. None does today: `publish.yml` pushes with the App token.

## Optional hardening

Done - see `documentation/GIT.md` for the current state of these hooks.

- [x] `gitleaks git --pre-commit --staged` runs in `.husky/pre-commit`,
      ahead of `lint-staged`.
- [x] `ci.yml`'s `gitleaks` job scans each PR's commits (pinned 8.30.1,
      SHA-256 checked) and is a required check on `main`, `release` and
      `int` - added in #5/#6, live rulesets re-synced 2026-10-08.
- [x] `.husky/pre-push` mirrors `branch-naming.json` locally - catches a bad
      branch name before the server-side ruleset rejects the push.

From the review against `OSS_NPM_CHECKLIST.md` (rechecked 2026-10-04):

- [x] **Dependabot alerts** enabled (2026-10-07, `PUT .../vulnerability-alerts`),
      which also turned on the dependency graph that `dependency-review`
      needs. All 11 open alerts (2026-10-08) are `jackson-databind` in
      `fixtures/java-basics/pom.xml`, Java parser test data that is never
      built or shipped.
- [x] The 11 fixture alerts were dismissed as `not_used` with a comment
      (2026-10-08); 0 open. New advisories against `fixtures/` manifests will
      open new alerts: an auto-triage rule with a manifest-path filter
      (Settings > Advanced Security > Dependabot rules, UI only) would dismiss
      them automatically - optional, operator.
- [x] **Dependabot security updates** stay off, deliberately (2026-10-08):
      GitHub opens them against the default branch only, from `dependabot/*`
      branches with "Bump ..." titles, so `allowed-merge-source` and
      `Validate PR title` reject every one. Alerts plus the weekly version
      updates into `int` cover vulnerable dependencies instead.
- [x] **Private vulnerability reporting** enabled (2026-10-08,
      `PUT .../private-vulnerability-reporting` -> `enabled: true`).
- [x] **Fork pull request workflow approval** - `first_time_contributors`
      (`gh api .../actions/permissions/fork-pr-contributor-approval`,
      2026-10-08), the minimum this item asked for.
- [x] **`.gitignore` excludes `.env`** - stale finding: the file already has
      `.env*` with `!.env.sample` and `!.env.example` (rechecked 2026-10-07).
- [x] **`.env.example`** - not applicable. Nothing in `src/` or `scripts/`
      reads an environment variable (rechecked 2026-10-07), and CI secrets
      live in GitHub, not a `.env`. Add one if that changes.
- [x] **Dependabot version updates**: `.github/dependabot.yml` covers `npm`
      and `github-actions` weekly, targeting `int` (`main` only accepts `int`
      or `hotfix-*`). `commitlint.config.js` skips commits signed off by
      `dependabot[bot]`, whose bodies exceed the 100-character line limit;
      `pr-title.yml` still lints their titles.
- [x] **Dependency review and code scanning workflows**: added
      `dependency-review.yml` and `codeql.yml` (JavaScript/TypeScript and
      Actions). All workflows pass `actionlint` 1.7.12 (2026-10-07).
- [x] `dependency-review` is a required check in `main.json`,
      `release.json` and `integration.json` (hardening PR, 2026-10-08).
- [ ] Re-sync the live `main`, `release` and `integration` rulesets after the
      hardening PR reaches `main`, keeping their bypass actors.
- [x] `CHANGELOG.md` layout: the config moved to `release.config.js`, which
      passes everything above the first released version as
      `changelogTitle`, read at release time. New releases land below
      `Unreleased`; the 1.0.0 notes were moved there. Checked with a simulated
      1.1.0 write and `backlinks:check`.
- [x] Confirm CodeQL **default setup** is off - `gh api .../code-scanning/
      default-setup` returned `state: not-configured` (2026-10-07), so
      `codeql.yml`'s advanced setup doesn't conflict.
- [x] **OpenSSF Scorecard**: `scorecard.yml` runs weekly and on pushes to
      `main`, publishing results (needs the repo public, which it is).
- [x] **Frozen lockfile in CI**: `ci.yml` and `publish.yml` now run
      `pnpm install --frozen-lockfile`.
- [x] **Node test matrix**: `ci.yml`'s `node-compat` job builds and tests on
      Node 22 and 24; `verify` covers the 26.x Volta pin. Both passed locally
      first, so `engines` stays as declared. Not a required check yet: its
      check names are `node-compat (22)` and `node-compat (24)`.
- [x] **Publish environment**: `npm` environment created (2026-10-08),
      deployment branches `main` and `release/**` only; `publish.yml` uses it.
      `NPM_TOKEN` stays a repository secret until Trusted Publishing replaces
      it, rather than being re-entered into the environment.
- [x] **Scoped package name**: publishing as
      `@windagency/codemap-gen-for-agents` (operator's decision,
      2026-10-07), with `publishConfig.access: public`. The `windagency` npm
      org exists, and the scoped name was free on 2026-10-07.
- [x] Confirm `NPM_TOKEN` can publish to the `@windagency` scope -
      confirmed by the operator on npmjs.com (2026-10-07); not checkable
      from here without the token.
- [x] **SBOM**: `publish.yml` writes a CycloneDX SBOM with a pinned
      `anchore/sbom-action` (syft v1.54.1, `.github/syft.yaml` excludes
      `fixtures/`, `node_modules/`, `dist/`) and attaches it to each GitHub
      Release. Build provenance for the npm tarball is npm's own provenance
      attestation, already on 1.0.0.
- [x] **Docs drift**: `.github/rulesets/README.md`'s PR-title snippet now
      pins the same SHA as `pr-title.yml`.
- [ ] **npm account 2FA** (operator): set to "Authorization and writes" on
      the account that owns the package. Not checkable from this repo.
- [ ] **npm `0.0.0-stage` placeholder** (operator): npm created it during the
      first publish ("Temporary package placeholder for staged publishing").
      `latest` is 1.0.0, but it is listed. `npm unpublish
      @windagency/codemap-gen-for-agents@0.0.0-stage` works until about
      2026-10-10 22:57 UTC; after that, `npm deprecate` it.
