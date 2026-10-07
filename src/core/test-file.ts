// Returns whether `fileId` (a repo-relative path) looks like a test file, by filename/path
// convention.
//
// The one, shared definition of "a test file": filename convention `*.test.<ext>` /
// `*.spec.<ext>` (documentation/adr/0010-test-files-are-their-own-module.md), TS/JS test directories
// (documentation/adr/0033), and each other language's own convention
// (documentation/adr/0030). Discovery-time exclusion and clustering/module-naming's dedicated "tests" bucket
// both mean the same thing by "test file" and must stay in lockstep, so this is their one shared
// source of truth rather than each keeping its own copy. Takes the full repo-relative path (not
// just the basename) because several of these conventions are path-shaped, not filename-shaped:
// TS/JS `test/`/`tests/`/`__tests__/`, a Java `src/test/` source root, and Cargo's `tests/`.
//
// The optional `(?:d\.)?` in the TS/JS pattern accounts for TypeScript's double-extension
// declaration files (e.g. `foo.test.d.ts`): without it, `[^./]+` can never match an extension
// segment that itself contains a dot, so `foo.test.d.ts` would silently fall through both
// discovery exclusion and Louvain/naming bucketing despite plainly being a test file's
// declaration output.
const TEST_FILE_PATTERNS = [
	/\.(test|spec)\.(?:d\.)?[^./]+$/, // TS/JS: foo.test.ts, foo.spec.tsx
	// TS/JS (directory convention): test/**, tests/**, __tests__/** - the layout AVA, Mocha, and
	// Jest each conventionally use instead of (or alongside) the `*.test.ext` filename suffix
	// above; e.g. execa's `test/methods/create.js`. Restricted to JS/TS extensions, the same way
	// Rust's own `tests/*.rs` directory rule below is restricted to `.rs`, so a same-named
	// directory in another language's part of a polyglot repo isn't affected.
	/(^|\/)(?:test|tests|__tests__)\/.*\.(?:d\.)?[cm]?[jt]sx?$/,
	/_test\.go$/, // Go: foo_test.go
	/(^|\/)src\/test\//, // Java (Maven/Gradle standard layout): src/test/**
	/(?:Test|Tests)\.java$/, // Java (class-name convention): FooTest.java, FooTests.java
	/(^|\/)tests\/[^/]+\.rs$/, // Rust (Cargo integration tests): tests/*.rs
	/(^|\/)test_[^/]+\.py$/, // Python (pytest convention): test_foo.py
	/_test\.py$/, // Python (pytest convention): foo_test.py
	// Python (pytest convention, directory): a top-level test/ or tests/ directory, any depth below
	// it - pytest's own test-discovery default, the Python-ecosystem equivalent of the TS/JS
	// test/tests/__tests__ rule above (its own, separately-scoped pattern, not an extension of that
	// one - a same-named tests/ directory in another language's part of a polyglot repo isn't
	// affected, same restriction Rust's tests/*.rs rule below already applies). Catches a directory
	// full of test support code (fixtures, factories, `conftest.py`) that no filename-suffix rule
	// would, on its own, ever recognise.
	/(^|\/)(?:test|tests)\/.*\.py$/,
	// Python (pytest convention): conftest.py, pytest's fixture/plugin-registration file, honored by
	// pytest at any directory level (not only inside a test/tests/ directory - a package-scoped
	// conftest.py can sit right alongside its own production code).
	/(^|\/)conftest\.py$/,
];

export function isTestFile(fileId: string): boolean {
	return TEST_FILE_PATTERNS.some((pattern) => pattern.test(fileId));
}
