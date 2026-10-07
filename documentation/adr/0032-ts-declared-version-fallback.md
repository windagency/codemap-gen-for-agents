# 0032: TS/JS falls back to package.json's declared version when `node_modules` isn't installed

[Back to documentation/adr/README.md](README.md) • [Back to LLD.md](../LLD.md) • [Back to TESTING.md](../TESTING.md) • [Back to USER_GUIDE.md](../USER_GUIDE.md)

## Status

Accepted. Supersedes the extraction spec's out-of-scope line "A 'generate without installing `node_modules`' mode" and amends ADR-0003's "`node_modules` must already be installed" consequence.

## Context

ADR-0003 made an installed `node_modules` a hard precondition: an import only becomes External once it resolves to an installed package, whose own `package.json` supplies the version. In a freshly cloned repo where `npm install` never ran, every npm import silently vanished: no External node, no edge, no warning. The map looked like a project with zero dependencies. Go, Rust, Java, and Python never had this gap, because they read declared versions straight from `go.mod`/`Cargo.toml`/`pom.xml`/`pyproject.toml`, and `Cargo.toml` already reports ranges such as `"1.0"`.

The typical caller is an agent mapping an unfamiliar repo it just cloned.

## Decision

When a bare specifier resolves to nothing installed, `import-resolution.ts` falls back to the declared spec in the nearest `package.json`, at or above the importer and never above the repo root, that declares the package in `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies`. The External node's `version` is the declared range verbatim, such as `^5.0.0`.

- An installed package always wins. The fallback runs only after the `node_modules` walk finds nothing.
- `npm:bar@^1` names the real upstream package, so the External is `bar`, not the local alias (ADR-0024).
- Specs that name no registry version produce no External: `workspace:`, `file:`, `link:`, `portal:`, git and tarball URLs, and GitHub `owner/repo` shorthand.
- Each directory's declared dependencies are read once per `parse()` call and memoized.
- Validated through `manifest-schema.ts`'s `parseDeclaredDependencies` (ADR-0031).

## Consequences

- An External's `version` is either an exact installed version or a declared range. A consumer can't tell which from the node alone; `node_modules` presence decides.
- Calls into an uninstalled package still produce no edges: the checker has no declarations to resolve them against.
- `package.json` content is part of the cache epoch (ADR-0005 Update), so editing a declared range re-extracts.
