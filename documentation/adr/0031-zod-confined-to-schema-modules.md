# 0031: Zod is imported only by `*-schema.ts` modules

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md)

## Status

Accepted.

## Context

`CONTRIBUTING.md` makes two non-negotiables that pull against each other for Zod: all external input is validated with Zod before use, and no third-party library is imported outside an owned adapter. A full-repo review found both broken. `zod` was imported directly by four unrelated files with no architecture test, and several external inputs skipped Zod entirely: the analyzed repo's `package.json` (hand-rolled type guards), the regex-read `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, and `pyproject.toml`, and argv (unknown flags silently dropped).

A classic adapter (an owned interface wrapping `z.object` and friends) would add nothing: Zod's builder API *is* the schema language, and wrapping it one-for-one only renames it.

## Decision

Zod is confined by file name instead of by wrapper. Every Zod schema lives in a module named `*-schema.ts`, and only those modules import `zod`. Each exposes plain parse functions (`parseCodemapConfig`, `parseCacheFile`, `parseGenerateFlags`, `parseInstalledPackageJson`, `validGoRequires`, ...) so callers never touch a Zod type. `dependency-direction.test.ts` enforces it.

The schema modules are:

- `src/core/config-schema.ts`: `codemap.config.json`.
- `src/core/cache/cache-schema.ts`: `cache.json`.
- `src/core/cli-args-schema.ts`: argv for `generate`/`read`. `.strict()` rejects an unknown flag, a value flag with no value, and a value given to a boolean flag.
- `src/core/manifest-schema.ts`: every manifest read from the analyzed repo. `package.json` JSON is parsed through a schema; the regex-read manifests produce candidate records that are each validated before they can become an External node. A record that fails is dropped, never thrown over, since a partial real-world manifest is something to fall back past.
- `src/integration/mcp/tool-input-schema.ts`: MCP tool input shapes. The MCP SDK takes raw Zod shapes, so these are exported as shapes.

## Consequences

- Adding a new external input means adding or extending a `*-schema.ts` module; importing `zod` anywhere else fails the architecture test.
- The CLI and Skill now exit 1 on an unknown flag (`Unknown flag --bogus`) instead of running a full generation with defaults. This is a behavior change for any caller that relied on stray flags being ignored.
- A manifest dependency with a malformed coordinate (whitespace, markup, a Go version without its `v` prefix) produces no External node.
