import { withParseLogging } from "src/core/observability/parse-logging";
import { fakeLogger } from "src/core/test-helpers";
import type { Parser } from "src/extraction/parser";
import { describe, expect, it } from "vitest";

const parser: Parser = {
	parse: (_rootDir, _programFiles, extractFiles) =>
		extractFiles.slice(1).map((filePath) => ({
			filePath,
			symbols: [],
			imports: [],
			calls: [],
		})),
};

describe("withParseLogging", () => {
	it("logs extracted and skipped counts per language, passing results through unchanged", () => {
		const { logger, calls } = fakeLogger();

		const result = withParseLogging("go", parser, logger).parse("/r", ["/r/a.go", "/r/b.go"], ["/r/a.go", "/r/b.go"]);

		expect(result.map((r) => r.filePath)).toStrictEqual(["/r/b.go"]);
		expect(calls).toStrictEqual([
			[
				"info",
				"parse complete",
				{
					language: "go",
					files: 2,
					extracted: 1,
					skipped: 1,
					durationMs: expect.any(Number),
				},
			],
		]);
	});

	it("logs nothing for a language with no files this run", () => {
		const { logger, calls } = fakeLogger();

		withParseLogging("rust", parser, logger).parse("/r", [], []);

		expect(calls).toStrictEqual([]);
	});
});
