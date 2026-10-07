import fs from "node:fs";
import path from "node:path";
import { createFixtureRepo } from "src/core/test-helpers";
import { createMcpAdapter } from "src/integration/mcp/mcp-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("createMcpAdapter", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-mcp-",
			packageJson: { name: "mcp-fixture" },
			files: { "index.ts": "export function main() { return 1; }" },
		});
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	describe("generate", () => {
		it("produces real codemap.json/codemap.html files and returns paths + matching counts, never the graph inline", () => {
			const adapter = createMcpAdapter();

			const result = adapter.generate({ rootDir });

			expect(Object.keys(result).sort()).toStrictEqual(["edgeCount", "htmlPath", "jsonPath", "nodeCount"]);
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

		it("an explicit outDir input overrides the config file's outDir", () => {
			fs.writeFileSync(path.join(rootDir, "codemap.config.json"), JSON.stringify({ outDir: "configured-out" }));

			const adapter = createMcpAdapter();
			const result = adapter.generate({ rootDir, outDir: "explicit-out" });

			expect(result.jsonPath).toBe(path.join(rootDir, "explicit-out", "codemap.json"));
		});
	});

	describe("read", () => {
		it("self-heals with no prior generate call and returns a correct filtered result", () => {
			const adapter = createMcpAdapter();

			const result = adapter.read({ rootDir, symbolKind: "function" });

			expect(result.nodes.some((node) => node.kind === "symbol" && node.name === "main")).toBe(true);
		});
	});
});
