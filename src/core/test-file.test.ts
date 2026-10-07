import { isTestFile } from "src/core/test-file";
import { describe, expect, it } from "vitest";

describe("isTestFile", () => {
	it("matches a simple .test.<ext> file", () => {
		expect(isTestFile("src/core/test-file.test.ts")).toBe(true);
	});

	it("matches a simple .spec.<ext> file", () => {
		expect(isTestFile("src/core/test-file.spec.tsx")).toBe(true);
	});

	it("matches a double-extension .test.d.ts declaration file", () => {
		expect(isTestFile("src/core/test-file.test.d.ts")).toBe(true);
	});

	it("matches a double-extension .spec.d.ts declaration file", () => {
		expect(isTestFile("src/core/test-file.spec.d.ts")).toBe(true);
	});

	it("does not match a file that merely contains 'test' as a substring", () => {
		expect(isTestFile("src/core/latest.ts")).toBe(false);
		expect(isTestFile("src/core/testing.ts")).toBe(false);
	});

	it("does not match a non-test file", () => {
		expect(isTestFile("src/core/test-file.ts")).toBe(false);
	});

	it("matches TS/JS's test/tests/__tests__ directory convention (AVA/Mocha/Jest)", () => {
		expect(isTestFile("test/methods/create.js")).toBe(true);
		expect(isTestFile("tests/create.js")).toBe(true);
		expect(isTestFile("__tests__/create.tsx")).toBe(true);
		expect(isTestFile("src/create.js")).toBe(false);
	});

	it("scopes the JS test/ directory convention to JS/TS extensions - a .py file under the same directory name matches Python's own rule instead, not this one", () => {
		expect(isTestFile("test/fixtures/widget.rb")).toBe(false);
		// Still a test file overall - via Python's own test/tests/ directory rule below, not this one.
		expect(isTestFile("test/fixtures/widget.py")).toBe(true);
	});

	it("matches Go's _test.go suffix convention", () => {
		expect(isTestFile("pkg/widget_test.go")).toBe(true);
		expect(isTestFile("pkg/widget.go")).toBe(false);
		expect(isTestFile("pkg/latest.go")).toBe(false);
	});

	it("matches Java's src/test/ standard source root convention", () => {
		expect(isTestFile("app/src/test/java/com/foo/WidgetSpec.java")).toBe(true);
		expect(isTestFile("src/test/java/Foo.java")).toBe(true);
		expect(isTestFile("app/src/main/java/com/foo/Widget.java")).toBe(false);
	});

	it("matches Java's *Test.java/*Tests.java class-name convention", () => {
		expect(isTestFile("com/foo/WidgetTest.java")).toBe(true);
		expect(isTestFile("com/foo/WidgetTests.java")).toBe(true);
		expect(isTestFile("com/foo/Widget.java")).toBe(false);
		expect(isTestFile("com/foo/Testable.java")).toBe(false);
	});

	it("matches Rust's top-level tests/ integration-test convention", () => {
		expect(isTestFile("tests/widget_integration.rs")).toBe(true);
		expect(isTestFile("crates/widget/tests/smoke.rs")).toBe(true);
		expect(isTestFile("src/widget.rs")).toBe(false);
	});

	it("matches Python's test_*.py and *_test.py pytest conventions", () => {
		expect(isTestFile("test_widget.py")).toBe(true);
		expect(isTestFile("pkg/test_widget.py")).toBe(true);
		expect(isTestFile("pkg/widget_test.py")).toBe(true);
		expect(isTestFile("pkg/widget.py")).toBe(false);
		expect(isTestFile("pkg/latest.py")).toBe(false);
	});

	it("matches Python's test/tests/ directory convention (pytest's own discovery default)", () => {
		expect(isTestFile("tests/conftest.py")).toBe(true);
		expect(isTestFile("tests/fixtures.py")).toBe(true);
		expect(isTestFile("tests/unit/helpers.py")).toBe(true);
		expect(isTestFile("test/widget.py")).toBe(true);
		expect(isTestFile("pkg/widget.py")).toBe(false);
	});

	it("does not extend Python's tests/ directory convention to another language's own test/ folder", () => {
		expect(isTestFile("test/fixtures/widget.rs")).toBe(false);
	});

	it("matches Python's conftest.py at any directory level, not only inside a tests/ directory", () => {
		expect(isTestFile("conftest.py")).toBe(true);
		expect(isTestFile("alchemy/conftest.py")).toBe(true);
		expect(isTestFile("src/pkg/subpkg/conftest.py")).toBe(true);
	});
});
