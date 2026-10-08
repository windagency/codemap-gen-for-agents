# Testing codemap-gen-for-agents

[Back to README.md](../README.md) • [Back to AGENTS.md](../AGENTS.md) • [Back to 13-testing-strategy.md](../CODING_RULES/13-testing-strategy.md) • [Back to CONTRIBUTING.md](../CONTRIBUTING.md) • [Back to GIT.md](GIT.md)

- [As a QA user](#as-a-qa-user)
- [As a CI runner](#as-a-ci-runner)
- [As an agent](#as-an-agent)

The generator is a single shared core pipeline (Discovery → Parser → GraphBuilder → ModuleDetector, wired once in `src/core/compose.ts`) behind three peer integration adapters - CLI, MCP, Skill. Three different readers verify that in three different ways - a human running the real CLI/MCP/Skill against a real repo and a real browser, a pipeline running the deterministic Vitest suite, and an agent deciding what new tests a change needs.

## As a QA user

Manually exercise the paths the automated suite can't reach: a real browser rendering `codemap.html`, a real MCP client driving the stdio server, and a real `node_modules` install feeding External-node version resolution.

1. Build the CLI/MCP bins and install this checkout globally:

   ```sh
   pnpm build
   pnpm add -g .
   ```

2. Point it at a real polyglot repo - this repo itself is a convenient one:

   ```sh
   codemap generate --root /path/to/some/real/repo --out /tmp/codemap-qa/.codemap
   ```

3. Open `.codemap/codemap.html` directly in a browser (no server, no network). This is the one path the automated suite never exercises for real: `html-transformer.a11y.test.ts` runs `vitest-axe` over the generated markup in `jsdom`, never a real D3 force simulation or a real click-driven Flow-view traversal. Check:
   - **Flow view** - click a file, confirm its import chain highlights breadth-first with numbered edges, including a cycle.
   - **Force-directed view** - confirm detected Modules are visually grouped into regions.
   - **Filter sidebar** - Path, Symbol kind, Search, and Language (HTML-only - the MCP/Skill `read` tool doesn't expose Language) all narrow the view, AND-combined.
4. Check the CLI's own error behaviours:
   - Bare `codemap` (no args), or an unrecognised subcommand → `Usage: codemap generate [--root <dir>] [--out <dir>] [--config <path>] [--force] [--include-tests]` on stderr, exit `1`.
   - `--help` or `-h`, with or without `generate` → usage plus flag descriptions on stdout, exit `0`.
   - Any other unrecognised flag → `Unknown flag <flag>`, exit `1`.
   - A value flag given no value → `<flag> needs a value`, exit `1`.
   - A stray positional argument → rejected, exit `1`.
   - `--include-tests` → confirm test files now appear, clustered into their own `tests` Module, and that toggling the flag forces a full re-extraction next run (the cache epoch changes).
5. Check the External-node version-resolution fidelity split ([ADR-0021](adr/0021-external-node-version-disambiguation.md), [ADR-0032](adr/0032-ts-declared-version-fallback.md)) with a real install: run `generate` once against a target with its `node_modules` actually installed, and once without. With it installed, an External node for a package resolved to more than one distinct version anywhere in the graph gets a `${packageName}@${version}` id; without it, every import of that package falls back to the declared range from `package.json` (e.g. `^5.0.0`) and calls into it produce no edges. None of the checked-in `fixtures/` run a live install as part of the automated suite - `fixtures/multi-package-monorepo/node_modules` is itself a small, checked-in tree, not something a test installs.
6. Exercise the MCP server against a real client handshake - see [Testing the MCP server](#testing-the-mcp-server) below. `mcp-adapter.test.ts`/`server.test.ts` exercise the adapter and transport in isolation, never a real client handshake end to end.
7. Run the Skill script directly (`node dist/integration/skill/main.js generate|read ...`), or symlink `dist/integration/skill/` into `.claude/skills/codemap` (see the User guide's [Add the Skill](USER_GUIDE.md#add-the-skill)), open a real Claude Code session in a different repo, and ask it a "where does X live" / "what calls this function" question.
8. Clean up:

   ```sh
   pnpm remove -g @windagency/codemap-gen-for-agents
   rm -rf /tmp/codemap-qa
   ```

### Testing the MCP server

`codemap-mcp` (`dist/integration/mcp/main.js`) is a stdio server with no CLI arguments. It exposes two tools, `generate` and `read`, with the inputs in `src/integration/mcp/tool-input-schema.ts`. Stdout carries only JSON-RPC frames. Structured logs go to stderr, one JSON object per line. Run `pnpm build` first; every option below runs the built file, not `src/`.

Pick any of three clients, from the most scriptable to the most realistic.

**A. Raw JSON-RPC over stdin.** No extra install. Pipe the handshake, then the tool calls:

```sh
ROOT="$PWD/fixtures/multi-package-monorepo"
OUT=/tmp/codemap-qa/mcp
{
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"qa","version":"0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
    "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"generate\",\"arguments\":{\"rootDir\":\"$ROOT\",\"outDir\":\"$OUT\"}}}" \
    "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"read\",\"arguments\":{\"rootDir\":\"$ROOT\",\"outDir\":\"$OUT\",\"path\":\".\"}}}"
  sleep 5
} | node dist/integration/mcp/main.js 2>/tmp/codemap-qa/mcp-stderr.log
```

The trailing `sleep` matters. The server exits as soon as stdin closes, so without it the tool calls get dropped before they answer. Responses can arrive out of order; match them by `id`.

**B. MCP Inspector.** A browser UI for listing tools and calling them with hand-edited arguments:

```sh
npx @modelcontextprotocol/inspector node dist/integration/mcp/main.js
```

This downloads the Inspector from npm, the one network call this path makes.

**C. Claude Code.** The real end-to-end path. This repo's own `.mcp.json` already registers a `codemap` server whose command is `codemap-mcp`, so step 1's `pnpm add -g .` is enough. Start Claude Code in this repo, approve the project server, and run `/mcp` to confirm it shows as connected. The tools appear as `mcp__codemap__generate` and `mcp__codemap__read`. To register it elsewhere, use `claude mcp add` as shown in the [README](../README.md). Re-run `pnpm build` after any change; the global install points at this checkout's `dist/`, and a running session keeps the old server process until you restart it.

Whichever client you use, check:

- `tools/list` returns exactly `generate` and `read`. Every input field has a description. `read` has no `force` field.
- `generate` returns `{jsonPath, htmlPath, nodeCount, edgeCount}` only, never the graph inline. Both files exist on disk afterwards.
- `rootDir` omitted falls back to the server process's working directory. With option C that is the directory Claude Code started in.
- `outDir` omitted writes to `<rootDir>/.codemap/`, or the config file's `outDir`.
- `read` returns `{nodes, edges, modules}`. It works with no prior `generate` call, since it always re-runs the incremental pipeline first.
- `read` reflects a source edit made between two calls, without a `generate` in between.
- `read`'s `path`, `symbolKind`, and `search` filters AND-combine. A `<dir>@<family>` Package id such as `.@go` matches only that family's files.
- `force: true` on `generate` bypasses the cache: stderr's `cache diff computed` line reports `cachedFiles: 0`.
- `includeTests: true` adds a `tests` Module, same as the CLI's `--include-tests`.
- An invalid argument, such as `symbolKind: "nope"`, comes back as a result with `isError: true` and a Zod message. The server stays up and answers the next call.
- A bad `rootDir` or a malformed `codemap.config.json` also returns `isError: true`, and stderr gets an `error`-level line tagged with the tool name and a `runId`.
- Nothing but JSON-RPC frames appears on stdout. A stray log line there breaks every real client.

**Notes:** `--out` has no non-empty-directory guard the way a project scaffolder would - it only ever adds or overwrites `codemap.json`, `codemap.html`, and `cache.json` under that path, so pointing it at an existing directory is safe, just noisy if you forget `--out` and run it against a repo you didn't mean to write into. Expect a real network call only if you choose to `npm install`/`pnpm install` a fixture's dependencies in step 5; nothing else in this project ever reaches the network.

## As a CI runner

Run the fully deterministic suite. No step calls a real MCP client, a real browser, or a network install - the golden-file and integration tests run entirely against fixtures checked into `fixtures/`, `multi-package-monorepo/node_modules` included as a static tree.

```sh
pnpm install --frozen-lockfile
pnpm run lint          # biome lint .
pnpm run lint:css      # stylelint "src/output/html/*-css.ts"
pnpm run typecheck     # tsc --noEmit
pnpm run licenses:check
pnpm run backlinks:check
pnpm test              # vitest run
pnpm run build
```

This is exactly `.github/workflows/ci.yml`'s `verify` job, run on every push/PR against `main`, `release/**`, and `int`. A separate `lint-commits` job re-runs `commitlint` over a pull request's full commit range (see [`DEPLOYMENT.md`](DEPLOYMENT.md)). On `feat-*`/`fix-*` pull requests into `int`, a separate `tdd-order` job runs `scripts/check-tdd-order.mjs` over the PR's commit range: implementation commits need an earlier test-only commit, and that commit's new tests must fail when run at its own tree. `pnpm test` is plain `vitest run` - there is no `pretest` script chaining lint/typecheck ahead of it, and no coverage threshold is configured anywhere (`vitest.config.ts` has no `coverage` block, and no `@vitest/coverage-*` package is installed); a test's job is to prove the behaviour correct, not to clear a numeric floor.

A `node-compat` job builds and runs the suite on Node 22 and 24, the rest of `package.json`'s `engines` range (`verify` uses the Volta pin). A `gitleaks` job scans every commit in a pull request for secrets, the server-side counterpart of the pre-commit hook, which `--no-verify` skips; it pins the same gitleaks version and SHA-256 as `.sbx/codemap-dev/install-tools.sh`. Three security workflows run alongside: `dependency-review.yml` flags pull requests that add a dependency with a known vulnerability (a required check on `main`, `release/**` and `int`), `codeql.yml` runs CodeQL over the TypeScript/JavaScript and the workflows themselves, and `scorecard.yml` publishes an OpenSSF Scorecard for `main` weekly. `.github/dependabot.yml` opens weekly npm and GitHub Actions update PRs against `int` (never `main`, which only accepts `int` or `hotfix-*`), skipping the test-input manifests under `fixtures/`, `conventional-changelog-conventionalcommits` 10+ (it needs a newer changelog writer than `@semantic-release/release-notes-generator` ships), and `@types/node` major versions (types follow the `engines` floor); `commitlint.config.js` skips Dependabot's own commits, whose bodies exceed the line limit, and `pr-title.yml` still lints their titles.

Locally, Husky runs a smaller subset before you ever reach CI: `.husky/pre-commit` runs `gitleaks git --pre-commit --staged`, then `lint-staged` (Biome, auto-fixing staged files per `.lintstagedrc.json`, plus Stylelint on any touched `src/output/html/*-css.ts`), then `pnpm run backlinks:check` (fails if any Markdown back-link line is stale; fix with `pnpm run backlinks:generate`), then a full-repo `pnpm run typecheck`; `.husky/commit-msg` runs `commitlint`; `.husky/pre-push` rejects a push whose branch name doesn't match this repo's naming convention, mirroring `branch-naming.json` locally - see [`GIT.md`](GIT.md).

**Notes:** `licenses:check` runs `scripts/generate-third-party-licenses.mjs --check`, which fails if `THIRD_PARTY_LICENSES.md` is out of date with installed production dependencies; run `pnpm run licenses:generate` to regenerate it after a dependency change. `backlinks:check` runs `scripts/generate-back-links.mjs --check`, which fails if any `[Back to X](path)` line under a Markdown title is stale; run `pnpm run backlinks:generate` to rewrite them. It also runs in `.husky/pre-commit`; CI catches a commit made with `--no-verify` or `HUSKY=0`. Never wire a real `npm install`/MCP-client/browser invocation into CI - those are QA-only, per the previous section.

## As an agent

Decide what test type a change needs from [`CODING_RULES/13-testing-strategy.md`](../CODING_RULES/13-testing-strategy.md)'s decision table - "add a unit test" is not the default here, and a skipped type needs a stated reason, not silence.

Three seams exist for this pipeline; extend one of them rather than inventing a fourth:

- **Primary seam - `createDefaultPipeline().generateMap(rootDir, options)`** (`src/core/compose.ts`): exercised end-to-end against the real, checked-in fixture repos under `fixtures/`, with each scenario's `codemap.json` compared byte-for-byte against a checked-in `fixtures/expected/<name>.codemap.json` (`src/__tests__/golden/golden-fixtures.test.ts`). Use this for anything that changes the shape of `codemap.json` itself: a new language, a new node/edge field, a schema-version bump, or Module-detection/caching behaviour. To add a fixture: create `fixtures/<name>/`, add it to the `SCENARIOS` array (or write a standalone `it`, the way the `module-assignment`/`polyglot-repo`/`--include-tests` cases already do for a scenario needing assertions beyond a byte-for-byte compare), run the pipeline once, and check in its exact output as `fixtures/expected/<name>.codemap.json` - there's no regeneration script; review the diff by hand before committing it, the same way every `schemaVersion`-bumping change has (e.g. [ADR-0021](adr/0021-external-node-version-disambiguation.md), [ADR-0029](adr/0029-json-envelope-warnings-field.md)).
- **Secondary seam - the narrower `Discovery -> Parser -> GraphBuilder` chain** (`src/__tests__/integration/discovery-parser-graph-builder.test.ts`): the same real fixture (`fixtures/multi-package-monorepo/`, with its own checked-in `node_modules`) run through the first three stages only, asserting on the intermediate `ExtractedSymbols`/graph shape rather than the final rendered JSON. Use this when a change needs structural assertions below the golden-file level, without Module detection or the JSON/HTML transformers in the way.
- **Per-component unit tests, alongside each stage's own source file** (e.g. `go-parser.test.ts`, `python-parser.test.ts`, `rust-parser.test.ts`, `java-parser.test.ts`, `ts-compiler-api-parser.test.ts`, `louvain-module-detector.test.ts`, `extraction-cache.test.ts`, `cli-adapter.test.ts`, `mcp-adapter.test.ts`, `skill-adapter.test.ts`): use these for one stage's own edge cases that don't need a full fixture repo.

Other things a change to this pipeline usually needs:

- **Architecture** - `src/__tests__/architecture/dependency-direction.test.ts` locks the dependency-direction rules in [`CODING_RULES/04-architecture.md`](../CODING_RULES/04-architecture.md) and [ADR-0003](adr/0003-generator-pipeline-seams.md): `core/` only ever depends on each slice's top-level interface/factory file, never an implementation subfolder; `integration/cli`, `integration/mcp`, and `integration/skill` are peers that never import each other; and each third-party library the pipeline uses (`typescript`, `tree-sitter`/its grammar packages, `picomatch`, `graphology`, `d3`, `@modelcontextprotocol/sdk`, `zod`) is only ever imported through its own owned adapter directory or file. It's a regex scan over raw import specifiers, not a real AST parse or `dependency-cruiser` - deliberately, since `dependency-cruiser` doesn't yet support `typescript@7` (pinned here), which dropped the classic Compiler API this repo's own `ts-compiler-api/` adapter relies on from its package root export. A new module-boundary rule extends this file's patterns; it never gets bypassed with an inline suppression.
- **Determinism/repeatability** - any change touching extraction order, Louvain clustering, or JSON serialisation needs to keep `codemap.json` byte-identical across two runs of the same unchanged input (`golden-fixtures.test.ts`'s own "produces byte-identical codemap.json across two runs" case covers this at the top level already; a lower-level change may still need its own repeatability assertion).
- A new free-text or path-like CLI/MCP/Skill input needs the same validation coverage the existing ones have: `src/core/config-schema.ts`/`manifest-schema.ts` reject a malformed `codemap.config.json` or manifest with a clear Zod error rather than silently misapplying a wrong shape (`CONTRIBUTING.md`: "all external input validated with Zod before use").

Before calling a task done, run `pnpm run lint`, `pnpm run typecheck`, and `pnpm test` locally, and check the result against `CONTRIBUTING.md`'s Definition of done. Never add a test that shells out to a real MCP client, opens a real browser, or runs a real `npm install`/`pnpm install` against a fixture - those are QA-only (see above), since they'd be either non-deterministic or network-dependent in a suite that otherwise never touches the network.
