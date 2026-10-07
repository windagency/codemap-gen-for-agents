#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "src/integration/mcp/server";

const server = createMcpServer();
await server.connect(new StdioServerTransport());
