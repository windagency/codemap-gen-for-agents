# Low-level design

[Back to README.md](../README.md) • [Back to CONTEXT.md](../CONTEXT.md) • [Back to 0017-external-node-version-dedup-limitation.md](adr/0017-external-node-version-dedup-limitation.md) • [Back to 0027-tree-sitter-multi-language-extraction.md](adr/0027-tree-sitter-multi-language-extraction.md) • [Back to 0029-json-envelope-warnings-field.md](adr/0029-json-envelope-warnings-field.md) • [Back to 0039-execution-flow-module-ordering.md](adr/0039-execution-flow-module-ordering.md) • [Back to 0044-exclude-globs-match-under-hidden-directories.md](adr/0044-exclude-globs-match-under-hidden-directories.md) • [Back to documentation/adr/README.md](adr/README.md) • [Back to FLOWS.md](FLOWS.md) • [Back to HLD.md](HLD.md) • [Back to USER_GUIDE.md](USER_GUIDE.md)

Exact interfaces, types, and implementation detail per component, verified directly against `src/` (not just against the ADRs - a few real values below only exist in code, not in any decision record). For the shape and rationale of the pipeline itself, see [`HLD.md`](HLD.md).

## `src/core/` - composition root and cache

`compose.ts`'s `createDefaultPipeline()` wires one instance of each seam - `Discovery`, `Parser` (a `CompositeParser` over one `ParserFactory.createParser(language)` per language, each wrapped in `withParseLogging`), `GraphBuilder` (via `GraphBuilderFactory.create()`), `ModuleDetector`, `JsonTransformer`, `HtmlTransformer` - into a single `CodemapGenerator`. Every adapter (CLI/MCP/Skill) depends on `compose.ts` and nothing lower; it also re-exports the logger, `GENERATOR_VERSION`, and `SYMBOL_KINDS` so no file under `integration/` imports another `core/` module. The seam boundaries this composition root assembles (and the dependency-direction rules in [HLD.md](HLD.md#seams)) are enforced by `src/__tests__/architecture/dependency-direction.test.ts` - a regex-based Vitest test standing in for `arch-unit-ts` (not installed; `typescript@7` isn't yet supported by `dependency-cruiser`).

`core/cache/extraction-cache.ts`:

```ts
interface CacheFile {
  epoch: string;
  files: Record<string, { contentHash: string; extractedSymbols: ExtractedSymbols }>;
}

interface EpochInputs {
  generatorVersion: string;
  tsconfigRawText: unknown;               // raw <root>/tsconfig.json text, or null
  excludePatterns: string[];              // sorted before hashing
  includeTests: boolean;
  dependencyFiles: Record<string, string>; // manifest/lockfile path -> content, root and every Package root
}

function computeEpoch(inputs: EpochInputs): string; // sha256 of a JSON payload
```

Stored at `<outDir>/cache.json`, validated on load by `cache/cache-schema.ts`. A missing or corrupt file resolves to `EMPTY_CACHE` (`epoch: ""`), which can never match a real computed epoch, forcing a full re-extraction with no separate error-handling path. `diffFiles()` first compares the epoch, then per-file sha256 content-hash diffing against `CacheFile.files`.

`core/config.ts`:

```ts
// zod .strict() schema in config-schema.ts, JSON only
interface CodemapConfig {
  outDir?: string;    // default ".codemap"
  exclude?: string[]; // default [], layered onto built-in defaults below
}

const DEFAULT_OUT_DIR = ".codemap";
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/target/**", "**/vendor/**", "**/.stryker-tmp/**", "**/.pnpm-store/**"];
```

Discovery is flat and non-walking: `<rootDir>/codemap.config.json` only, or an explicit override path. No `rootDir` field on the config itself - `rootDir` is resolved independently (CLI `--root` / MCP `rootDir` param, default `process.cwd()`), never inferred from where the config file happens to live.

## `src/discovery/` - the `Discovery` seam

```ts
interface Discovery {
  discover(rootDir: string, exclude: string[], includeTests?: boolean): DiscoveredStructure;
}
```

`FilesystemDiscovery` (`src/discovery/filesystem/`) walks the tree once per `generate` call. `ELIGIBLE_EXTENSIONS = {ts, tsx, js, jsx, mjs, cjs, go, rs, java, py}`, each mapped to a manifest family by the one language registry, `src/core/languages.ts`: npm (`package.json`), Go (`go.mod`), Rust (`Cargo.toml`, only when it declares a `[package]` table - a pure virtual `[workspace]` root owns no crate of its own), Java (`pom.xml`, or `build.gradle`/`build.gradle.kts`), Python (`pyproject.toml` with a PEP 621 `[project]` table). Manifest detection lives in `src/discovery/filesystem/manifest-detection.ts`; the Cargo/pyproject "is this a Package" checks are shared with extraction from `src/core/cargo-toml.ts`/`src/core/pyproject-toml.ts`. A directory is a Package root for a family iff it contains that family's manifest; families are tracked independently, so a directory hosting two manifests (e.g. `go.mod` and `package.json`) produces two Package nodes, each id disambiguated as `${directoryPath}@${family}` (ADR-0021's "only disambiguate on collision" idiom) - a lone manifest keeps the plain directory-path id. A file's Package is its own family's nearest ancestor manifest, so Packages never nest. Directory nodes are lazily materialised - only directories with at least one descendant File are emitted. An exclude pattern ending in `/**` also prunes the bare directory itself, not just its contents. The project's own root `.gitignore` is always consulted too, alongside `DEFAULT_EXCLUDE` and the caller's own `exclude` - a file excluded by any of the three is excluded, via `GitignoreMatcher` (`src/discovery/filesystem/gitignore-matcher.ts`, wrapping the `ignore` package behind the same `GlobMatcher` interface `PicomatchGlobMatcher` uses) ([ADR-0045](adr/0045-discovery-follows-the-root-gitignore.md)). Not cached between runs; it's a cheap walk, and Package/Directory boundaries can shift even when no file's content changed.

Test files (`isTestFile` in `src/core/test-file.ts`: per-language conventions, including TS/JS `test/`, `tests/`, `__tests__/` directories per [ADR-0033](adr/0033-ts-js-test-directory-convention.md)) are excluded from discovery entirely by default, so they never become File nodes ([ADR-0011](adr/0011-exclude-test-files-by-default.md)); passing `includeTests` opts back in. Once included, they're excluded from domain clustering and bucketed into one dedicated `tests` Module shared across the whole codebase, regardless of folder or which production files they import ([ADR-0010](adr/0010-test-files-are-their-own-module.md)).

## `src/extraction/ts-compiler-api/` - the `Parser` seam

```ts
interface Parser {
  parse(rootDir: string, programFiles: string[], extractFiles: string[]): ExtractedSymbols[];
}
```

`programFiles` builds one `ts.Program` internally (whole-program, for correct cross-file type resolution); only `extractFiles` - the content-hash-changed subset - is actually walked and extracted. This is the only seam that ever holds a `ts.Program`/`ts.TypeChecker`; `ExtractedSymbols` carries already-resolved import/call targets (file path, external package name, or candidate callee declarations), never raw AST nodes.

- **Unparseable files:** `collectSkippedFiles()` identifies files with genuine syntactic diagnostics (not mere type errors, which still extract normally). A skipped file produces no entry at all; any import that resolves to it is treated exactly like an unresolved specifier, never a dangling edge target.
- **External version resolution:** memoised per resolved package directory. With nothing installed, falls back to the range declared in the nearest `package.json` within the repo that lists the package ([ADR-0032](adr/0032-ts-declared-version-fallback.md)); the paragraph below describes the installed case. Given an import resolved under some `node_modules/<pkg>`, the resolver walks upward from that exact path to the nearest `package.json` whose `"name"` matches, and reads its `"version"` - never a lockfile. This works uniformly for a registry-, git-, or `link:`-referenced dependency alike, since each carries a normal installed `package.json` too. A missing or malformed `package.json` produces no External node at all rather than one with a missing version.
- **Ambiguous call dispatch:** interface/abstract-method calls enumerate concrete candidates via `implements`/`extends` heritage clauses only (transitive, matched by method name, generics ignored) - never structural/duck-typed matching.
- **tsconfig:** exactly one `<rootDir>/tsconfig.json` is read and used to build the single `ts.Program`; a workspace member's own `tsconfig.json` is never consulted, even if it diverges. A file that tsconfig's `include` doesn't cover falls back to its own default project rather than being skipped as unparseable.

## `src/extraction/composite-parser.ts` and `tree-sitter-{go,rust,java,python}/` - Go/Rust/Java/Python, wired at `compose.ts`

`createCompositeParser` (itself just another `Parser`) partitions `programFiles`/`extractFiles` by extension and delegates each partition to its own registered language `Parser`, merging the resulting `ExtractedSymbols[]` arrays - `GraphBuilder` never sees which Parser produced which entry. Each of `tree-sitter-go/`, `tree-sitter-rust/`, `tree-sitter-java/`, `tree-sitter-python/` mirrors `ts-compiler-api/`'s own internal shape (symbol classification / import resolution / call resolution, split across files) but is syntactic (tree-sitter, no type checker, ADR-0027, ADR-0030): a repo-wide `Map<filePath, RawSymbolTable>` is built once per `parse()` call from the *whole* `programFiles` set (mirroring `ts.Program`'s own whole-program requirement), then consulted for both intra-file extraction and cross-file candidate lookups. All four share one `parse()` skeleton, `tree-sitter-common/tree-sitter-parser.ts`'s `parseWithTreeSitter`: each language supplies only its grammar, declaration classifier, whole-program index, and per-file import/call resolution. A file whose tree holds an ERROR or MISSING node is dropped from the index and from import resolution, and surfaces as an unparseable-file warning. Symbol `#N` numbering and candidate ordering come from `src/extraction/raw-extraction.ts`, shared with the TS/JS Parser.

- **Go** (`go-parser.ts`): a package is a directory; `go.mod`'s `module` line plus `require` entries resolve an import path to either every `.go` file in the target directory (internal) or an External (`packageName`/`version` = the matching `require` entry - no match, e.g. stdlib, is `unresolved`). A qualified call (`pkg.Func()`) resolves through that file's own import-alias map to the target directory's functions only; an unqualified call, or a method call via `x.Method()` on an unknown-typed receiver, matches every same-named function (or method) repo-wide.
- **Rust** (`rust-parser.ts`): `collectDeclaredSymbols` recurses into every inline `mod { ... }` body (not just the file's own top level) - none of that nesting is "inside a function/method body," the one boundary this slice draws. A `#[cfg(test)]` module or `#[test]`-attributed function is tagged `RawSymbol.isTestItem` rather than dropped in the Parser itself (Rust's is the one test convention that's item-, not file-, granularity - see ADR-0028); `generate-map.ts`'s `stripHiddenTestItems` removes tagged symbols and any call naming them, downstream, only when `includeTests` is off. `use crate::…`/`use self::…` paths resolve to a crate-relative `src/` file (module-path first, then its path-minus-last-segment as an item's declaring file); anything else resolves against `Cargo.toml`'s `[dependencies]` by extern-crate name (hyphens → underscores). A call through `Type::method()` resolves via every `impl Type` block's own methods, repo-wide, regardless of which file declares the impl; a bare `module::function()` resolves through that file's own `use`-alias map first, falling back to treating the path as already `crate::`/`self::`-rooted.
- **Java** (`java-parser.ts`): no Maven/Gradle directory-layout assumption at all - a repo-wide `fqcn -> file` index is built from each file's own `package` declaration plus its top-level type names, so import resolution works regardless of source-root layout. A static import's path is split into `Class.member`; a wildcard import (`import a.b.*;`) fans out to every class already in that package. External resolution matches `pom.xml`'s `<dependency>` blocks, or a generic `"group:artifact:version"` string literal scan for `build.gradle(.kts)` (covers the common Groovy/Kotlin DSL dependency-declaration shape without parsing either language), by groupId-prefix. A call whose `object` names a known type resolves to that type's own methods only; anything else (including every unqualified call) matches every same-named method repo-wide.
- **Python** (`python-parser.ts`): `collectDeclaredSymbols` recurses into every `class` body (not a file's own top level only) - a class's own `def`s become `method` Symbols, its own assignments are never Symbols (never a plain attribute), and a `@decorator`-wrapped `def`/`class` is unwrapped before classification. `pyproject.toml`'s PEP 621 `[project]` table (`dependencies`, PEP 508 requirement strings) is the only recognised manifest (ADR-0030) - no `[tool.poetry]`/`setup.py`/`setup.cfg`/`requirements.txt` support. An absolute import tries the project root and `${projectRoot}/src` (no declared root import name exists the way `go.mod`'s `module` line gives Go one); a relative import (`from . import x`) resolves purely from the importing file's own directory and dot count. External resolution matches an import's top segment against a declared dependency by PEP-503-normalised name - an import name that genuinely differs from its distribution name (PyPI `Pillow` -> `PIL`) is left unresolved. A qualified call (`mod.func()`) resolves through that file's own import-alias map to the target file's functions only; an unqualified call, or an attribute call through anything else (including `self.method()`), matches every same-named function (or method) repo-wide.

## `src/extraction/scip-resolver.ts` and `scip/` - SCIP index refinement, wired at `compose.ts`

`createScipIndexResolver` runs inside `generateMap`'s parse stage, after `Parser.parse()` and before the cache merge, on the freshly extracted files only ([ADR-0056](adr/0056-scip-index-resolution-for-tree-sitter-languages.md)). It is a post-parse step, not a `Parser` wrapper, because `Parser.parse()` takes no per-run options and returns no warnings. `generateMap` hands it one `IndexSource` per `SCIP_LANGUAGES` entry (`python` today): the explicit path from `GenerateMapOptions.scipIndexes`, else `<rootDir>/index.scip` when it exists.

- `scip/scip-index-reader.ts` is the only module importing `@scip-code/scip` and `@bufbuild/protobuf` (dependency-direction test). It decodes the whole file, then `scip-index-schema.ts` validates and flattens it to `scip-index.ts`'s plain shape. A missing or undecodable file becomes an `unreadableIndexes` entry, never a throw.
- Document paths resolve against whichever candidate root has the most documents on disk: the recorded `projectRoot` if it exists here, then the index file's directory and each of its ancestors.
- `scip/scip-staleness.ts` compares a document's stored `text` exactly. Without it, a file with a recorded content hash, from an index the generator ran, must hash the same now. Without either, it checks every occurrence of a type, term, method, or parameter still covers its own name. Every indexed file is checked, not only fresh ones, since a call can target an unchanged file.
- `scip/scip-call-refinement.ts` matches an occurrence to a `RawCall` by line range and callee name (`EdgeLocation` has no columns), then maps the occurrence's definition to the `RawSymbol` with the same name and start line. An in-repo hit replaces the candidates. Hits that are all out of repo drop the call. No hit, a target in a stale file, or an in-repo target that is not a `RawSymbol`, such as a Go interface method, keeps tree-sitter's candidates.
- A file the index misses or that went stale keeps its output unchanged and gets `ExtractedSymbols.indexFallback`, which `cache.json` stores, so a cached file keeps its warning. `generateMap` formats fallbacks and unreadable indexes with `core/index-warning.ts` after `skippedFiles` in `warnings`, returns them as `GeneratedMap.indexWarnings`, and the commands log one `scip index fallback: <reason>` event each.
- Each index's content hash is an epoch input (`EpochInputs.scipIndexes`).
- With `GenerateMapOptions.runIndexers`, `generateMap` calls `scip-indexer.ts`'s `ScipIndexer` between Discovery and the cache diff, for every `SCIP_LANGUAGES` entry with no supplied source. It runs one indexer per Package of that language owning at least one of its program files, with the Package directory as working directory. Output is `<outDir>/scip/<encodeURIComponent(packageId)>.scip`, the root Package as `%2E`, beside a `.hashes.json` sidecar validated by `scip/index-hashes-schema.ts`. A sidecar matching every current hash reuses the index. Otherwise the old index and sidecar are deleted before the run. Each produced index becomes an `IndexSource` carrying `fileHashes`, and each failure an `indexer-failed` warning naming the Package. Argv per language: `scip-python index --output <path> --quiet`, `scip-go index --output <path>`. Go first runs its `check`, `go build -o <os.devNull> ./...`; a failure keeps the index and becomes an `IndexerCheckFailure` with the first stderr line that is not a `#` header, stored as the sidecar's `checkFailure` and re-reported on reuse as an `indexer-check-failed` warning.
- `<rootDir>/index.scip` is a source only for the languages `IndexResolver.languagesIn` finds documents of, or for every language with no explicit path when it cannot be read, so it warns. Only an explicit path or a readable default stops `ScipIndexer` from running for a language. The resolver decodes each distinct index path once per run and reports it unreadable once.
- `scip/indexer-process.ts` is the only module importing `node:child_process` (dependency-direction test). It runs `spawnSync` with no shell, the given timeout, stdout ignored, and stderr kept only for its last line. `compose.ts` reaches it through `createDefaultScipIndexer`, since `core/` may not import `scip/`.

## `src/graph-building/default/` - the `GraphBuilder` seam

```ts
function build(symbols: ExtractedSymbols[], structure: DiscoveredStructure): RawGraph;
```

Pure - no filesystem or type-checker access (confirmed: no `fs`/`path` import in the implementation, only string operations on already-posix-relative ids). Import edges are merged by a `(source, target)` natural key; an unresolved import produces no edge. Call edges fan out one `CallEdge` per ambiguous dispatch candidate, merged the same way.

**Id scheme:**
- File id = repo-relative POSIX path (e.g. `src/barrel.ts`)
- Symbol id = `${filePath}#${localId}` (e.g. `src/solo.ts#standalone`)
- External id = package name, or `${packageName}@${version}` when that name resolves to more than one distinct version in the same graph (documentation/adr/0021)
- Package id = manifest directory path, or `${directoryPath}@${family}` when more than one manifest kind roots at that same directory (Discovery's own disambiguation, threaded through unchanged)

`language` on File/Package/External: File's is derived purely from extension (independent of which Parser produced it - `.js`/`.jsx`/`.mjs`/`.cjs` are "javascript" even though the "typescript" Parser extracts them); Package's comes straight from `DiscoveredPackage.language`; External's comes from `ResolvedImportTarget`'s `external` variant, set by whichever Parser resolved it (the one place `ExtractedSymbols`' shape gained a field for this slice).

## `src/clustering/louvain/` - the `ModuleDetector` seam

Wraps `graphology-communities-louvain` behind a domain-named interface (deliberately not called an "Adapter" - see [HLD.md](HLD.md#adapters)). Real classification thresholds, present only in source, not in [ADR-0001](adr/0001-algorithmic-module-detection.md)'s prose:

```ts
const MIN_COMMUNITY_SIZE = 2;  // originally 3, lowered by ADR-0015
const MIN_EMBEDDEDNESS = 0.5;   // weighted-degree ratio, see below
const MIN_MODULARITY = 0.1;    // whole-graph modularity
```

Import edges going into Louvain are not weighted 1:1 - an edge between two files is weighted `3 ** (shared leading directory segments)`, so folder-proximate files are exponentially favoured to land in the same community ([ADR-0007](adr/0007-folder-proximity-weighted-detection.md)). A cross-directory edge is further discounted by `Math.max` of its two endpoints' fan-in/fan-out across distinct outside directories: a file reused identically by several sibling directories (e.g. a tree-sitter-common helper imported the same way by every tree-sitter-\<language\> parser - high fan-*in*) is architecturally a shared dependency of all of them, not evidence it belongs to whichever one Louvain's tie-breaking happens to favour ([ADR-0036](adr/0036-shared-dependency-fan-in-dilutes-folder-proximity.md)); the dual case is a dispatcher fanning *out* to one file in each of several sibling directories alike (e.g. a parser factory importing one concrete parser per language) - same tie, opposite direction, diluted the same way ([ADR-0037](adr/0037-dispatcher-fan-out-dilutes-folder-proximity.md)). The discount never drops a weight below the pre-ADR-0007 floor of 1, and is skipped for a same-directory edge or one where both endpoints' counts are `<= 1`. The embeddedness ratio below is computed over that same weighted view, not a raw edge count ([ADR-0014](adr/0014-weighted-embeddedness.md)).

Classification order, first match wins:

1. `degree === 0` → `unassignedReason: "isolated"`
2. community smaller than `MIN_COMMUNITY_SIZE` → `"undersized"`
3. weighted internal-degree ratio below `MIN_EMBEDDEDNESS` → `"low-embeddedness"`
4. whole-graph modularity below `MIN_MODULARITY` → `"degenerate-partition"`
5. otherwise → assigned a real `moduleId`

`MIN_COMMUNITY_SIZE` is 2 rather than 1: a node can never end up in a community of size 0 (it's always at least in a community with itself), so a floor of 1 would be dead code. 2 is the smallest floor that excludes anything real - a true Louvain singleton community ([ADR-0015](adr/0015-community-size-floor-lowered-to-two.md); [ADR-0016](adr/0016-module-detector-factory-split-from-interface.md) split the detector construction out of the interface, no behaviour change).

A known build-tooling config file (`isConfigFile` in `src/core/config-file.ts`: a closed list of recognised JS/TS tool basenames immediately before `.config.<ext>` or `.<tool>rc.<ext>`, e.g. `eslint.config.js`, `vitest.config.ts`) is excluded from the import graph the same way a test file is, but assigned `{ moduleId: null, unassignedReason: "config" }` directly rather than bucketed into a shared Module - an unrelated `eslint.config.js` and `vitest.config.ts` share no more domain than either shares with any other file, so there's no "tests"-style bucket to put them in ([ADR-0048](adr/0048-config-files-are-excluded-from-clustering.md)).

`classify`'s result then goes through four more passes before `detect` returns it. `reconcilePackageFragmentation` runs first: for every moduleId whose production files resolve to more than one Package (`owningPackageOf`, the longest-matching-prefix Package lookup shared with the JSON Transformer's naming tiers below), each Package's own slice is reassigned to a fresh, distinct moduleId - a Package is a stronger version of the same boundary a directory already is, so a Module is never allowed to straddle two of them regardless of how real the import edge connecting them is ([ADR-0049](adr/0049-never-merge-packages-across-modules.md)). `refineOversizedCommunities` runs next: for every moduleId whose files span more directories than `MAX_DIRECTORY_BREADTH` past their own common ancestor, its own files and the edges strictly between them are re-clustered from scratch (`clusterFileIds`, the same `buildImportGraph` + `louvain.detailed` + `classify` sequence `detect` itself runs, factored out so this pass can call it recursively) - with the rest of the repo's edges removed, modularity optimisation's resolution limit no longer distorts the comparison, often surfacing real per-directory sub-communities a repo-wide run merged together. Accepted only if the recursive pass finds more than one resulting sub-community; otherwise the Module is left untouched ([ADR-0051](adr/0051-recursive-refinement-of-oversized-communities.md)). `reconcileDirectoryFragmentation` then forces every production file in one exact directory into the same Module - the minority joins whichever Module already holds a genuine majority of that directory, or, for a tie between two or more substantial groups (every tied contender holding more than one file here), whichever has the lowest moduleId; only a tie between genuine individuals (one file apiece) is left unreconciled ([ADR-0038](adr/0038-never-fragment-a-directory-across-modules.md), narrowed by [ADR-0040](adr/0040-directory-reconciliation-skips-ties-and-rechecks-size.md), narrowed again by [ADR-0053](adr/0053-force-directory-ties-between-substantial-groups.md)); run after both the Package split and the oversized-community refinement, so every moduleId it considers is already Package-pure and it can never reintroduce a cross-Package merge, and any fragmentation the refinement pass itself introduced within one directory is cleaned up the same way `classify`'s own first pass already is. `enforceMinimumCommunitySize` then re-counts every Module's final size: reconciling one directory's majority can pull a file's only community-mate into a *different* directory's majority (or a Package split, or a refinement split, can leave its own slice too small on its own), shrinking a Module below `MIN_COMMUNITY_SIZE` after the fact - such a file is unassigned (`"undersized"`), the same outcome `classify` would have produced had it seen this final shape (ADR-0040). Test files and config files take part in none of these four passes (their own dedicated handling above already settles them).

Louvain runs with `randomWalk: false` plus a fixed, sorted node/edge insertion order, to guarantee the same input always produces the same output (required for golden-file repeatability).

## `src/output/json/build-map-json.ts` - the JSON `Transformer`

```ts
const SCHEMA_VERSION = "1.3.0";

interface MapJson {
  schemaVersion: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  modules: ModuleSummary[]; // { id, name } - see module-naming.ts below
  languages: Language[]; // every language actually present in `nodes`, deduplicated and sorted - computed here, not threaded through the pipeline
  warnings: string[]; // skipped-file warnings threaded in from generate-map.ts via TransformOptions, defaulting to [] (documentation/adr/0029)
}
```

A pure shaping function - deduplication and call fan-out already happened in `GraphBuilder`. Nodes are sorted by ordinal (non-locale) string comparison on `id`; edges by a 4-key sort. Both are required for byte-identical output on repeated runs over unchanged input.

`src/clustering/module-naming.ts`'s `deriveModuleNames` computes the `modules` array. The naming rule has moved on from [ADR-0006](adr/0006-module-naming-from-container-folder.md)'s original "nearest common ancestor directory" through several amendments, in order:

1. A codebase-wide universal root segment (e.g. `src`, present on every file) is stripped before naming, since it carries no distinguishing information ([ADR-0008](adr/0008-strip-universal-root-from-module-names.md)).
2. The name is normally the *top-level* segment of the (root-stripped) common ancestor, not its deepest segment, so every Module name sits at the same comparable depth ([ADR-0012](adr/0012-module-names-use-top-level-directory.md)).
3. If that top-level name collides between two or more Modules (e.g. `src/output/html/` and `src/output/json/` both landing on `output`), the deepest common-ancestor segment (`html`, `json`) is tried instead ([ADR-0013](adr/0013-deeper-name-disambiguates-top-level-collisions.md)).
4. When a Module's files share no closer ancestor than the root - or its common ancestor bottoms out at a single segment, so step 3's "deepest segment" is the same string as step 2's top-level one and can't disambiguate against itself - the distinct child directories one level past that common ancestor are interpolated into a composite name instead (e.g. `core+__tests__`, or `tree-sitter-go` disambiguating from a sibling Module's `tree-sitter-common+tree-sitter-java`), rather than falling straight to an ordinal ([ADR-0009](adr/0009-interpolated-module-names.md), extended to this second case by [ADR-0035](adr/0035-interpolated-name-is-also-a-collision-tier.md)). Capped at `MAX_DIRECTORY_BREADTH` (4, shared with the clustering-side community-refinement trigger): a Module scattered across more children than that joins none of them here ([ADR-0046](adr/0046-interpolated-names-are-capped.md)).
5. If that still collides, or there was nothing left to interpolate at all - whether because every file sits with zero depth past the common ancestor (a monorepo package's own entrypoint files directly in its `src/`), or because step 4 instead overflowed (too many children, not zero) - the Module's owning Package's declared name is tried next, but only when every one of its files resolves to the *same* Package (`singlePackageNameOf`) *and* that Module is genuinely the Package's own root: either the Package owns no other Module at all, or every other Module the Package owns has this Module's own common ancestor as a prefix of its own (`isPackageRootModule`), i.e. lives nested somewhere beneath it rather than beside it as an equally-deep peer, and this Module itself got here with zero children left over, not by overflowing ([ADR-0041](adr/0041-package-name-is-a-fourth-naming-tier.md), restricted by [ADR-0050](adr/0050-overflowing-modules-skip-ambiguous-package-names.md), [ADR-0054](adr/0054-deepname-filler-for-dishonest-package-fallback.md), and [ADR-0055](adr/0055-package-root-distinguishes-ancestor-from-peer.md)) - naming a Module that's merely a peer of its Package's other Modules after that Package would misrepresent it as the Package as a whole, while a genuine root Module naming itself after the Package is simply accurate. When the Package name isn't offered, the Module's own deepest real directory segment is used in its place instead of jumping straight to an ordinal ([ADR-0054](adr/0054-deepname-filler-for-dishonest-package-fallback.md)) - sharing that value with whichever sibling Module(s) are in the identical situation, so they continue colliding honestly into step 6 rather than each prematurely settling on their own ordinal.
6. If a name still collides after all of the above, or there's no directory or Package information to derive one from, every still-colliding Module is grouped by its own `deepName` (step 3's value) and, where two or more share one, numbered against each other (`cli-1`, `cli-2`, ...) rather than given an unrelated integer - unless that shared `deepName` is already reserved by a different, earlier-settled Module, in which case it falls to the plain `"Module " + id"` label instead ([ADR-0052](adr/0052-numbered-names-for-same-directory-collisions.md), [ADR-0054](adr/0054-deepname-filler-for-dishonest-package-fallback.md)).
7. A Module made entirely of test files is named `"tests"` directly, bypassing the folder-derived rules ([ADR-0010](adr/0010-test-files-are-their-own-module.md)).

Steps 2-5 aren't a strict sequential pipeline where a collision pushes *every* colliding Module down together: `resolveNamesByPriority` walks the four tiers tracking which names earlier tiers already settled, and reserves each one - a Module that reaches an identical string only via a *later* tier (e.g. documentation/adr/0035's interpolation, purely by coincidence) can't reclaim a name an unrelated Module already settled on one tier earlier, and keeps falling instead. Two Modules that collide at the *same* tier are unaffected - neither has priority over the other, so both still fall through together ([ADR-0042](adr/0042-earlier-tier-names-are-reserved-against-later-collisions.md)).

The array's own order is then decided separately, by `src/clustering/module-ordering.ts`'s `orderModulesByExecutionFlow`: a Module it imports from is listed before it, mirroring reading order (dependency first). Two or more Modules that mutually depend on each other - a composition root and the satellites it both supplies shared types to and wires concrete implementations back in from, this codebase's own `core/` among them - are collapsed into one block via Tarjan's strongly-connected-components algorithm, since no "before" is meaningful among them, and ordered alphabetically within that block. Any other tie between independently-placeable Modules is also broken alphabetically by name ([ADR-0039](adr/0039-execution-flow-module-ordering.md)).

## `src/output/html/` - the HTML `Transformer`

Two client-side views, each a pure algorithm that is unit-tested server-side and shipped to the browser via `.toString()` on the literal tested function (no hand-duplicated client logic):

- **Flow view** - `computeImportChain`: a cycle-safe BFS from a clicked File, numbering edges in first-traversal order.
- **Force-directed view** - `computeRegionId`: groups nodes into visual regions by detected Module. Scoped to File/External nodes only, not Symbol - a codebase's Symbol count routinely runs 10x+ its File count, and simulating one physics particle per Symbol stops being renderable well before a real-sized repo's scale ([ADR-0043](adr/0043-force-view-scoped-to-file-and-external-nodes.md)).
- **Filtering** - `matchesFilterNode`: the same Path / Symbol-kind / Search facets as the MCP `read` tool, plus an HTML-only Language facet, AND-combined. A Symbol's own `language` is resolved through its owning File via an optional `nodesById` lookup passed in by the caller (the function itself stays a standalone, dependency-free predicate - `nodesById` is a plain argument, not an import).

D3 is vendored by reading the installed `d3` package's own `dist/d3.min.js` off disk at generation time and inlining it - never fetched from a CDN, so the output file is genuinely offline-safe. A real generated file for the `barrel-file` fixture is ~320KB, almost entirely vendored D3 rather than graph data.

## `src/integration/cli/` - `CliAdapter`

`main.ts` first checks for `--help`/`-h` anywhere in argv (`core/cli-args.ts`'s `isHelpRequest`, shared with the Skill); if present, it prints `CLI_HELP` to stdout and exits `0`, before any subcommand or flag validation. Otherwise it recognises exactly one subcommand, `generate`; anything else (including no arguments) prints the usage line to stderr and exits `1`. Within `generate`, an unrecognised flag, a value flag with no value, or a stray positional argument is rejected with exit `1`. Flags (`--root`, `--out`, `--config`, `--force`, `--include-tests`, and the repeatable `--scip-index <language>=<path>`) are parsed in `core/cli-args.ts`, shared verbatim with the Skill's own argument parsing.

## `src/integration/mcp/` - `McpAdapter`

`server.ts` registers two tools, named exactly `generate` and `read`, via `@modelcontextprotocol/sdk`'s `McpServer`, with zod input schemas (`tool-input-schema.ts`, [ADR-0031](adr/0031-zod-confined-to-schema-modules.md)) matching [ADR-0004](adr/0004-public-interface-contract.md) and a `.describe()` string on every field. `read`'s `symbolKind` enum (`function | method | class | const | type | interface | enum`) is kept in sync with `core/types.ts`'s `SymbolKind` via a `satisfies` type check, so they can't silently drift apart. `main.ts` starts a plain stdio server:

```ts
const server = createMcpServer();
await server.connect(new StdioServerTransport());
```

`McpServer`'s own `version` field is `GENERATOR_VERSION`, read once from this package's own `package.json`.

## `src/integration/skill/` - `SkillAdapter`

`SKILL.md` lives directly at `src/integration/skill/SKILL.md` (not under `.claude/skills/`). The companion script builds to `dist/integration/skill/main.js`, and `pnpm build` copies `SKILL.md` beside it, so `dist/integration/skill/` is a self-contained skill directory. `SKILL.md` invokes the script as `node "${CLAUDE_SKILL_DIR}/main.js"`, which Claude Code expands to wherever that directory is installed. Unlike the CLI, this script supports **both** `generate` and `read` subcommands, printing one JSON object to stdout matching the corresponding MCP tool's return shape (except `--help`/`-h`, which prints `skill-help.ts`'s plain-text `SKILL_HELP` and exits `0`, same as the CLI) - the one surface where ADR-0004's "same subcommands as the CLI" claim doesn't quite hold, since the CLI itself is generate-only.

## Divergences from the ADRs worth knowing

- The default exclude glob list is a real source value not written into any ADR beyond its two newest entries; this document is its source of truth for the rest. `**/.stryker-tmp/**` and `**/.pnpm-store/**`, and the glob matcher's `dot: true` option that makes every entry in this list (old and new) actually apply underneath a hidden ancestor directory, are covered by [ADR-0044](adr/0044-exclude-globs-match-under-hidden-directories.md). (Louvain's own thresholds - community size, embeddedness, modularity - are already covered by [ADR-0015](adr/0015-community-size-floor-lowered-to-two.md) and [ADR-0014](adr/0014-weighted-embeddedness.md); see the `src/clustering/louvain/` section above.)
- The multi-language slice's own spec framed `GraphBuilder`'s contract and the TS/JS Parser's implementation as "completely untouched" - in practice, both gained the minimum needed to carry the new `language` field through (`default-graph-builder.ts` now derives/copies it onto File/Package/External nodes; `ts-compiler-api/import-resolution.ts` gained one line setting `language: "typescript"` on its own External branch). Neither's existing behaviour, fidelity, or test suite shape changed beyond that.
