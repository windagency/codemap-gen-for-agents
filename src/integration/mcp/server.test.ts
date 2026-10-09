import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CodemapGenerator } from "src/core/compose";
import type { Logger } from "src/core/observability/logger";
import { createMcpServer } from "src/integration/mcp/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function connectedClient(generator?: CodemapGenerator, logger?: Logger): Promise<Client> {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const server = createMcpServer(generator, logger);
	const client = new Client({ name: "test-client", version: "0.0.0" });

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	return client;
}

function textResult(result: { content: { type: string; text?: string }[] }): unknown {
	const text = result.content[0]?.text;
	if (typeof text !== "string") throw new Error("Expected a text content block");
	return JSON.parse(text);
}

describe("createMcpServer", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-mcp-server-"));
		fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "mcp-server-fixture" }));
		fs.writeFileSync(path.join(rootDir, "index.ts"), "export function main() { return 1; }");
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("registers a generate tool that a real MCP client can call, producing real files and never returning nodes/edges inline", async () => {
		const client = await connectedClient();

		const raw = await client.callTool({
			name: "generate",
			arguments: { rootDir },
		});
		const result = textResult(raw as never) as {
			jsonPath: string;
			htmlPath: string;
			nodeCount: number;
			edgeCount: number;
		};

		expect(Object.keys(result).sort()).toStrictEqual(["edgeCount", "htmlPath", "jsonPath", "nodeCount"]);
		expect(fs.existsSync(result.jsonPath)).toBe(true);
		expect(fs.existsSync(result.htmlPath)).toBe(true);
		expect(result.nodeCount).toBeGreaterThan(0);
	});

	it("registers a read tool that a real MCP client can call, self-healing and filtering", async () => {
		const client = await connectedClient();

		const raw = await client.callTool({
			name: "read",
			arguments: { rootDir, symbolKind: "function" },
		});
		const result = textResult(raw as never) as {
			nodes: { kind: string; name: string }[];
		};

		expect(result.nodes.some((node) => node.kind === "symbol" && node.name === "main")).toBe(true);
	});

	it("lists exactly generate and read as the available tools", async () => {
		const client = await connectedClient();

		const { tools } = await client.listTools();

		expect(tools.map((tool) => tool.name).sort()).toStrictEqual(["generate", "read"]);
	});

	it("rejects a generate call whose rootDir is the wrong type instead of coercing it", async () => {
		const client = await connectedClient();

		// `rootDir` must be a string per `generateInputShape` - a number should fail Zod schema
		// validation (surfaced as an `isError` tool result, per the MCP SDK's own error protocol),
		// not get silently coerced or passed through to the pipeline.
		const raw = await client.callTool({
			name: "generate",
			arguments: { rootDir: 123 },
		});

		expect(raw.isError).toBe(true);
		const text = (raw.content as { type: string; text?: string }[])[0]?.text;
		expect(text).toMatch(/rootDir/);
	});

	it("rejects a read call with a symbolKind outside the SYMBOL_KINDS enum instead of matching nothing silently", async () => {
		const client = await connectedClient();

		const raw = await client.callTool({
			name: "read",
			arguments: { rootDir, symbolKind: "bogus-kind" },
		});

		expect(raw.isError).toBe(true);
		const text = (raw.content as { type: string; text?: string }[])[0]?.text;
		expect(text).toMatch(/symbolKind/);
	});

	it("exposes force on generate's schema but not on read's, since read always hardcodes force: false", async () => {
		const client = await connectedClient();

		const { tools } = await client.listTools();
		const generateTool = tools.find((tool) => tool.name === "generate");
		const readTool = tools.find((tool) => tool.name === "read");

		expect(Object.keys(generateTool?.inputSchema.properties ?? {})).toContain("force");
		expect(Object.keys(readTool?.inputSchema.properties ?? {})).not.toContain("force");
	});

	it("exposes runIndexers on generate's schema but not on read's, since read never runs indexers", async () => {
		const client = await connectedClient();

		const { tools } = await client.listTools();
		const generateTool = tools.find((tool) => tool.name === "generate");
		const readTool = tools.find((tool) => tool.name === "read");

		expect(Object.keys(generateTool?.inputSchema.properties ?? {})).toContain("runIndexers");
		expect(Object.keys(readTool?.inputSchema.properties ?? {})).not.toContain("runIndexers");
	});

	it("exposes scipIndexes on both generate's and read's schemas", async () => {
		const client = await connectedClient();

		const { tools } = await client.listTools();

		for (const name of ["generate", "read"]) {
			const tool = tools.find((candidate) => candidate.name === name);
			expect(Object.keys(tool?.inputSchema.properties ?? {})).toContain("scipIndexes");
		}
	});

	it("rejects a scipIndexes language with no SCIP support yet", async () => {
		const client = await connectedClient();

		const raw = await client.callTool({ name: "generate", arguments: { scipIndexes: { java: "index.scip" } } });

		expect(raw.isError).toBe(true);
	});

	// ADR-0022: logging is wired in at the CLI/MCP entry points. A thrown error from a tool
	// handler must reach the structured `Logger` the same way `run-entrypoint.ts` does for
	// CLI/Skill, without changing the MCP SDK's own `isError` client-facing response shape.
	it("logs a structured error entry when a tool handler throws, without changing the client-facing isError response", async () => {
		const thrownError = new Error("boom: generator exploded");
		const throwingGenerator = {
			generateMap: () => {
				throw thrownError;
			},
		};
		const loggedCalls: {
			message: string;
			context?: Record<string, unknown>;
		}[] = [];
		const recordingLogger: Logger = {
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: (message, context) => {
				loggedCalls.push({ message, context });
			},
		};

		const client = await connectedClient(throwingGenerator, recordingLogger);

		const raw = await client.callTool({
			name: "generate",
			arguments: { rootDir: "/nonexistent" },
		});

		expect(raw.isError).toBe(true);
		const text = (raw.content as { type: string; text?: string }[])[0]?.text;
		expect(text).toMatch(/boom: generator exploded/);

		expect(loggedCalls).toHaveLength(1);
		expect(loggedCalls[0]?.message).toBe("boom: generator exploded");
		expect(loggedCalls[0]?.context).toMatchObject({ tool: "generate" });
	});
});
