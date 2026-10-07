import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type CodemapGenerator,
	createConsoleLogger,
	createDefaultPipeline,
	GENERATOR_VERSION,
	type Logger,
	withLogContext,
} from "src/core/compose";
import { createMcpAdapter } from "src/integration/mcp/mcp-adapter";
import { generateInputShape, readInputShape } from "src/integration/mcp/tool-input-schema";

function jsonToolResult(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

// ADR-0022 wires structured logging in at the CLI/MCP entry points, mirroring
// `run-entrypoint.ts`'s CLI/Skill pattern: log the error via `Logger`, then rethrow unchanged so
// the MCP SDK's own `registerTool` try/catch still produces its usual `isError` `CallToolResult`
// for the client - this only adds a logging side-effect, it never changes what the client sees.
function withErrorLogging<Input, Output>(
	toolName: string,
	logger: Logger,
	handler: (input: Input) => Output,
): (input: Input) => Output {
	return (input) =>
		withLogContext({ runId: crypto.randomUUID(), tool: toolName }, () => {
			try {
				return handler(input);
			} catch (error) {
				logger.error(error instanceof Error ? error.message : String(error), {
					tool: toolName,
				});
				throw error;
			}
		});
}

// The spec's MCP `generate`/`read` tools, registered against
// the real MCP SDK so a client can call them - `McpAdapter` (`mcp-adapter.ts`) stays the plain,
// directly-testable `{generate, read}` contract; this file is only the protocol registration
// layer on top of it.
export function createMcpServer(
	generator: CodemapGenerator = createDefaultPipeline(),
	logger: Logger = createConsoleLogger(),
): McpServer {
	const adapter = createMcpAdapter(generator);
	const server = new McpServer({ name: "codemap", version: GENERATOR_VERSION });

	server.registerTool(
		"generate",
		{
			description:
				"Runs the code-map pipeline and writes codemap.json/codemap.html to disk. Returns file paths and summary counts, never the graph inline.",
			inputSchema: generateInputShape,
		},
		withErrorLogging("generate", logger, (input) => jsonToolResult(adapter.generate(input))),
	);

	server.registerTool(
		"read",
		{
			description:
				"Self-heals (always re-runs the pipeline first) and returns the graph, optionally AND-filtered by path/symbolKind/search, including each match's ancestor Cluster chain.",
			inputSchema: readInputShape,
		},
		withErrorLogging("read", logger, (input) => jsonToolResult(adapter.read(input))),
	);

	return server;
}
