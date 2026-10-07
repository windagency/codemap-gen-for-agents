import fs from "node:fs";
import path from "node:path";
import { createFixtureRepo } from "src/core/test-helpers";
import { createCliAdapter } from "src/integration/cli/cli-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("createCliAdapter", () => {
	it("parses argv and drives the injected generator via core's runGenerateCommand", () => {
		const rootDir = createFixtureRepo({ prefix: "codemap-cli-unit-" });

		const receivedCalls: {
			rootDir: string;
			outDir: string;
			force?: boolean;
		}[] = [];
		const fakeGenerator = {
			generateMap(generatorRootDir: string, options: { outDir: string; exclude: string[]; force?: boolean }) {
				receivedCalls.push({
					rootDir: generatorRootDir,
					outDir: options.outDir,
					force: options.force,
				});
				return {
					json: JSON.stringify({ nodes: [], edges: [] }),
					html: "<html></html>",
					skippedFiles: [],
					nodeCount: 0,
					edgeCount: 0,
				};
			},
		};

		const adapter = createCliAdapter(fakeGenerator);
		const result = adapter.generate(["--root", rootDir, "--out", "out-dir", "--force"]);

		expect(result).toStrictEqual({
			jsonPath: path.join(rootDir, "out-dir", "codemap.json"),
			htmlPath: path.join(rootDir, "out-dir", "codemap.html"),
			nodeCount: 0,
			edgeCount: 0,
		});
		expect(receivedCalls).toStrictEqual([
			{
				rootDir,
				outDir: path.join(rootDir, "out-dir"),
				force: true,
			},
		]);

		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	describe("against the real composed pipeline", () => {
		let rootDir: string;

		beforeEach(() => {
			rootDir = createFixtureRepo({
				prefix: "codemap-cli-",
				packageJson: { name: "cli-fixture" },
				files: { "example.ts": "export const example = 1;" },
			});
		});

		afterEach(() => {
			fs.rmSync(rootDir, { recursive: true, force: true });
		});

		it("running the command produces codemap.json and codemap.html at the resolved outDir", () => {
			const adapter = createCliAdapter();

			const result = adapter.generate(["--root", rootDir, "--out", "out"]);

			expect(result.jsonPath).toBe(path.join(rootDir, "out", "codemap.json"));
			expect(fs.existsSync(result.jsonPath)).toBe(true);
			expect(fs.existsSync(result.htmlPath)).toBe(true);
		});

		it("--out overrides a config file's outDir", () => {
			fs.writeFileSync(path.join(rootDir, "codemap.config.json"), JSON.stringify({ outDir: "configured-out" }));

			const adapter = createCliAdapter();
			const result = adapter.generate(["--root", rootDir, "--out", "flag-out"]);

			expect(result.jsonPath).toBe(path.join(rootDir, "flag-out", "codemap.json"));
		});
	});
});
