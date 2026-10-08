import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDefaultPipeline } from "src/core/compose";
import { runGenerateCommand } from "src/core/generate-command";
import type { LogContext, Logger } from "src/core/observability/logger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function fakeLogger(): {
	logger: Logger;
	calls: [string, string, LogContext | undefined][];
} {
	const calls: [string, string, LogContext | undefined][] = [];
	const record = (level: string) => (message: string, context?: LogContext) => {
		calls.push([level, message, context]);
	};
	return {
		logger: {
			debug: record("debug"),
			info: record("info"),
			warn: record("warn"),
			error: record("error"),
		},
		calls,
	};
}

describe("runGenerateCommand", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-generate-"));
		fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "generate-command-fixture" }));
		fs.writeFileSync(path.join(rootDir, "index.ts"), "export function main() { return 1; }");
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("produces real codemap.json/codemap.html files at the resolved outDir and returns matching counts", () => {
		const result = runGenerateCommand({ rootDir }, createDefaultPipeline());

		expect(fs.existsSync(result.jsonPath)).toBe(true);
		expect(fs.existsSync(result.htmlPath)).toBe(true);

		const parsed = JSON.parse(fs.readFileSync(result.jsonPath, "utf8")) as {
			nodes: unknown[];
			edges: unknown[];
		};
		expect(result.nodeCount).toBe(parsed.nodes.length);
		expect(result.edgeCount).toBe(parsed.edges.length);
		expect(result.nodeCount).toBeGreaterThan(0);
	});

	it("defaults outDir to <rootDir>/.codemap", () => {
		const result = runGenerateCommand({ rootDir }, createDefaultPipeline());

		expect(result.jsonPath).toBe(path.join(rootDir, ".codemap", "codemap.json"));
	});

	it("an explicit outDir input overrides the config file's outDir", () => {
		fs.writeFileSync(path.join(rootDir, "codemap.config.json"), JSON.stringify({ outDir: "configured-out" }));

		const result = runGenerateCommand({ rootDir, outDir: "explicit-out" }, createDefaultPipeline());

		expect(result.jsonPath).toBe(path.join(rootDir, "explicit-out", "codemap.json"));
	});

	it("resolves rootDir from process.cwd() when none is given, independent of wherever the generator package itself is installed", () => {
		const originalCwd = process.cwd();
		process.chdir(rootDir);
		try {
			const result = runGenerateCommand({}, createDefaultPipeline());
			expect(result.jsonPath).toBe(path.join(fs.realpathSync(rootDir), ".codemap", "codemap.json"));
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("passes force through to the orchestrator, bypassing the incremental cache", () => {
		const receivedOptions: { force?: boolean }[] = [];
		const fakeGenerator = {
			generateMap(_rootDir: string, options: { force?: boolean }) {
				receivedOptions.push(options);
				return {
					json: JSON.stringify({ nodes: [], edges: [] }),
					html: "<html></html>",
					skippedFiles: [],
					nodeCount: 0,
					edgeCount: 0,
				};
			},
		};

		runGenerateCommand({ rootDir, force: true }, fakeGenerator);

		expect(receivedOptions).toStrictEqual([expect.objectContaining({ force: true })]);
	});

	it("passes includeTests through to the orchestrator", () => {
		const receivedOptions: { includeTests?: boolean }[] = [];
		const fakeGenerator = {
			generateMap(_rootDir: string, options: { includeTests?: boolean }) {
				receivedOptions.push(options);
				return {
					json: JSON.stringify({ nodes: [], edges: [] }),
					html: "<html></html>",
					skippedFiles: [],
					nodeCount: 0,
					edgeCount: 0,
				};
			},
		};

		runGenerateCommand({ rootDir, includeTests: true }, fakeGenerator);

		expect(receivedOptions).toStrictEqual([expect.objectContaining({ includeTests: true })]);
	});

	it("passes scipIndexes through as absolute paths, an explicit input winning over the config file", () => {
		fs.writeFileSync(
			path.join(rootDir, "codemap.config.json"),
			JSON.stringify({ scipIndexes: { python: "configured.scip" } }),
		);
		const receivedOptions: { scipIndexes?: Record<string, string> }[] = [];
		const fakeGenerator = {
			generateMap(_rootDir: string, options: { scipIndexes?: Record<string, string> }) {
				receivedOptions.push(options);
				return {
					json: JSON.stringify({ nodes: [], edges: [] }),
					html: "<html></html>",
					skippedFiles: [],
					nodeCount: 0,
					edgeCount: 0,
				};
			},
		};

		runGenerateCommand({ rootDir }, fakeGenerator);
		runGenerateCommand({ rootDir, scipIndexes: { python: "explicit.scip" } }, fakeGenerator);

		expect(receivedOptions.map((options) => options.scipIndexes)).toStrictEqual([
			{ python: path.join(rootDir, "configured.scip") },
			{ python: path.join(rootDir, "explicit.scip") },
		]);
	});

	it("logs each SCIP index fallback as its own warning", () => {
		const fakeGenerator = {
			generateMap() {
				return {
					json: JSON.stringify({ nodes: [], edges: [] }),
					html: "<html></html>",
					skippedFiles: [],
					indexWarnings: [
						{ reason: "index-stale" as const, file: "app/service.py" },
						{ reason: "index-unreadable" as const, file: "/repo/index.scip", detail: "cannot read" },
					],
					nodeCount: 0,
					edgeCount: 0,
				};
			},
		};
		const { logger, calls } = fakeLogger();

		runGenerateCommand({ rootDir }, fakeGenerator, logger);

		expect(calls).toStrictEqual([
			[
				"warn",
				"scip index fallback: index-stale",
				{ file: "app/service.py", warning: "SCIP index is stale, used tree-sitter resolution: app/service.py" },
			],
			[
				"warn",
				"scip index fallback: index-unreadable",
				{ file: "/repo/index.scip", warning: "Unreadable SCIP index /repo/index.scip: cannot read" },
			],
		]);
	});

	it("logs each generateMap warning instead of silently discarding it", () => {
		const fakeGenerator = {
			generateMap() {
				return {
					json: JSON.stringify({ nodes: [], edges: [] }),
					html: "<html></html>",
					skippedFiles: [{ file: "broken.ts", reason: "unparseable" as const }],
					nodeCount: 0,
					edgeCount: 0,
				};
			},
		};
		const { logger, calls } = fakeLogger();

		runGenerateCommand({ rootDir }, fakeGenerator, logger);

		expect(calls).toStrictEqual([
			["warn", "file skipped: unparseable", { file: "broken.ts", warning: "Skipped unparseable file: broken.ts" }],
		]);
	});

	it("logs a manifest-less-file warning with a distinct event name from an unparseable one", () => {
		const fakeGenerator = {
			generateMap() {
				return {
					json: JSON.stringify({ nodes: [], edges: [] }),
					html: "<html></html>",
					skippedFiles: [{ file: "orphan/no-manifest.ts", reason: "manifest-less" as const }],
					nodeCount: 0,
					edgeCount: 0,
				};
			},
		};
		const { logger, calls } = fakeLogger();

		runGenerateCommand({ rootDir }, fakeGenerator, logger);

		expect(calls).toStrictEqual([
			[
				"warn",
				"file skipped: manifest-less",
				{
					file: "orphan/no-manifest.ts",
					warning: "Skipped manifest-less file: orphan/no-manifest.ts",
				},
			],
		]);
	});
});
