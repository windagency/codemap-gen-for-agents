import { isHelpRequest, parseGenerateArgs, parseReadArgs } from "src/core/cli-args";
import { describe, expect, it } from "vitest";

describe("parseGenerateArgs", () => {
	it("parses --root, --out, --config, --force, and --include-tests", () => {
		const args = parseGenerateArgs([
			"--root",
			"/repo",
			"--out",
			"out-dir",
			"--config",
			"cfg.json",
			"--force",
			"--include-tests",
		]);

		expect(args).toStrictEqual({
			rootDir: "/repo",
			outDir: "out-dir",
			configPath: "cfg.json",
			force: true,
			includeTests: true,
		});
	});

	it("defaults force and includeTests to false and leaves unset flags undefined", () => {
		expect(parseGenerateArgs([])).toStrictEqual({
			rootDir: undefined,
			outDir: undefined,
			configPath: undefined,
			force: false,
			includeTests: false,
		});
	});
});

describe("parseReadArgs", () => {
	it("parses --root, --out, --config, --path, --symbol-kind, --search, and --include-tests", () => {
		const args = parseReadArgs([
			"--root",
			"/repo",
			"--out",
			"out-dir",
			"--config",
			"cfg.json",
			"--path",
			"src/api",
			"--symbol-kind",
			"class",
			"--search",
			"widget",
			"--include-tests",
		]);

		expect(args).toStrictEqual({
			rootDir: "/repo",
			outDir: "out-dir",
			configPath: "cfg.json",
			path: "src/api",
			symbolKind: "class",
			search: "widget",
			includeTests: true,
		});
	});

	it("leaves every flag undefined and defaults includeTests to false when none are given", () => {
		expect(parseReadArgs([])).toStrictEqual({
			rootDir: undefined,
			outDir: undefined,
			configPath: undefined,
			path: undefined,
			symbolKind: undefined,
			search: undefined,
			includeTests: false,
		});
	});

	it("throws a clear error for an invalid --symbol-kind value instead of silently matching nothing", () => {
		expect(() => parseReadArgs(["--symbol-kind", "bogus-kind"])).toThrow(/Invalid --symbol-kind value "bogus-kind"/);
	});
});

describe("strict flag parsing", () => {
	it("rejects an unknown flag instead of silently ignoring it", () => {
		expect(() => parseGenerateArgs(["--bogus"])).toThrow(/Unknown flag --bogus/);
	});

	it("rejects a read-only flag passed to generate", () => {
		expect(() => parseGenerateArgs(["--path", "src"])).toThrow(/Unknown flag --path/);
	});

	it("rejects a value flag with no value", () => {
		expect(() => parseGenerateArgs(["--root"])).toThrow(/--root needs a value/);
	});

	it("rejects a value flag followed directly by another flag", () => {
		expect(() => parseReadArgs(["--path", "--include-tests"])).toThrow(/--path needs a value/);
	});

	it("rejects a value given to a boolean flag", () => {
		expect(() => parseGenerateArgs(["--force", "yes"])).toThrow(/--force takes no value/);
	});

	it("rejects a stray positional argument", () => {
		expect(() => parseGenerateArgs(["src"])).toThrow(/Unexpected argument "src"/);
	});
});

describe("isHelpRequest", () => {
	it.each([
		[["--help"]],
		[["-h"]],
		[["generate", "--help"]],
		[["read", "-h"]],
		[["generate", "--root", ".", "--help"]],
	])("returns true for %j", (argv) => {
		expect(isHelpRequest(argv)).toBe(true);
	});

	it.each([[[]], [["generate"]], [["read", "--search", "help"]]])("returns false for %j", (argv) => {
		expect(isHelpRequest(argv)).toBe(false);
	});
});
