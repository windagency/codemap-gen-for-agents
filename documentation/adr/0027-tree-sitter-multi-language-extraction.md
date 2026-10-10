# 0027: tree-sitter adopted for Go/Rust/Java, at deliberately lower fidelity than TS/JS

[Back to README.md](../../README.md) • [Back to 0002-ts-compiler-api-over-tree-sitter.md](0002-ts-compiler-api-over-tree-sitter.md) • [Back to 0030-tree-sitter-python-support.md](0030-tree-sitter-python-support.md) • [Back to 0056-scip-index-resolution-for-tree-sitter-languages.md](0056-scip-index-resolution-for-tree-sitter-languages.md) • [Back to documentation/adr/README.md](README.md) • [Back to HLD.md](../HLD.md) • [Back to USER_GUIDE.md](../USER_GUIDE.md) • [Back to GOVERNANCE.md](../../GOVERNANCE.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md)

## Status

Accepted

## Context

[ADR-0002](0002-ts-compiler-api-over-tree-sitter.md) deferred tree-sitter for this milestone's TS/JS-only scope, on the grounds that adopting it "would only pay off once a second language is actually being added." That second-language slice is Go, Rust, and Java, shipped together as one release. Each language needs its own extraction strategy decision, since ADR-0002 explicitly left that undecided for whatever came next.

None of the three has anything resembling `typescript`'s compiler-API-with-a-real-type-checker story available as a plain npm dependency. A toolchain-based option exists for each (`go/packages`+`go/types`, `cargo check`/rust-analyzer, `javac`+Maven/Gradle classpath resolution) but each requires shelling out to (or embedding) that language's own build tooling - a real dependency on the host having Go/Cargo/a JDK+build tool installed, version-matched to the target repo, with associated process-spawn and classpath-resolution failure modes. tree-sitter, by contrast, ships pure grammar parsers as ordinary (native, N-API) npm packages, with zero assumption that the target repo's own toolchain is installed or even runnable.

## Decision

Extraction for Go, Rust, and Java uses tree-sitter - syntactic parsing only, no type checker, no dependency on the target repo's own toolchain being installed. Call and import resolution for these three languages is repo-wide name-based candidate matching (a namespace/path-qualified reference resolves to its specific target; an unqualified one enumerates every same-named top-level declaration as a candidate, never a single guess) - a documented, lower-fidelity tier than TS/JS's whole-program type-checked resolution, not an attempt to match it.

This is a deliberate two-tier fidelity model, not an oversight: TS/JS keeps its existing type-checked resolution unchanged (`TsCompilerApiParser` is untouched by this slice), while Go/Rust/Java get "good enough to be useful, honest about its limits" syntactic resolution. A toolchain-based version for Go/Rust/Java, matching TS/JS's fidelity, is reserved for a future milestone - see Consequences.

### Package/dependency landscape

`tree-sitter` (the native N-API core) plus one grammar package per language (`tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java`) are added as ordinary dependencies. Each grammar package declares its own `tree-sitter` peer-version range, and those ranges don't agree with each other or with the latest `tree-sitter` release - installing all three under one `tree-sitter` version requires `pnpm install --legacy-peer-deps`-equivalent tolerance (in practice, pnpm's own peer-dependency warning, not a hard failure). This is accepted as a known, cosmetic friction of this three-grammar-at-once install, not a functional problem: the native ABI these packages bind against has been stable across the versions in play, confirmed by parsing real Go/Rust/Java source with all three loaded together. Each grammar package's native addon is built from source at install time (no prebuilt binaries shipped for any of the three) - a real macOS/Linux build-toolchain (Python, a C/C++ compiler) dependency for anyone installing this project from source, not just anyone running the generator against an unrelated Go/Rust/Java repo.

An alternative considered: `web-tree-sitter` (the WASM build), which sidesteps the native-build and peer-version friction entirely and ships prebuilt `.wasm` grammars via companion packages. Rejected because its `Parser.init()`/`Language.load()` initialization is asynchronous (WASM instantiation), and the existing `Parser` interface (`parse(rootDir, programFiles, extractFiles): ExtractedSymbols[]`) is synchronous by design, used synchronously throughout `generate-map.ts`'s orchestration. Keeping that interface's shape completely unchanged (a hard requirement for this slice, see [`LLD.md`](../LLD.md)) ruled out an async-only parsing backend.

## Consequences

- Go/Rust/Java imports/calls this generator reports can be wrong in ways TS/JS's never is: a namespace-qualified call can still misresolve if the syntactic heuristic for "what does this qualifier refer to" guesses wrong (e.g. Rust's `crate::`/`self::`-only module-path resolution, or Go's directory-is-the-package assumption breaking under a nonstandard layout), and an unqualified call's candidate list is exactly that - candidates, never a single confirmed target the way a type-checked call always is for TS/JS.
- No cross-language edges are ever synthesized (no inferred FFI/cgo bindings, no build-system glue, no network/RPC contracts) - a Go file calling into a Rust binary over a socket, or a Java service invoking a Go microservice, shows up as no edge at all, not a guessed one. Documented as a known limitation in `documentation/USER_GUIDE.md` alongside the existing single-root-tsconfig/installed-node_modules/nominal-only-dispatch ones.
- A future toolchain-based (type-checked) version for Go/Rust/Java - matching TS/JS's current fidelity - is out of scope for this slice and reserved as a documented future milestone. Whoever builds it inherits this ADR's own tradeoff data point: toolchain-based resolution buys accuracy at the cost of requiring the target repo's own build tooling to be installed and runnable, a real constraint tree-sitter was chosen specifically to avoid for this slice.
- Adding a fourth tree-sitter-backed language later follows this same shape (one grammar package, one `src/extraction/tree-sitter-<language>/` directory implementing `Parser`, registered in `parser-factory.ts`) - the fidelity tradeoff this ADR documents applies to that language too, not just these three.

## Update: tracked in NEXT_STEPS.md

The next milestone toolchain-based resolution this ADR reserves, and the never-synthesized cross-language edges this ADR's Consequences describe, are now tracked as checklist items in [`NEXT_STEPS.md`](../../NEXT_STEPS.md) - that file is the current source of truth for whether either has been scoped or started; this ADR's own Context/Decision/Consequences text above is unchanged.
