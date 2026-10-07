# 0034: Co-located Packages get `<dir>@<family>` ids, and path filters understand them

[Back to documentation/adr/README.md](README.md) • [Back to USER_GUIDE.md](../USER_GUIDE.md)

## Status

Accepted. Amends the schema spec's "`Package`/`Directory`/`File` ids are repo-relative paths".

## Context

Multi-language support let one directory host more than one manifest, such as `go.mod` beside `package.json`. Two Package nodes can't share one id, so Discovery suffixes the family when, and only when, a directory has more than one manifest: `.@go` and `.@npm`. A directory with a single manifest keeps its plain path, so every single-language repo is unchanged. This mirrors ADR-0021's "disambiguate only on an actual collision" idiom.

The id scheme shipped without a record. The `read` path filter didn't know about it: `--path .@go` matched only the Package node itself, `--path goa` never pulled in its owning `.@go` Package, and `--path .` matched only the root Package in every repo. The HTML path filter had the same `.` bug.

## Decision

- A Package id is `<repo-relative dir>`, or `<dir>@<family>` when the directory holds two or more manifests. `<family>` is one of `npm`, `go`, `rust`, `java`, `python`. `parsePackageId` in `src/core/languages.ts` is the one parser for it.
- Path filtering (`src/core/filter-graph.ts` for `read`, `src/output/html/filter-engine.ts` for the HTML view) treats a filter as a directory subtree plus an optional family:
  - `.` matches the whole repo.
  - `<dir>@<family>` matches only nodes under `<dir>` owned by that family. A File's family comes from its language, and npm owns both TypeScript and JavaScript. A Directory belongs to every family with a File beneath it.
  - Ancestor expansion in `read` walks up to the Package of the matched node's own family, so `--path goa` returns `.@go`, never `.@npm`.

## Consequences

- An id containing `@` is a Package id only when the suffix is a known family. A directory literally named `foo@go` would be misread, an accepted edge case.
- The JSON schema's node shapes are unchanged: the suffix is part of the id string, so no `schemaVersion` bump.
