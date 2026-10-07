# Setup checklist

One-time manual actions needed to finish taking this repo public and wiring
up the rulesets in `.github/rulesets/`. Everything here happens
outside this repo's files - GitHub's UI, an external token, or a judgement
call - which is why it isn't automated. Delete this file once everything
below is checked off.

## Local environment (Docker Sandboxes)

The first commit is made inside the `.sbx/codemap-dev` sandbox, which has
`gitleaks` and the rest of the hook toolchain; the host doesn't. `sbx` 0.47.0
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
      unvalidated until the first commit exists.
- [x] `sbx policy init balanced` - the one-time global network policy
      (2026-10-07). Unmatched destinations ask for approval.
- [ ] Approve the sandbox's `github` credential binding. The secret source
      is stored (`sbx secret set github --command '/opt/homebrew/bin/gh auth
      token'`), but sbx sends it only once a binding authorizes it: run
      `sbx run --name codemap-bootstrap` in a terminal and accept the prompt.
      Until then `git push` and `gh` inside the sandbox are unauthenticated.
- [x] `gh auth login --hostname github.com --git-protocol https --web` -
      `sbxenv.yaml` sources the sandbox's GitHub secret from `gh auth token`.
      This also unblocks every `gh api` re-check in this file.
- [x] `ssh-add ~/.ssh/wind_ed25519` - loaded into this session's agent
      (`SSH_AUTH_SOCK`), verified identical to `wind_ed25519.pub`
      (2026-10-07). Repeat after a reboot: sbx forwards whatever the creating
      session's agent holds.

## Repo bootstrap

- [ ] First commit + push - repo still has zero commits (confirmed
      2026-10-07; everything is staged). The first push must include
      `.github/workflows/allowed-merge-source.yml`, since the `main` ruleset
      will require its check. Made once in a **direct-mode** sandbox
      (`sbx run --name codemap-bootstrap ./.sbx/codemap-dev .`), since clone
      mode needs a commit to clone. `pnpm-workspace.yaml` carries an
      uncommitted `supportedArchitectures` block for this one commit only, so
      the sandbox's hooks find Linux Biome/TypeScript/rolldown binaries in the
      shared `node_modules`; after the commit, `git checkout pnpm-workspace.yaml
      && pnpm install` on the host drops it. From then on, use clone mode
      (`sbx env run`). The live `main` ruleset requires a PR and has no
      bypass actors yet, so the push that creates `main` may be rejected - if
      so, disable that ruleset for the one push and re-enable it.
- [x] File modes: 307 staged data files carried the executable bit, inherited
      from the working tree (found 2026-10-07). Stripped in the index and on
      disk. Only the Husky hooks and files starting with a shebang stay
      `100755`: `.husky/*`, `scripts/generate-*.mjs`,
      `.sbx/codemap-dev/install-tools.sh`, `src/integration/*/main.ts`.
- [ ] After that push, open a PR into `main` from an `int` or `hotfix-*`
      branch. Confirm these checks all report: `verify`, `lint-commits`,
      `Validate PR title`, `allowed-merge-source`. Do this before the
      `main.json` re-sync below.
- [ ] Open a PR from a `feat-*` branch into `int` with test-first history.
      Confirm `tdd-order` reports green. It must report once before the
      `integration.json` re-sync below.
- [ ] Decide when to flip README.md/SECURITY.md's "1.0 release, published to
      npm" wording to match reality.

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
- [ ] After the first successful publish: delete this token, configure a
      Trusted Publisher on npmjs.com (package settings -> Trusted Publisher
      -> this repo + the exact `publish.yml` filename), then remove
      `NPM_TOKEN` from both the GitHub secret and `publish.yml`'s `env:`
      block. `@semantic-release/npm` invokes the `npm` CLI directly, which
      auto-detects OIDC, and `publish.yml` already requests
      `id-token: write` - no other workflow change needed.

## Importing the rulesets (Settings > Rules > Rulesets)

- [x] Import all 6: `main.json`, `release.json`, `integration.json`,
      `feature.json`, `branch-naming.json`, `tags.json` - created via
      `gh api repos/windagency/codemap-gen-for-agents/rulesets -X POST
      --input <file>.json`, one call per file. All 6 live with
      `enforcement: active` (ruleset IDs 24375251/52/55/58/61/62 at
      creation; the live IDs are now `main` 24375251, `release` 24375252,
      `integration` 24375255, `feature-and-fix` 24375258, `branch-naming`
      24375261, `tags` 24375262 - rechecked 2026-10-04).
- [ ] **Re-sync four live rulesets to the repo files.** The repo files
      changed for the `hotfix-*` path after these were created, so the
      live versions are now stale:
  - `main` (24375251) from `main.json`: adds the `allowed-merge-source`
    required check. Do this only after that check has reported green once
    on a PR into `main` (see Repo bootstrap). Importing it earlier blocks
    every PR into `main`.
  - `feature-and-fix` (24375258) from `feature.json`: adds `hotfix-*`.
  - `branch-naming` (24375261) from `branch-naming.json`: excludes
    `hotfix-*`. Until this lands, creating a `hotfix-*` branch on GitHub is
    rejected.
  - `integration` (24375255) from `integration.json`: adds `tdd-order`.
    Do this only after `tdd-order` has reported green once on a PR into
    `int`. Importing earlier blocks every PR into `int`.

  Update each with `gh api repos/windagency/codemap-gen-for-agents/rulesets/<id>
  -X PUT --input <file>.json`. The JSON has no `bypass_actors`, so after each
  PUT, check the ruleset's bypass list in the UI and re-add any actor that
  disappeared. Confirm each live ruleset afterwards with
  `gh api repos/windagency/codemap-gen-for-agents/rulesets/<id>`.
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
- [x] `.husky/pre-push` mirrors `branch-naming.json` locally - catches a bad
      branch name before the server-side ruleset rejects the push.

From the review against `OSS_NPM_CHECKLIST.md` (rechecked 2026-10-04):

- [ ] **Dependabot security updates** are disabled on the repo (confirmed
      via `gh api .../repos/windagency/codemap-gen-for-agents`). Dependabot
      alerts are also disabled (HTTP 403). Enable both in Settings > Code
      security.
- [ ] **Private vulnerability reporting** is disabled (confirmed via
      `gh api .../private-vulnerability-reporting` -> `enabled: false`).
      Enable it in Settings > Code security, alongside `SECURITY.md`'s email
      contact.
- [ ] **Fork pull request workflow approval** - not verified. The REST path I
      tried returned Not Found. Check Settings > Actions > General > Fork pull
      request workflows, and require approval for first-time contributors at
      minimum.
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
- [ ] Make `dependency-review` a required check in `main.json`,
      `release.json` and `integration.json`, after it has reported once, then
      re-sync those rulesets (see Importing the rulesets).
- [x] Confirm CodeQL **default setup** is off - `gh api .../code-scanning/
      default-setup` returned `state: not-configured` (2026-10-07), so
      `codeql.yml`'s advanced setup doesn't conflict.
- [x] **OpenSSF Scorecard**: `scorecard.yml` runs weekly and on pushes to
      `main`, publishing results (needs the repo public, which it is).
- [x] **Frozen lockfile in CI**: `ci.yml` and `publish.yml` now run
      `pnpm install --frozen-lockfile`.
- [ ] **Node test matrix**: CI only tests the Volta pin (26.9.0), but
      `engines` allows `^22.12.0 || ^24.0.0 || >=26.0.0`. Add a matrix that
      covers the range, or narrow `engines` to what is actually tested.
- [ ] **Publish environment**: add a GitHub Environment named `npm` with
      branch restrictions. Move `NPM_TOKEN` into it as an environment secret,
      and reference `environment: npm` in `publish.yml`. Do this before the
      bootstrap token is removed.
- [x] **Scoped package name**: publishing as
      `@windagency/codemap-gen-for-agents` (operator's decision,
      2026-10-07), with `publishConfig.access: public`. The `windagency` npm
      org exists, and the scoped name was free on 2026-10-07.
- [x] Confirm `NPM_TOKEN` can publish to the `@windagency` scope -
      confirmed by the operator on npmjs.com (2026-10-07); not checkable
      from here without the token.
- [ ] **Build provenance and SBOM** (optional): add
      `actions/attest-build-provenance` and an SBOM step at release time, as
      GitHub Release assets.
- [x] **Docs drift**: `.github/rulesets/README.md`'s PR-title snippet now
      pins the same SHA as `pr-title.yml`.
- [ ] **npm account 2FA**: set to "Authorization and writes" on the account
      that owns the package. Not checkable from this repo.
