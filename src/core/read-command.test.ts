import fs from "node:fs";
import path from "node:path";
import { createDefaultPipeline } from "src/core/compose";
import { runGenerateCommand } from "src/core/generate-command";
import { runReadCommand } from "src/core/read-command";
import { createFixtureRepo, fakeLogger } from "src/core/test-helpers";
import type { MapJson } from "src/output/json/build-map-json";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("runReadCommand", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-read-",
			packageJson: { name: "read-command-fixture" },
			files: { "index.ts": "export function main() { return 1; }" },
		});
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("self-heals: produces a correct result with no prior generate call against a fresh repo", () => {
		const result = runReadCommand({ rootDir }, createDefaultPipeline());

		expect(result.nodes.some((n) => n.id === "index.ts#main")).toBe(true);
	});

	it("self-heals: reflects a file changed underneath a stale prior map", () => {
		const generator = createDefaultPipeline();
		runReadCommand({ rootDir }, generator);

		fs.writeFileSync(
			path.join(rootDir, "index.ts"),
			"export function main() { return 1; }\nexport function extra() { return 2; }",
		);

		const result = runReadCommand({ rootDir }, generator);

		expect(result.nodes.some((n) => n.id === "index.ts#extra")).toBe(true);
	});

	it("returns the full graph when no filters are provided", () => {
		const result = runReadCommand({ rootDir }, createDefaultPipeline());

		expect(result.nodes.length).toBeGreaterThan(0);
	});

	it("filters by path/symbolKind/search together", () => {
		fs.writeFileSync(path.join(rootDir, "other.ts"), "export class Widget {}");

		const result = runReadCommand(
			{
				rootDir,
				path: "other.ts",
				symbolKind: "class",
				search: "widget",
			},
			createDefaultPipeline(),
		);

		const symbolNodes = result.nodes.filter((n) => n.kind === "symbol");
		expect(symbolNodes.map((n) => n.id)).toStrictEqual(["other.ts#Widget"]);
	});

	it("excludes test files by default and includes them when includeTests is true", () => {
		fs.writeFileSync(path.join(rootDir, "index.test.ts"), "export function onlyInTest() { return 1; }");

		const withoutTests = runReadCommand({ rootDir }, createDefaultPipeline());
		expect(withoutTests.nodes.some((n) => n.id === "index.test.ts#onlyInTest")).toBe(false);

		const withTests = runReadCommand({ rootDir, includeTests: true }, createDefaultPipeline());
		expect(withTests.nodes.some((n) => n.id === "index.test.ts#onlyInTest")).toBe(true);
	});

	it("passes scipIndexes through to its self-healing generate, as absolute paths", () => {
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

		runReadCommand({ rootDir, scipIndexes: { python: "index.scip" } }, fakeGenerator);

		expect(receivedOptions.map((options) => options.scipIndexes)).toStrictEqual([
			{ python: path.join(rootDir, "index.scip") },
		]);
	});

	it("logs each generateMap warning instead of silently discarding it, the same way generate does", () => {
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

		runReadCommand({ rootDir }, fakeGenerator, logger);

		expect(calls).toStrictEqual([
			["warn", "file skipped: unparseable", { file: "broken.ts", warning: "Skipped unparseable file: broken.ts" }],
		]);
	});
});

describe("runReadCommand modules field", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-read-modules-",
			packageJson: { name: "read-modules-fixture" },
			files: {
				"one.ts": "export function one() { return 1; }",
				"two.ts": "import { one } from './one'; export function two() { return one() + 1; }",
				"three.ts": "export function three() { return 1; }",
				"four.ts": "import { three } from './three'; export function four() { return three() + 1; }",
			},
		});
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("matches generate's own modules output for the same repo state", () => {
		const generateResult = runGenerateCommand({ rootDir }, createDefaultPipeline());
		const generated = JSON.parse(fs.readFileSync(generateResult.jsonPath, "utf8")) as MapJson;

		const readResult = runReadCommand({ rootDir }, createDefaultPipeline());

		expect(readResult.modules.length).toBeGreaterThan(0);
		expect(readResult.modules).toStrictEqual(generated.modules);
	});

	it("stays the full, unfiltered list even when a filter narrows nodes/edges", () => {
		const full = runReadCommand({ rootDir }, createDefaultPipeline());
		const filtered = runReadCommand({ rootDir, path: "one.ts" }, createDefaultPipeline());

		expect(filtered.nodes.length).toBeLessThan(full.nodes.length);
		expect(filtered.modules).toStrictEqual(full.modules);
		expect(filtered.modules.length).toBeGreaterThan(0);
	});
});
