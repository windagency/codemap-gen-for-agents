import type { CodemapGenerator, GenerateCommandOutput, ReadCommandOutput } from "src/core/compose";
import { createDefaultPipeline, generateFromArgv, readFromArgv } from "src/core/compose";

export interface SkillAdapter {
	generate(argv: string[]): GenerateCommandOutput;
	read(argv: string[]): ReadCommandOutput;
}

// Calls `core/compose.ts`'s `createDefaultPipeline()` directly, the same way `CliAdapter` and
// `McpAdapter` do - never delegates through either of them. Exposes the same `generate`/`read`
// subcommands/flags as the CLI (`generate`) and the MCP `read` tool, so its stdout output is
// byte-for-byte identical to the matching MCP tool's return shape given the same inputs.
export function createSkillAdapter(generator: CodemapGenerator = createDefaultPipeline()): SkillAdapter {
	return {
		generate(argv: string[]): GenerateCommandOutput {
			return generateFromArgv(argv, generator);
		},
		read(argv: string[]): ReadCommandOutput {
			return readFromArgv(argv, generator);
		},
	};
}
