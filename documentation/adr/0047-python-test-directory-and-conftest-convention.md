# 0047: Python test files are also recognized by a test/tests/ directory and conftest.py

[Back to documentation/adr/README.md](README.md)

## Status

Accepted. Extends `isTestFile`'s Python convention (previously filename-suffix only:
`test_*.py`/`*_test.py`) the same way documentation/adr/0033 already extended TS/JS's own convention beyond
its filename suffix, to a directory layout.

## Context

Running the generator against a real Python codebase (`beyond-alchemy`) produced a Module named
`alchemy+scripts+tests` - an otherwise-clean `alchemy/` directory pulled into a three-way composite
by exactly one file, `tests/conftest.py`. `conftest.py` is pytest's fixture/plugin-registration file
- universally recognized test infrastructure, auto-discovered and loaded by pytest itself - but
`isTestFile`'s Python patterns only ever matched a filename suffix (`test_foo.py`, `foo_test.py`);
`conftest.py` matches neither, so it was never excluded from discovery and never routed to the
dedicated `tests` Module (documentation/adr/0010) the way every other test file in the project already is.

The same gap extends further than just `conftest.py`: a Python project's `tests/` directory
routinely holds more than individually-`test_`-prefixed files - shared fixtures, factories, `conftest.py`,
helper utilities - none of which any filename-suffix rule was ever going to catch. TS/JS already has
exactly this shape of rule (documentation/adr/0033's `test/`/`tests/`/`__tests__/` directory convention, for
AVA/Mocha/Jest layouts that don't rely on a `.test.`/`.spec.` suffix at all), and Java has its own
equivalent (`src/test/`, the Maven/Gradle standard source root). Python's own `tests/`-directory
convention - pytest's own default test-discovery root - had no equivalent rule at all until now.

An existing test (`test-file.test.ts`'s "does not extend the JS test/ directory convention to
another language's own tests/ folder") had already asserted `test/fixtures/widget.py` was *not* a
test file - correct at the time (Python had no directory rule of its own to match it with
instead), now updated to assert the opposite, for the opposite reason: it's a test file via
Python's own new rule, not via the JS-scoped one leaking across languages.

## Decision

Two new patterns in `TEST_FILE_PATTERNS` (`src/core/test-file.ts`), both scoped to `.py` only - the
same "each language's own directory rule stays restricted to its own extensions" discipline
documentation/adr/0033's TS/JS rule and Rust's `tests/*.rs` rule already follow, so a same-named `test/`/`tests/`
directory elsewhere in a polyglot repo isn't affected:

- `(^|\/)(?:test|tests)\/.*\.py$` - any `.py` file under a top-level `test/` or `tests/` directory,
  at any depth below it (pytest's test discovery isn't restricted to one level, unlike Rust's
  Cargo-integration-test convention, so this pattern isn't either).
- `(^|\/)conftest\.py$` - `conftest.py` specifically, matched at *any* directory level, not only
  inside a `test/`/`tests/` directory - pytest honors a package-scoped `conftest.py` sitting right
  alongside its own production code just as readily as one inside a dedicated tests directory.

## Consequences

- Measured on `beyond-alchemy`: `tests/conftest.py` is now excluded from discovery by default (and
  would route to the dedicated `tests` Module if `--include-tests` were passed), the same as every
  other test file in the project. The `alchemy+scripts+tests` Module's composite name loses its
  `tests` segment - revisit once confirmed, but expect it to resolve to a cleaner name now that one
  fewer stray file forces the interpolation.
- `test-file.test.ts` gained three tests: the directory convention (`tests/conftest.py`,
  `tests/fixtures.py`, `tests/unit/helpers.py`, `test/widget.py`), `conftest.py` matched at any
  depth (bare, nested under a package, nested under `src/`), and the directory rule *not* extending
  to another language's extension under the same directory name (`test/fixtures/widget.rb`). The
  one existing test this decision reverses (documented above) is updated in place, with its
  assertion flipped and its name rewritten to explain why.
- This is additive only for every other language's own convention - no existing pattern changed,
  only two new Python-scoped ones added. A Python file that was already correctly classified
  (production or test) is unaffected; only a `.py` file under `test/`/`tests/`, or a `conftest.py`
  at any level, changes classification, and always in the direction of "now correctly recognized as
  a test file."
