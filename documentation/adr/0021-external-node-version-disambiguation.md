# 0021: ExternalNode id disambiguates by version when a package name resolves to more than one

[Back to 0017-external-node-version-dedup-limitation.md](0017-external-node-version-dedup-limitation.md) • [Back to 0029-json-envelope-warnings-field.md](0029-json-envelope-warnings-field.md) • [Back to documentation/adr/README.md](README.md) • [Back to TESTING.md](../TESTING.md) • [Back to USER_GUIDE.md](../USER_GUIDE.md)

## Status

Accepted. Supersedes [documentation/adr/0017-external-node-version-dedup-limitation.md](0017-external-node-version-dedup-limitation.md)'s deferral. Bumps `schemaVersion` to `1.1.0`.

## Context

ADR-0017 documented and deliberately deferred a real gap: `DefaultGraphBuilder.buildImportGraph` deduped `ExternalNode`s by package name alone, so a monorepo resolving the same package name to two genuinely divergent installed versions silently lost one version - every importer pointed at a single `ExternalNode`, stamped with whichever version was seen first. ADR-0017 declined to fix this on the spot because it would change `ExternalNode.id`'s locked shape, which explicitly requires its own ADR and a `schemaVersion` bump for any breaking change, and it didn't want a dedup bugfix to make that schema decision by accident.

That decision record has now been revisited and the fix is being made.

## Decision

`ExternalNode.id` disambiguates by version only when a package name actually has more than one distinct resolved version in the current graph - the common single-version case is unchanged:

- `DefaultGraphBuilder.buildImportGraph` (`src/graph-building/default/default-graph-builder.ts`) makes a first pass over every resolved `external` import to collect the set of distinct versions seen per package name.
- If a package name has exactly one distinct version (the overwhelming majority of real repos, and every existing fixture), `id` stays exactly the package name, unchanged from before - no existing consumer or golden fixture sees any difference.
- If a package name has more than one distinct version, `id` becomes `` `${packageName}@${version}` `` - one `ExternalNode` per distinct version, `name` staying the plain package name (`version` already carries the version separately; `name` is not the disambiguated id). Each import edge's `target` points at the specific version node that import actually resolved to, so no importer's edge silently points at a version other than the one it really resolved.
- This is the same "only disambiguate on an actual collision, otherwise keep the plain name" shape already used by `deriveModuleNames`'s top-name/deep-name collision fallback (`documentation/adr/0013`) - a precedented pattern in this codebase, not a new idiom.

This is additive for every repo that only ever resolves one version per package name (the common case: `id` is byte-identical to before) and a genuine, intentional shape change only for the rare case that actually needs disambiguating - which is exactly why it's a minor `schemaVersion` bump (`1.0.0` → `1.1.0`) rather than a major one: no existing consumer relying on "External id is always the bare package name" breaks unless their own repo actually has divergent versions of the same package, in which case they were already getting silently wrong data.

## Consequences

- The schema spec's node-id-scheme section documents both cases.
- `SCHEMA_VERSION` in `src/output/json/build-map-json.ts` is `"1.1.0"`.
- All five golden fixtures' `schemaVersion` field bumped to `"1.1.0"`; none of their `ExternalNode` ids change shape, since none exercise a divergent-version scenario.
- `default-graph-builder.test.ts`'s ADR-0017 regression test ("keeps the first-seen version, deterministically...") is rewritten to assert the new, correct behavior: both versions survive as distinct nodes, and each importer's edge points at the version it actually resolved.
- ADR-0017 is marked Superseded rather than deleted, keeping the historical record of why the fix was originally deferred.
