# User guide

[Back to README.md](../README.md) • [Back to 02-language-convention.md](../CODING_RULES/02-language-convention.md) • [Back to 0027-tree-sitter-multi-language-extraction.md](adr/0027-tree-sitter-multi-language-extraction.md) • [Back to 0039-execution-flow-module-ordering.md](adr/0039-execution-flow-module-ordering.md) • [Back to 0044-exclude-globs-match-under-hidden-directories.md](adr/0044-exclude-globs-match-under-hidden-directories.md) • [Back to 0056-scip-index-resolution-for-tree-sitter-languages.md](adr/0056-scip-index-resolution-for-tree-sitter-languages.md) • [Back to TESTING.md](TESTING.md)

Generates `codemap.json` and `codemap.html` for a polyglot codebase - TypeScript/JavaScript, Go, Rust, Java, and Python, any mix in one repo: a structural map (Package/Directory/File/Symbol) plus algorithmically-detected Module domains and static import/call edges. TS/JS extraction is type-checked (TypeScript Compiler API); Go/Rust/Java/Python extraction is syntactic (tree-sitter, no type checker) - see [Known limitations](#known-limitations) and [ADR-0027](adr/0027-tree-sitter-multi-language-extraction.md)/[ADR-0030](adr/0030-tree-sitter-python-support.md) for what that fidelity difference means in practice. See `CONTEXT.md` for terminology and the [README](../README.md) for a one-paragraph overview.

## Install

```bash
npm install -g @windagency/codemap-gen-for-agents
```

This exposes `codemap` and `codemap-mcp` on your `PATH`. On Linux arm64, the Java grammar has to compile during install - see the README's "Linux on arm64" note for the extra steps. To build from source instead:

```bash
git clone https://github.com/windagency/codemap-gen-for-agents.git
cd codemap-gen-for-agents
pnpm install
pnpm run build
```

Node `^22.12.0 || ^24.0.0 || >=26.0.0` is required - `package.json`'s `engines`, which CI tests on Node 22, 24 and the 26.x Volta pin. The dev toolchain itself is pinned to an exact Node version via Volta in `package.json`. Everything below invokes `codemap` / `codemap-mcp` directly; from a source checkout, run the built files under `dist/` instead, or `pnpm add -g .` to get the same bin names on your `PATH`.

## CLI

```
codemap generate [--root <dir>] [--out <dir>] [--config <path>] [--force] [--include-tests]
```

`generate` is the only subcommand. Running the CLI with no subcommand, or an unrecognised one, prints the same usage line to stderr and exits `1`:

```
Usage: codemap generate [--root <dir>] [--out <dir>] [--config <path>] [--force] [--include-tests]
```

`--help` or `-h`, anywhere in the arguments, prints the usage line plus a short description of each flag to stdout and exits `0`. It wins over a missing subcommand or a bad flag. Any other unrecognised flag is rejected with `Unknown flag <flag>` and exit code 1. So is a value flag given no value (`--root needs a value`) and a stray positional argument.

| Flag              | Default                           | Meaning                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--root <dir>`    | `process.cwd()`                   | Repo root to analyse. Never inferred from where a config file lives.                                                                                                                                                                                       |
| `--out <dir>`     | `.codemap` (or config's `outDir`) | Where `codemap.json`, `codemap.html`, and the internal `cache.json` are written.                                                                                                                                                                           |
| `--config <path>` | `<root>/codemap.config.json`      | Explicit config file path, bypassing the default lookup.                                                                                                                                                                                                   |
| `--force`         | off                               | Skip the incremental extraction cache and re-extract every file fresh.                                                                                                                                                                                     |
| `--include-tests` | off                               | Include test files in discovery and Module clustering instead of excluding them by default ([ADR-0011](adr/0011-exclude-test-files-by-default.md)). Also affects `read`. Changes the cache epoch, so toggling it forces a full re-extraction the next run. |

### Example

```bash
codemap generate --root . --out .codemap
```

```json
{"jsonPath":".codemap/codemap.json","htmlPath":".codemap/codemap.html","nodeCount":394,"edgeCount":374}
```

## Config file

`codemap.config.json` at the repo root (`--root`'s directory), read via a **flat, non-walking lookup** - no upward directory search, no user-level or global fallback:

```json
{
  "outDir": ".codemap",
  "exclude": ["**/generated/**"]
}
```

Both fields are optional.

- `outDir` (default `.codemap`): where output artefacts land, relative to `--root`.
- `exclude` (default `[]`): extra glob patterns, **layered on top of** the always-applied defaults below, never replacing them.

Built-in default excludes (always active): `**/node_modules/**`, `**/dist/**`, `**/build/**`, `**/coverage/**`, `**/target/**` (Rust/Java build output), `**/vendor/**` (Go), `**/.stryker-tmp/**` (Stryker mutation-testing sandbox), `**/.pnpm-store/**` (pnpm's local package store). Every pattern here, built-in or your own, matches underneath a hidden ancestor directory too (e.g. `.turbo/some-cache/dist/`) - not just at a visible path.

**`.gitignore` is always followed too.** The project's own root `.gitignore` (flat lookup, like `codemap.config.json` - no nested per-package `.gitignore` files, no upward search) is consulted alongside the defaults and your own `exclude` - a file excluded by any of the three is excluded. This needs no configuration and can't be turned off: if your project's own `.gitignore` already lists a tool-generated directory, the generator already skips it.

## Output artefacts

A `generate` run writes three files to `--out`:

- **`codemap.json`** - the public, versioned graph. Stable schema (`schemaVersion`), safe for an agent or another tool to parse directly.
- **`codemap.html`** - the human-facing visualisation. Self-contained; open it directly in a browser.
- **`cache.json`** - internal incremental-extraction cache. Not part of the public contract; its shape can change between versions without notice, and a corrupt or hand-edited copy just degrades to a full re-extraction. Never edit it by hand.

### `codemap.json` shape

```ts
interface MapJson {
  schemaVersion: string; // "1.3.0"
  nodes: GraphNode[];    // kind: "package" | "directory" | "file" | "symbol" | "external"
  edges: GraphEdge[];    // kind: "static" (only kind produced so far); type: "import" | "call"
  modules: ModuleSummary[]; // { id, name } - one entry per detected Module, including a dedicated "tests" Module when --include-tests is set. Ordered by dependency ("execution flow"): a Module it imports from is listed before it, ties broken alphabetically by name (ADR-0039) - not by id
  languages: string[]; // every language actually detected in this run, e.g. ["go", "typescript"] - sorted, deduplicated
  warnings: string[]; // one entry per file skipped this run, e.g. "Skipped unparseable file: src/broken.ts" or "Skipped manifest-less file: <path>" - empty when nothing was skipped
}
```

A `package`/`file`/`external` node carries a `language` field (`"typescript" | "javascript" | "go" | "rust" | "java" | "python"`) - TS and JS are distinguished at the File level even though one Parser handles both, so an agent can filter to just `.js` files. A `symbol` node carries no `language` of its own: resolve it through its containing File (the id before `#`), the same way path-based filtering already does. A Java `external` node's `name` is the compound `group:artifact` coordinate (e.g. `"com.fasterxml.jackson.core:jackson-databind"`), not a bare artifact name - two different groups can legitimately publish the same artifact name, so the group is load-bearing.

An `external` node's `id` is normally just the package name, but becomes `${packageName}@${version}` when that package name resolves to more than one distinct installed version within the same graph (a monorepo scenario) - one `ExternalNode` per distinct version, so no import edge silently points at a version other than the one it actually resolved to. The common single-version case is unchanged: `id` stays the plain package name ([ADR-0021](adr/0021-external-node-version-disambiguation.md)).

A `package` node's own `id` is normally just its manifest directory's repo-relative path (`.` for the repo root), but becomes `${directoryPath}@${manifestFamily}` when that one directory hosts more than one recognised manifest (e.g. a `package.json` and a `go.mod` co-located - a Go service with a co-located Node tooling package) - one `PackageNode` per manifest, never a single directory forced to be single-language. `manifestFamily` is one of `npm`/`go`/`rust`/`java`/`python` (the manifest tool, not the `language` field - they coincide for go/rust/java/python but not for npm, whose `language` is `typescript`: a co-located `package.json` + `go.mod` produces `.@npm` and `.@go`, never `.@typescript`). Path filters understand these ids: `.@go` narrows to the Go Package's files only ([ADR-0034](adr/0034-co-located-package-ids-and-path-filters.md)).

Smallest possible real example (a single isolated file, no imports):

```json
{
  "schemaVersion": "1.3.0",
  "nodes": [
    {"id": ".", "kind": "package", "name": "isolated-file-fixture", "language": "typescript"},
    {"id": "src", "kind": "directory", "name": "src"},
    {"id": "src/solo.ts", "kind": "file", "name": "solo.ts", "extension": "ts", "language": "typescript", "moduleId": null, "unassignedReason": "isolated"},
    {"id": "src/solo.ts#standalone", "kind": "symbol", "name": "standalone", "symbolKind": "function", "startLine": 1, "endLine": 3, "exported": true}
  ],
  "edges": [],
  "modules": [],
  "languages": ["typescript"],
  "warnings": []
}
```

A file with imports and calls (from the `barrel-file` fixture) shows real edges:

```json
{"source": "src/barrel.ts", "target": "src/impl.ts", "kind": "static", "type": "import", "specifier": "./impl", "viaReExport": true, "locations": [{"startLine": 2, "endLine": 2}]}
{"source": "src/consumer.ts#run", "target": "src/impl.ts#helper", "kind": "static", "type": "call", "locations": [{"startLine": 4, "endLine": 4}]}
```

**Small-repo caveat:** Module detection needs a large enough, well-connected import graph to assign confident groupings. On a small or sparse repo, most or all files come back with `moduleId: null` and an `unassignedReason` (`"isolated"`, `"undersized"`, `"low-embeddedness"`, `"degenerate-partition"`, or `"config"` for a known build-tooling config file - [ADR-0048](adr/0048-config-files-are-excluded-from-clustering.md)) rather than a forced, low-confidence grouping. This is expected behaviour, not a bug - see [ADR-0001](adr/0001-algorithmic-module-detection.md).

A file with genuine syntax errors, in any language, is skipped entirely: no node is produced for it, it's listed in `codemap.json`'s `warnings` as `Skipped unparseable file: <path>`, and an import that would have targeted it resolves as unmatched instead of a dangling edge. A file outside the root `tsconfig.json`'s `include` (a `vitest.config.ts`, a `scripts/` file) is not skipped; it's extracted through its own default project instead.

## Reading the HTML visualisation

`codemap.html` is a single file (typically 300KB+, mostly vendored D3, read from the installed `d3` package at generation time rather than fetched from a CDN - genuinely works with no network). It offers two views over the same graph:

- **Flow view** - trace a File's import chain. Click a file to walk its imports breadth-first; edges are numbered in traversal order, and cycles are handled safely.
- **Force-directed view** - the whole graph laid out spatially, with detected Modules visually grouped into regions.

A **Filter** sidebar narrows either view along four facets, AND-combined when more than one is set:

- **Path** - restrict to a Package/Directory/File subtree. `.` is the whole repo; a `<dir>@<family>` Package id such as `.@go` keeps only that family's files.
- **Symbol kind** - `function`, `method`, `class`, `const`, `type`, `interface`, `enum`.
- **Search** - free-text match on names.
- **Language** - restrict to one language present in this run (`typescript`, `javascript`, `go`, `rust`, `java`, `python`); a Symbol matches through its containing File. HTML-only - the MCP `read` tool below doesn't expose this facet.

The first three facets are the same, with the same semantics, as the MCP `read` tool's filters below.

## MCP server

A plain stdio MCP server, no CLI arguments of its own:

```bash
codemap-mcp
```

Register it in any MCP client by pointing its command at `codemap-mcp` (or at `dist/integration/mcp/main.js` from a source checkout). Two tools are exposed:

### `generate`

```ts
interface GenerateInput { rootDir?: string; configPath?: string; outDir?: string; force?: boolean; includeTests?: boolean; }
interface GenerateOutput { jsonPath: string; htmlPath: string; nodeCount: number; edgeCount: number; }
```

Returns paths and a count summary, never the graph inline - a large map never has to cross the tool-call response.

### `read`

```ts
interface ReadInput {
  rootDir?: string; configPath?: string; outDir?: string;
  path?: string;        // prefix/subtree match; "." = whole repo; ".@go" = only the co-located Go Package's files
  symbolKind?: "function" | "method" | "class" | "const" | "type" | "interface" | "enum";
  search?: string;
  includeTests?: boolean;
}
interface ReadOutput { nodes: Node[]; edges: Edge[]; modules: { id: number; name: string }[]; }
```

`read` **self-heals**: it always re-runs the incremental generation pipeline before filtering, so it's safe to call without a prior `generate` call, and it never returns a stale map relative to the repo's current source files and dependency manifests. That self-healing regeneration refreshes `<outDir>/cache.json` on disk exactly as `generate` would - `read` never writes `codemap.json` or `codemap.html`, but it does keep the cache current as a side effect. Multiple filters AND together. The response includes each match's ancestor Cluster chain (File/Directory/Package, the Package being the one of the match's own language family) for navigability, plus edges that are already fully inside the matched node set. `modules` is the same `{id, name}` lookup table `generate`'s JSON envelope carries, resolving a `FileNode.moduleId` to a human-readable name - always the full, unfiltered table computed over the complete graph, never narrowed by `path`/`symbolKind`/`search`, so a `moduleId` resolves to the same name regardless of which filter happened to be applied that call.

## Claude Code Skill

`src/integration/skill/SKILL.md`, copied by `pnpm build` to `dist/integration/skill/SKILL.md` next to the companion script it runs. Install the `dist/integration/skill/` directory, not the source file; see [Add the Skill](#add-the-skill).

```yaml
name: codemap
description: Generate and query a structural map (Package/Directory/File/Symbol graph, with algorithmically-detected Module domains and static import/call edges) of a TS/JS, Go, Rust, Java, or Python monorepo, without re-parsing the codebase by hand.
```

The Skill calls the shared core pipeline directly, via its own companion script - it does not shell out to the CLI or the MCP server:

```bash
node "${CLAUDE_SKILL_DIR}/main.js" generate [--root <dir>] [--out <dir>] [--config <path>] [--force] [--include-tests]
node "${CLAUDE_SKILL_DIR}/main.js" read [--path <p>] [--symbol-kind <k>] [--search <s>] [--root <dir>] [--out <dir>] [--config <path>] [--include-tests]
```

Unlike the CLI, the Skill's script exposes **both** `generate` and `read` subcommands. Claude Code expands `${CLAUDE_SKILL_DIR}` to the installed skill directory, so the script resolves from any working directory. `--root` still defaults to the working directory, which is the repo being mapped. It prints exactly one JSON object to stdout, matching the corresponding MCP tool's return shape - one contract, three surfaces. `--help` or `-h` is the one exception: it prints plain-text usage and flag descriptions instead, and exits `0`, the same as the CLI.

## Managing codemap from a running Claude Code session

You don't need to quit Claude Code to wire codemap in or out. Prefix a shell command with `!` in the prompt to run it inside the session. Slash commands like `/mcp` and `/skills` manage what's loaded. The commands below assume `codemap-mcp` is on your `PATH` (see [Install](#install)).

### Add the MCP server

```text
! claude mcp add codemap --scope project -- codemap-mcp
```

Without a global install, use the runner form instead:

```text
! claude mcp add codemap --scope project -- npx -p @windagency/codemap-gen-for-agents codemap-mcp
```

Pick the scope deliberately. Options go before the `--` separator.

| Scope     | Stored in                          | Visible to                                 |
| --------- | ---------------------------------- | ------------------------------------------ |
| `local`   | `~/.claude.json`, under this project | You, in this project only. The default.  |
| `project` | `.mcp.json` at the repo root       | Everyone who clones the repo. Commit it.  |
| `user`    | `~/.claude.json`, global           | You, in every project.                     |

Then run `/mcp`. The `codemap` server should show as connected, with two tools. If it isn't listed, or shows as failed, pick **Reconnect** from its menu in `/mcp`. If it still doesn't appear, exit and resume with `claude --continue`; the conversation carries over.

A `project`-scoped server from `.mcp.json` needs a one-time approval prompt in interactive sessions. This repo's own `.mcp.json` already registers `codemap`, so in this checkout you only approve it. `claude mcp reset-project-choices` clears an earlier approval or rejection.

### Disable or remove the MCP server

- **Disable, keep the config:** open `/mcp`, select `codemap`, choose **Disable**. Re-enable it from the same menu.
- **Remove it:** `! claude mcp remove codemap --scope <scope>`, using the scope you added it with. `! claude mcp list` shows what's still configured.
- **After a rebuild or upgrade:** a running session keeps the old server process. Pick **Reconnect** in `/mcp`.

### Add the Skill

Claude Code loads a skill from `<skills-dir>/<name>/SKILL.md`. Two locations apply:

- `.claude/skills/codemap/` - this project only.
- `~/.claude/skills/codemap/` - every project on this machine.

Link the built skill directory rather than copying it, so a rebuild or upgrade updates it too. The directory holds `SKILL.md` and the `main.js` it runs. Don't link `src/integration/skill/SKILL.md` alone; the script wouldn't be next to it.

From a source checkout of this repo, after `pnpm build`:

```text
! mkdir -p .claude/skills && ln -s "$PWD/dist/integration/skill" .claude/skills/codemap
```

From a global install, the built directory ships inside the package. Ask the package manager that installed it where the package lives. Don't build the path from `npm root -g`: a pnpm global install isn't there.

Global npm install:

```text
! P="$(npm ls -g --parseable @windagency/codemap-gen-for-agents | grep '/codemap-gen-for-agents$')" && test -n "$P" && mkdir -p ~/.claude/skills && ln -sfn "$P/dist/integration/skill" ~/.claude/skills/codemap
```

Global pnpm install, including `pnpm add -g .` from a source checkout:

```text
! P="$(pnpm ls -g --parseable @windagency/codemap-gen-for-agents 2>/dev/null | grep '/codemap-gen-for-agents$')" && test -n "$P" && mkdir -p ~/.claude/skills && ln -sfn "$P/dist/integration/skill" ~/.claude/skills/codemap
```

The command stops without linking if the package isn't installed. `-sfn` replaces an existing link, so re-run it after a global upgrade moves the package.

Claude Code watches skill directories, so the new skill loads without a restart. One exception: if `.claude/skills/` or `~/.claude/skills/` didn't exist when the session started, run `/reload-skills`. Run `/skills` to confirm `codemap` is listed.

### Disable or remove the Skill

- **Remove it:** `! rm .claude/skills/codemap` (or `~/.claude/skills/codemap`). This deletes the symlink, not the package. No trailing slash; `rm -r` with one would follow the link into the target. The change applies in the current session.
- **Turn it off, keep the files:** add `"skillOverrides": { "codemap": "off" }` to `.claude/settings.json`.

### Use it in a session

Ask in plain language. Claude picks the tool from its description; you don't have to name it.

```text
Where does the config file get validated?
What calls generateMap?
List every interface under src/core.
Which files import the MCP SDK?
Regenerate the code map and give me the HTML path.
```

What happens underneath:

- **MCP server:** Claude calls `mcp__codemap__read` with filters such as `{ "path": "src/core", "symbolKind": "interface" }`, or `mcp__codemap__generate` to write `codemap.json`/`codemap.html`. `read` self-heals, so a prior `generate` isn't needed.
- **Skill:** Claude runs the companion script's `read` or `generate` subcommand and parses its JSON. Type `/codemap` followed by a question to invoke it explicitly.

Tips:

- **Narrow the query.** A `read` with no filters returns the whole graph. Ask about a path, a symbol kind, or a name.
- **Skip repeat permission prompts.** Add `mcp__codemap__read` to `permissions.allow` in `.claude/settings.json`. `read` only writes the cache.
- **Keep `includeTests` consistent.** Toggling it between calls forces a full re-extraction. See [Incremental caching](#incremental-caching).
- **Open the HTML yourself.** `generate` returns `htmlPath`; open it in a browser to explore the map visually.

## Incremental caching

Re-running `generate` on a repo it already mapped only re-extracts files whose content changed since the last run (content-hash based), while still resolving types and calls across the whole current file set. Module clustering always recomputes globally on every run, since Module boundaries can shift even when no single file changed.

The cache is invalidated wholesale (full fresh extraction) whenever the generator version, the root `tsconfig.json`'s contents, the config's `exclude` patterns, the `--include-tests`/`includeTests` flag, or any dependency manifest or lockfile at the repo root or a Package root changes (`package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `go.mod`, `go.sum`, `Cargo.toml`, `Cargo.lock`, `pom.xml`, `pyproject.toml`). An `npm install` that changes installed versions without touching a lockfile isn't detected; use `--force` then. Use `--force` (CLI/Skill) or `force: true` (MCP `generate`) to bypass the cache unconditionally.

By default, test files (per the shared `isTestFile` convention: for TS/JS, `*.test.*`/`*.spec.*` or anything under a `test/`, `tests/`, or `__tests__/` directory; `_test.go`; `src/test/` or `*Test.java`/`*Tests.java`; `tests/*.rs`; `test_*.py`/`*_test.py`, any `.py` file under a `test/` or `tests/` directory, or `conftest.py` at any level) are excluded from discovery and Module clustering entirely ([ADR-0011](adr/0011-exclude-test-files-by-default.md)). Pass `--include-tests` (CLI/Skill) or `includeTests: true` (MCP) to include them; when included, they're clustered into one dedicated `"tests"` Module rather than grouped by folder ([ADR-0010](adr/0010-test-files-are-their-own-module.md)).

## Known limitations

- **One `tsconfig.json` for the whole repo**, read from `<root>/tsconfig.json` only - a workspace member with genuinely different compiler settings may extract slightly imprecisely.
- **Without `node_modules`, npm versions are the declared ranges.** When nothing is installed, an npm import still becomes an External node, versioned by the range `package.json` declares (e.g. `^5.0.0`) rather than an exact installed version, and calls into that package produce no edges. `workspace:`, `file:`, `link:`, and git dependencies produce no External node that way ([ADR-0032](adr/0032-ts-declared-version-fallback.md)).
- **A source directory named `test/`, `tests/`, or `__tests__/` counts as tests (TS/JS).** A test-utilities package whose product code lives in, say, `src/test/` is excluded unless `--include-tests` is set ([ADR-0033](adr/0033-ts-js-test-directory-convention.md)).
- **Ambiguous call dispatch is nominal-only (TS/JS).** A concrete implementation of an interface/abstract method is matched via `implements`/`extends` heritage only, never structural ("duck") typing.
- **A `declare module "./path" { ... }` string-specifier module augmentation produces no edge (TS/JS).** This form is never scanned by import resolution - a safe failure (no edge rather than a wrong one), but currently invisible in the graph.
- **Module boundaries are fully algorithmic** - there is no way to declare or override a Module label. See [ADR-0001](adr/0001-algorithmic-module-detection.md).
- **Go/Rust/Java/Python extraction is syntactic, not type-checked** ([ADR-0027](adr/0027-tree-sitter-multi-language-extraction.md), [ADR-0030](adr/0030-tree-sitter-python-support.md)): call resolution is repo-wide name-based candidate matching. A namespace/path-qualified call (Go `pkg.Func()`, Rust `module::function()`, a Java imported/fully-qualified reference, a Python `mod.func()`) resolves to its specific target; an unqualified call (or a method call through an unknown-typed receiver, or Python's own `self.method()`) enumerates every same-named top-level declaration in the repo as a candidate - never a single confirmed guess the way a type-checked TS/JS call is.
- **No synthesised cross-language edges.** A Go file calling into a Rust binary over a socket, or a Java service invoking a Go microservice, shows up as no edge at all - this generator never infers FFI/cgo bindings, build-system glue, or network/RPC contracts between languages.
- **Go's package boundary is "one directory, one package."** A namespace-qualified `pkg.Func()` call resolves to every `.go` file directly in the imported directory; a nonstandard layout (e.g. multiple Go packages sharing one directory, which the Go toolchain itself doesn't allow) isn't specially detected.
- **Rust module-path resolution only understands `crate::`/`self::`-prefixed paths, a bareword path bound by a same-file `use` or bodiless `mod name;` declaration, or an associated-function call on a known `impl`'d type.** A qualified call/import through any other relative module path, or anything crossing a `super::` boundary, isn't resolved - it produces no edge rather than a wrong one.
- **Java external dependency matching is a groupId-prefix heuristic**, tried against a dependency's declared `groupId` and, when that has more than 3 segments, once more with its trailing segment dropped (the common case where a dependency's own package diverges from its groupId only in that last segment, e.g. `jackson-databind`'s groupId `com.fasterxml.jackson.core` vs. its package `com.fasterxml.jackson.databind`). Either way it's a real but common-case-only approximation of Maven/Gradle's actual classpath resolution (which this generator never runs), and never drops a groupId to 3 segments or fewer, to avoid matching unrelated products under the same bare vendor prefix.
- **A nested/inner type declared inside another Java type's body produces no Symbol, and no edge to it.** Only top-level (file-scope) `class`/`interface`/`enum` declarations and their own direct methods/constructors are extracted - a `public static class Inner { ... }` declared inside an outer class, and any call reaching it, is silently invisible to the graph rather than degraded to an unresolved edge.
- **Cargo `[workspace]` `members`/`exclude` entries aren't parsed.** A workspace member is found by the normal directory walk discovering its own nested `Cargo.toml` with a `[package]` table, which covers the common case without needing to interpret `members`'s glob patterns - but a directory a workspace's `exclude` deliberately drops (while it still has its own `Cargo.toml`) is not specially excluded here, and shows up as an ordinary Package anyway.
- **Python recognises only a PEP 621 `pyproject.toml`.** A Poetry-only `pyproject.toml` (`[tool.poetry]`, no `[project]` table), `setup.py`, `setup.cfg`, and a bare `requirements.txt` never produce a Package root - every file beneath one is manifest-less, the same as any other unmanaged file ([ADR-0030](adr/0030-tree-sitter-python-support.md)).
- **A Gradle build file change doesn't invalidate the cache.** `build.gradle`/`build.gradle.kts` is recognised as a Java Package root, and its dependencies are read for External nodes, but only `pom.xml` counts toward the cache epoch. After editing a Gradle file's dependencies, use `--force`.
- **Python external dependency matching is a normalised-name heuristic, not installed-package metadata.** An import whose top-level name genuinely differs from its PyPI distribution name (`Pillow` imports as `PIL`, `beautifulsoup4` as `bs4`, `PyYAML` as `yaml`) resolves as `unresolved`, not a wrong guess.
- **Python's absolute-import root is guessed, not declared.** Unlike `go.mod`'s `module` line, `pyproject.toml` declares no import root - an absolute import is resolved by trying the project root and `${projectRoot}/src` in turn, which can misresolve in an unusual layout that's neither.
- **Python imports are scanned without control-flow awareness.** Every `import`/`from` statement in a file counts, including one inside `if TYPE_CHECKING:`, `try:`/`except ImportError:`, or a function body, so an optional or type-only import still produces an edge.
- **Module names are folder-derived, not guaranteed human-friendly.** The rule has been amended several times since it was introduced (ADR-0006, then ADR-0008, ADR-0009, ADR-0012, ADR-0013 - see `documentation/LLD.md`'s `ModuleDetector` section for the current order). The ordinal `Module <id>` label is now a last resort, only used when a name still collides after every folder-derived fallback, or there's no directory information to derive one from at all.
