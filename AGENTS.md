# AGENTS.md

[Back to README.md](README.md) • [Back to 02-language-convention.md](CODING_RULES/02-language-convention.md) • [Back to 15-shell-tooling.md](CODING_RULES/15-shell-tooling.md) • [Back to CONTRIBUTING.md](CONTRIBUTING.md)

Read this before touching any code in this repository. It governs how an agent works here. For what the code must look like, start with `CONTRIBUTING.md`.

## Read next

- `CONTRIBUTING.md`: the routing table into `CODING_RULES/`, the definition of done, the non-negotiables.
- `CODING_RULES/09-enforcement.md`: severity levels and the PR checklist you're judged against.
- `NEXT_STEPS.md`: the checklist of open, decided-but-not-built work - the source of truth for what's left, not any doc that mentions it in passing.
- Any `AGENTS.md` in a closer subdirectory. It wins over this file for everything under it.

## Operating rules

These apply to every task, every file, every language in this repo.

1. Don't assume. Don't hide confusion. Surface tradeoffs instead of picking silently.
2. Write the minimum code that solves the stated problem. No speculative code. No unrequested abstraction.
3. Touch only what the task requires. Clean up only the mess you made.
4. Define success criteria before you start. Run them. Loop until they pass. "Looks right" is not done.
5. Read a file before you write to it. Skip the re-read only if it hasn't changed.
6. Never guess an API, a version, a flag, a commit SHA, or a package name. Read the code or the docs first. Then assert.
7. Treat your own review findings as unverified. This includes findings from earlier in the same task. A finding is an inference until you confirm it against the actual file.

## Test-first

Default to RED → GREEN → REFACTOR for non-trivial business logic (`CODING_RULES/01-principles.md`). Write the failing test first, run it, and confirm it fails for the expected reason before writing the implementation. Keep the test and the implementation in separate commits. Exempt only pure configuration and one-line passthroughs, with a `TDD-Exempt: <reason>` trailer that a reviewer approves.

## Shell tooling

Use the modern tool when it's installed, fall back to the classic one if not, and check with `command -v <tool>` rather than assuming either way. Ripgrep's `rg` over `grep`, `fd` over `find`, `jq`/`yq` over `cat` on JSON/YAML, `eza` over `ls`/`tree`, `zoxide` over a `cd` chain, `fzf` over scrolling a list by hand, `lazygit` over a multi-step Git workflow. Rationale and example commands for each: `CODING_RULES/15-shell-tooling.md`.

## Managing context

Compaction, summarizing a long session and continuing from the summary, is a feature of the tool running this agent, not something this file can trigger. In most current tools only the operator or the platform's own threshold invokes it, not the agent.

What's actually under the agent's own control:

- Read narrowly. Extract the field or line that answers the question rather than reading a whole file, per Shell tooling above.
- Don't re-read a file that hasn't changed, per Operating rule 5.
- At a natural breakpoint, a task finished, a milestone reached, write a short progress note to a file: what's done, what was decided, what's left. If the session resets or compacts after that, the next turn reads the file instead of relying on memory of the conversation.
- If a task is running long and the current tool has a manual compaction or context-reset command, tell the operator at the breakpoint instead of pushing through. Don't name the specific command here; it's different per tool and would be wrong the moment a different one reads this file.

## Verification loop

A task is not done when the code looks right. Run every item in `CONTRIBUTING.md`'s definition of done and confirm each one; don't assume it. Re-check that any `CODING_RULES/` file touched by this change still holds; don't rely on an earlier read. If a check fails, fix it and re-run it. Don't report success before the check that proves it has actually run.

## Setup, build, and test commands

Fill in for this repo. Don't let an agent guess these.

Node is pinned via Volta (`package.json`'s `volta` field). Install Volta and its shim switches to the pinned Node version automatically per-directory - no separate `nvm use` step needed.

pnpm ships as its own standalone native binary since v12 and manages its own version, so it isn't pinned via Volta. `package.json`'s `packageManager` field pins the version instead; pnpm reads that field itself and self-redirects to it (run `pnpm self-update` if the installed binary is older than the pin).

Alternatively, work in a Docker Sandbox: `sbx env run` from the repo root (`sbxenv.yaml`, clone mode). The workload kit in `.sbx/codemap-dev/` ships the pinned Node and pnpm, plus every tool the hooks and Shell tooling call for: `gitleaks`, `gh`, `rg`, `fd`, `jq`, `yq`, `eza`, `fzf`, `zoxide`, `lazygit`. Secrets never enter the sandbox: the sbx proxy injects the GitHub token (sourced from `gh auth token` on the host) into github.com requests, and commits are signed through the forwarded ssh-agent, signing only. One-time host setup: `sbx login`, `gh auth login`, `ssh-add <your signing key>`, then approve the `github` credential binding - accept the prompt on the first `sbx run`, or add `bindings: {github: {apiKey: {domains: [api.github.com, github.com]}}}` to `~/.config/sbx/credentials.yaml`. sbx reads bindings when it creates a sandbox, so recreate an existing one after approving. `.devcontainer/` builds the same image for VS Code. Each tool download is SHA-256 pinned in `.sbx/codemap-dev/install-tools.sh`; bump a version and both hashes together. When Node or pnpm's pin changes in `package.json`, change `.sbx/codemap-dev/codemap-dev.dockerfile` in the same commit. `.sbx/codemap-dev/git-signing.sh` explains the fallback when `.git/config` names a host-only key path.

- Install deps: `pnpm install`
- Run dev server: N/A - this is a CLI/MCP generator, not a server; there is no dev-server command yet
- Run tests: `pnpm test` (Vitest, plain `vitest run` - no `pretest` chaining lint/typecheck ahead of it; `pnpm run test:watch` for watch mode)
- Run lint: `pnpm run lint` (Biome, `biome lint .`)
- Run CSS lint: `pnpm run lint:css` (Stylelint, scoped to `src/output/html/*-css.ts`)
- Run type-check: `pnpm run typecheck` (`tsc --noEmit`)
- Format: `pnpm run format` (Biome, `biome format --write .`)
- Check third-party license manifest: `pnpm run licenses:check` (fails if `THIRD_PARTY_LICENSES.md` is stale against installed production deps)
- Regenerate third-party license manifest: `pnpm run licenses:generate` (run after a dependency change, then re-run `licenses:check`)
- Check Markdown back-links: `pnpm run backlinks:check` (fails if any `[Back to X](path)` line under a `.md` title is stale; also runs in `.husky/pre-commit` and CI)
- Regenerate Markdown back-links: `pnpm run backlinks:generate` (run after adding or removing a mention of a `.md` file, then stage the result)
- Build: `pnpm run build` (`tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json`)
- Release: `pnpm run release` (`semantic-release` - CI-only, driven by `publish.yml`; never run locally, see `documentation/DEPLOYMENT.md`)

If a command here is missing or stale, read `package.json` or the build config directly. Don't guess the flag. Fix this section once you've confirmed the real command.

This is the full script set in `package.json`. The exact CI order (`lint` → `lint:css` → `typecheck` → `licenses:check` → `backlinks:check` → `test` → `build`), what test type a change needs, and the QA checklist: `documentation/TESTING.md`.

## Code style

TypeScript, Node, React. Full rules live in `CODING_RULES/`, routed by concern from `CONTRIBUTING.md`. The one rule from that set severe enough to repeat here: no `any` without a comment justifying it. `CONTRIBUTING.md`'s non-negotiables list has the other four; everything else is in the routed files.

## Commits and versioning

Conventional Commits 1.0.0, mapped to SemVer 2.0.0. Full spec in `CODING_RULES/10-commits-and-versioning.md`.

- `fix:` is a PATCH. `feat:` is a MINOR. A breaking change is a MAJOR, on any type. Mark it with `!` or a `BREAKING CHANGE:` footer.
- One logical change per commit. A change that's two types at once is two commits.

Branch workflow (`feat-<name>`/`fix-<name>` → `int` → `main`, `hotfix-<name>` → `main` then `int`, `release/<major>.x` maintenance lines), local hook behavior, and commit-signing setup: `documentation/GIT.md` and `documentation/GITFLOW.md`.

## Communicating with the operator

Applies to chat replies, PR descriptions, and review comments alike.

- Never open with agreement, or with reflexive phrases like "Great question," "You're absolutely right," "Absolutely," "Definitely." Lead with the gap, the risk, or whatever is actually wrong; rewrite the sentence if one slips in.
- Tag claims by confidence. `[Certain]` when you have evidence in hand. `[Likely]` for a strong inference. `[Guessing]` for a filled gap. Say so first if most of a reply is guessing.
- When the operator is wrong, say so with structure. State what's wrong. State what to do instead. State the specific risk in their approach. Don't soften it into a suggestion.
- Lead with the uncomfortable answer. First line, not paragraph three.
- Skip the warm-up. No "there are several ways to look at this." Open with the most useful sentence available.
- Hold your position if the operator pushes back without new information. Repetition is not evidence.
- No em dashes. No parenthetical asides. No emojis. Short sentences, eight to ten words where the content allows it.
- No closing fluff. No filler.
- Act first. Report the result. Explain only if asked. Don't narrate the plan before running it.
- Keep code exactly as correct and idiomatic as the language requires. Compress the English around it, not the code.

## Security and destructive actions

- Never commit a secret, a token, or a credential. Not in code, not in config, not in a comment, not in a commit message.
- Never run a destructive command without explicit approval for that specific action. Force-push, dropping a table, and `rm -rf` outside a scratch directory all count.
- Never hand-edit a generated file. Fix the generator or the source it reads from instead.

## Precedence

An explicit instruction from the operator in the current conversation overrides this file. A subdirectory's own `AGENTS.md` overrides this one for files under it. This file is the default, not the ceiling.
