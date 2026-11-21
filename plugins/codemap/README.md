# codemap plugin for Claude Code

This plugin registers the `codemap-mcp` server from the npm package `@windagency/codemap-gen-for-agents`. The server builds a structural map of a TS/JS, Go, Rust, Java, or Python monorepo: a Package, Directory, File and Symbol graph, plus Module domains detected from the real import graph, and static import and call edges. No LLM call and no manual annotation are involved.

## Install

In Claude Code 2.1.275 or later:

```
/plugin install codemap --marketplace windagency/codemap-gen-for-agents
```

## Tools

- `generate` runs the pipeline and writes `codemap.json` and `codemap.html` to `.codemap/` under the analyzed root.
- `read` regenerates the map, then returns the slice of the graph that matches a path prefix, a symbol kind, or a name search.

A bundled `codemap` skill tells Claude when to use these tools instead of reading files one by one.

## Requirements

Node `^22.12.0 || ^24.0.0 || >=26.0.0` and `npx` on your `PATH`. The first start downloads the pinned package version, so it takes longer than later starts.

## Where it runs

Claude Code, and Cowork sessions running on your own computer. claude.ai chat does not load local MCP servers.

## Documentation

Full user guide, configuration file reference, and language support: https://github.com/windagency/codemap-gen-for-agents#readme

## License

MIT. See https://github.com/windagency/codemap-gen-for-agents/blob/main/LICENSE
