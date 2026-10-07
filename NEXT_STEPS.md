# Next steps

[Back to README.md](README.md) • [Back to AGENTS.md](AGENTS.md) • [Back to 0027-tree-sitter-multi-language-extraction.md](documentation/adr/0027-tree-sitter-multi-language-extraction.md) • [Back to HLD.md](documentation/HLD.md)

Source of truth for this project's open, decided-but-not-built items. Every other doc that used to restate this list (`documentation/HLD.md`'s Non-goals, `documentation/adr/0027-tree-sitter-multi-language-extraction.md`'s Consequences) points here instead of carrying its own copy - check an item here, don't re-describe it there.

Each item says what's decided, what isn't, and which ADR to read before starting. Check a box only once the work has actually merged, not when it's scoped - scoping a future ADR is part of the item, not completion of it.

## Open

- [ ] **Toolchain-based resolution for Go/Rust/Java/Python** - matches TS/JS's type-checked fidelity instead of tree-sitter's syntactic candidate matching. Decided ceiling, not final fidelity: [ADR-0027](documentation/adr/0027-tree-sitter-multi-language-extraction.md).
  Scoping from the LSP/SCIP/runtime-tracing discussion: don't build this as a live LSP client - LSP is async by nature, and this codebase already rejected an async parsing backend once (`web-tree-sitter`, ADR-0027's "alternative considered"), for the same reason a live LSP integration would hit. A SCIP-based `Parser` implementation fits better: run a per-language SCIP indexer (`scip-typescript`, `scip-go`, rust-analyzer's own indexer, `lsif-java`, a Python equivalent) once, out of process, as a batch step, then have the `Parser` read the resulting index file synchronously - this slots into the existing `Parser` seam (`parser-factory.ts`) without touching its sync interface, and moves the toolchain-installed constraint to index-generation time instead of generator run time.
  Needs its own ADR before implementation: which indexer per language, how the index file is located/invalidated relative to incremental caching ([ADR-0005](documentation/adr/0005-incremental-extraction-caching.md)), and what happens when no indexer is installed (same "documented limitation, never a silent guess" posture as ADR-0027's unqualified-reference candidates).

- [ ] **A sixth+ language (C#, Ruby, ...)** - the `Parser` seam supports registering one; none is registered yet.
  Follows ADR-0027's own stated shape for adding a fourth tree-sitter language: one grammar package, one `src/extraction/tree-sitter-<language>/` directory implementing `Parser`, registered in `parser-factory.ts`. No new ADR needed for the mechanism - only for language-specific fidelity caveats, the same way [ADR-0030](documentation/adr/0030-tree-sitter-python-support.md) covered Python's.

- [ ] **Wider Python project recognition** - only a PEP 621 `[project]` table in `pyproject.toml` is recognised today. A Poetry-only `pyproject.toml` (`[tool.poetry]`, no `[project]`), `setup.py`, `setup.cfg`, and a bare `requirements.txt` never produce a Package root ([ADR-0030](documentation/adr/0030-tree-sitter-python-support.md)) - files beneath them stay manifest-less.
  Scoping this means deciding, per format, whether it becomes a real Package root or stays explicitly unsupported; ADR-0030's existing rejection reasoning is the starting point, not a settled no for all four.

- [ ] **Dynamic/runtime-traced call edges** - the schema's `kind` discriminant already reserves `"dynamic"` next to `"static"` ([ADR-0027](documentation/adr/0027-tree-sitter-multi-language-extraction.md)); nothing produces it yet.
  Scoping from the LSP/SCIP/runtime-tracing discussion: this is not a parser-fidelity upgrade like the toolchain-based resolution item above - it's a different input source entirely. Today the generator never executes the target repo's code; producing `dynamic` edges means instrumenting and running it (test suite execution, or a traced app run), per language, and correlating trace spans back to already-extracted Symbols. It's the only decided path to recovering the cross-language edges the Rejected section below says are never synthesised (a Go file calling a Rust binary over a socket) - tracing can observe that call happening, where no static parser ever will. Scope this as its own milestone, not a sub-task of the toolchain-based resolution item: it needs an execution-environment decision (how the target repo gets run, with what safety boundaries) before any extraction-format question even comes up.

## Rejected (not open - listed so they aren't re-proposed)

- **Synthesised cross-language edges** (inferred FFI/cgo bindings, build-system glue, network/RPC contracts) - never attempted even where two files are known to interact at runtime ([ADR-0027](documentation/adr/0027-tree-sitter-multi-language-extraction.md)). The dynamic-tracing item above is the only decided way this gets revisited - it observes the edge rather than inferring it.
- **Declared or LLM-proposed Module boundaries** - considered and rejected in favour of deterministic community detection ([ADR-0001](documentation/adr/0001-algorithmic-module-detection.md)).

## Before starting any of these

Read `CONTRIBUTING.md`'s routing table and the relevant ADR(s) linked above in full - this file is a pointer, not a substitute for either.
