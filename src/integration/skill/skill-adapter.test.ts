import fs from "node:fs";
import { createFixtureRepo } from "src/core/test-helpers";
import { createMcpAdapter } from "src/integration/mcp/mcp-adapter";
import { createSkillAdapter } from "src/integration/skill/skill-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Strips the fixture's absolute tmp-dir path so a jsonPath/htmlPath comparison isn't defeated by
// two calls landing in two different mkdtemp'd directories.
function normalizePaths(output: unknown, rootDir: string): unknown {
	const json = JSON.stringify(output).split(rootDir).join("<root>");
	return JSON.parse(json);
}

describe("createSkillAdapter", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = createFixtureRepo({
			prefix: "codemap-skill-",
			packageJson: { name: "skill-fixture" },
			files: {
				"index.ts": "export class Widget {}\nexport function main() { return 1; }",
			},
		});
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	describe("generate", () => {
		it("calls core directly (no CliAdapter/McpAdapter import) and prints a GenerateOutput-shaped object", () => {
			const adapter = createSkillAdapter();

			const result = adapter.generate(["--root", rootDir]);

			expect(Object.keys(result).sort()).toStrictEqual(["edgeCount", "htmlPath", "jsonPath", "nodeCount"]);
			expect(fs.existsSync(result.jsonPath)).toBe(true);
			expect(fs.existsSync(result.htmlPath)).toBe(true);
		});

		it("produces byte-for-byte identical output to the MCP generate tool given equivalent inputs", () => {
			const skillResult = createSkillAdapter().generate(["--root", rootDir]);
			const mcpResult = createMcpAdapter().generate({ rootDir });

			expect(normalizePaths(skillResult, rootDir)).toStrictEqual(normalizePaths(mcpResult, rootDir));
		});
	});

	describe("read", () => {
		it("self-heals and filters by --path/--symbol-kind/--search together", () => {
			const adapter = createSkillAdapter();

			const result = adapter.read([
				"--root",
				rootDir,
				"--path",
				"index.ts",
				"--symbol-kind",
				"class",
				"--search",
				"widget",
			]);

			const symbolNodes = result.nodes.filter((n) => n.kind === "symbol");
			expect(symbolNodes.map((n) => n.id)).toStrictEqual(["index.ts#Widget"]);
		});

		it("produces byte-for-byte identical output to the MCP read tool given equivalent inputs, including path+symbolKind+search together", () => {
			const skillResult = createSkillAdapter().read([
				"--root",
				rootDir,
				"--path",
				"index.ts",
				"--symbol-kind",
				"class",
				"--search",
				"widget",
			]);
			const mcpResult = createMcpAdapter().read({
				rootDir,
				path: "index.ts",
				symbolKind: "class",
				search: "widget",
			});

			expect(normalizePaths(skillResult, rootDir)).toStrictEqual(normalizePaths(mcpResult, rootDir));
		});
	});
});
