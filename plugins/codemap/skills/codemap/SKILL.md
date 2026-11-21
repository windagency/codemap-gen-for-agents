---
name: codemap
description: Answer "where does X live", "what does this file import", or "what calls this function" in a TS/JS, Go, Rust, Java, or Python monorepo from a structural code map (Package/Directory/File/Symbol graph, detected Module domains, static import/call edges) instead of crawling files by hand.
---

# codemap

Use the codemap MCP server's `generate` and `read` tools before searching or reading files one by one to understand a repo's structure.

## When to use it

- Locating where a symbol, file, or domain lives.
- Listing what a file imports, or what calls a function.
- Getting an overview of a repo's Packages and Module domains before a change.

Fall back to reading files when you need a function's body, not its place in the graph.

## `read`

Call `read` directly. It re-runs the pipeline first, so no prior `generate` is needed and the map is never stale. Pass `rootDir` for a repo other than the working directory.

Narrow the result, or a large repo returns a large graph. Filters AND together:

- `path`: a prefix. A Directory or Package path matches everything under it. `.` matches the whole repo.
- `symbolKind`: one of `function`, `method`, `class`, `const`, `type`, `interface`, `enum`.
- `search`: case-insensitive substring over node names.

It returns `{ nodes, edges, modules }`. `modules` is always the full Module list. Each match comes with its ancestor File, Directory, and Package nodes.

## `generate`

Call `generate` only when the user wants `codemap.json` and `codemap.html` written to disk, by default under `.codemap/` in the root. It returns file paths and counts, never the graph.

## Options on both tools

- `includeTests`: test files are excluded by default. Pass the same value on every call, or the cache re-extracts everything.
- `scipIndexes`: a SCIP index per language narrows call targets to type-checked ones.
- `runIndexers` (`generate` only): runs the target repo's own build tooling. Only pass it for a repo you would build yourself.
