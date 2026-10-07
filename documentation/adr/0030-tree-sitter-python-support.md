# 0030: Python added as a fourth tree-sitter language, PEP 621 `pyproject.toml` only

[Back to documentation/adr/README.md](README.md) • [Back to HLD.md](../HLD.md) • [Back to USER_GUIDE.md](../USER_GUIDE.md) • [Back to NEXT_STEPS.md](../../NEXT_STEPS.md)

## Status

Accepted

## Context

[ADR-0027](0027-tree-sitter-multi-language-extraction.md) added Go/Rust/Java on tree-sitter and explicitly anticipated a fourth language following the same shape: one grammar package, one `src/extraction/tree-sitter-<language>/` directory implementing `Parser`, registered in `parser-factory.ts`, at the same "syntactic, repo-wide name-based candidate matching" fidelity tier as the other three. Python is that fourth language. `tree-sitter-python` is a first-party grammar package with the same native-N-API shape as `tree-sitter-go`/`tree-sitter-rust`/`tree-sitter-java`, so the extraction-strategy decision ADR-0027 made generalizes directly - this ADR only records the choices specific to Python's own manifest and import system, which differ enough from Go/Rust/Java's to need their own record.

Python's package-manifest landscape is more fragmented than Go's (one `go.mod` shape) or Rust's (one `Cargo.toml` shape): a real repo might declare its project via PEP 621's standardized `[project]` table in `pyproject.toml`, via Poetry's older `[tool.poetry]` table (also in `pyproject.toml`, but a different, non-standardized shape), via `setup.py`/`setup.cfg` (setuptools' pre-`pyproject.toml` convention), or via a bare `requirements.txt` with no project metadata at all.

## Decision

Only a `pyproject.toml` carrying a PEP 621 `[project]` table (`name`, `dependencies`) is recognized as a Python Package root - mirroring Rust's own "no `[package]` table, no crate" precedent (`cargo-toml.ts`/`readCargoManifest`) rather than inventing a new pattern. `setup.py`, `setup.cfg`, `requirements.txt`, and a Poetry-only `pyproject.toml` (a `[tool.poetry]` table with no `[project]` table) are all treated the same way an unmanaged directory always has been: files beneath them are manifest-less, surfaced via the existing warnings path, never silently invented a Package.

Dependency versions are read from `[project.dependencies]`'s PEP 508 requirement strings (`"requests>=2.28.0"`), reduced to a bare distribution name plus its version specifier verbatim - a requirement with no version specifier at all (`"click"`) is left out entirely, the same way Rust's git/path dependencies with no `version` key are, since `ExternalNode.version` is never optional (`CONTEXT.md`'s External section).

Import resolution has no equivalent to Go's `go.mod`-declared module path (the one thing an internal absolute import always resolves against unambiguously) - `pyproject.toml`'s `[project].name` is a PyPI distribution name, not a declared import root. Absolute imports are instead resolved by trying the project's own root directory (a flat layout) and `${projectRootDir}/src` (a src layout) as candidate import roots, in that order. Relative imports (`from . import x`, `from ..pkg import y`) need no such guess - they resolve purely from the importing file's own directory and the number of leading dots, independent of any manifest.

External resolution matches an absolute import's top-level segment against a declared dependency's name, normalized per PEP 503 (lowercase, `-`/`_`/`.` treated as equivalent) on both sides - this resolves the common case where the import name and the distribution name agree (`requests`, `flask`, `numpy`) and simply leaves the irregular cases (PyPI `Pillow` imports as `PIL`, `beautifulsoup4` as `bs4`, `PyYAML` as `yaml`) unresolved, since no general import-name -> distribution-name mapping exists without installed package metadata this syntactic pass never has.

Symbol classification follows Go/Rust's own "recurse into every nesting container" shape: a top-level `def`/`class` is a Symbol, a class body's own `def`s are `method` Symbols, and a class body's own assignments are skipped entirely (never a Symbol) the same way a Go struct's fields or a Rust struct's fields are - never a plain attribute. A `@decorator`-wrapped definition is unwrapped and classified identically to an undecorated one. Exported/private follows Python's own convention (PEP 8's leading underscore), not Go's capitalization-based one. Python has no item-granularity test convention needing a per-symbol `isTestItem` tag the way Rust's `#[test]`/`#[cfg(test)]` does - pytest's `test_*.py`/`*_test.py` convention is file-granularity, already covered by `src/core/test-file.ts` the same way Go's `_test.go` is.

## Consequences

- A Poetry-only or setup.py/setup.cfg-only Python project produces no Package node and every one of its `.py` files reports as manifest-less, until/unless it also carries a `[project]` table. This is a real, disclosed fidelity gap, not a bug: extending recognition to Poetry's `[tool.poetry]` shape or to setup.py's arbitrary Python-code-as-manifest is future work, not attempted here.
- The src-vs-flat layout guess can occasionally cross-resolve: a repo with both a flat-layout top-level package and an unrelated `src/` directory (rare, but not impossible) could have an absolute import incorrectly match the wrong one. No repo in this codebase's own fixtures exercises that overlap; it's accepted as the same class of syntactic-heuristic risk Go's own directory-is-the-package assumption already carries under a nonstandard layout (ADR-0027's own Consequences).
- Conditional imports (inside `if TYPE_CHECKING:`, `try:`/`except ImportError:`, or any other non-top-level control flow) are invisible to this pass - only a module's direct top-level children are scanned for `import`/`from` statements, the same "no control-flow awareness" boundary Go/Rust/Java's own top-level-only scans already draw.
- Adding a fifth tree-sitter-backed language later still follows ADR-0027's own shape; this ADR is Python's own record of where its manifest/import-resolution choices diverge from Go/Rust/Java's, for whoever writes that fifth language's own ADR next.

## Update: every import statement is scanned

The third consequence above no longer holds. `collectImportSpecs` now scans every `import`/`from` statement in the file, including ones inside `if TYPE_CHECKING:`, `try:`/`except ImportError:`, and function bodies. An optional or type-only import therefore produces an edge; there is still no control-flow awareness to tell them apart.
