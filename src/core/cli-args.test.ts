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

describe("--scip-index", () => {
	it("maps a language to an index path, on both generate and read", () => {
		expect(parseGenerateArgs(["--scip-index", "python=build/index.scip"]).scipIndexes).toStrictEqual({
			python: "build/index.scip",
		});
		expect(parseReadArgs(["--scip-index", "python=index.scip"]).scipIndexes).toStrictEqual({ python: "index.scip" });
	});

	it("keeps an '=' inside the path", () => {
		expect(parseGenerateArgs(["--scip-index", "python=out/a=b.scip"]).scipIndexes).toStrictEqual({
			python: "out/a=b.scip",
		});
	});

	it("leaves scipIndexes out entirely when the flag is not given", () => {
		expect(parseGenerateArgs([])).not.toHaveProperty("scipIndexes");
	});

	it("rejects a language with no SCIP support yet", () => {
		expect(() => parseGenerateArgs(["--scip-index", "go=index.scip"])).toThrow(/--scip-index.*python/);
	});

	it("rejects a value with no language", () => {
		expect(() => parseGenerateArgs(["--scip-index", "index.scip"])).toThrow(/--scip-index/);
	});

	it("rejects the same language given twice", () => {
		expect(() => parseGenerateArgs(["--scip-index", "python=a.scip", "--scip-index", "python=b.scip"])).toThrow(
			/python.*more than once/,
		);
	});
});

describe("--run-indexers", () => {
	it("opts generate into running indexers, and is absent otherwise", () => {
		expect(parseGenerateArgs(["--run-indexers"]).runIndexers).toBe(true);
		expect(parseGenerateArgs([])).not.toHaveProperty("runIndexers");
	});

	it("is not a read flag, since read never runs indexers", () => {
		expect(() => parseReadArgs(["--run-indexers"])).toThrow(/Unknown flag --run-indexers/);
	});

	it("takes no value", () => {
		expect(() => parseGenerateArgs(["--run-indexers", "yes"])).toThrow(/--run-indexers takes no value/);
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
