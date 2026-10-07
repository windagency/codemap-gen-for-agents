import type {
	CodemapGenerator,
	GenerateCommandInput,
	GenerateCommandOutput,
	ReadCommandInput,
	ReadCommandOutput,
} from "src/core/compose";
import { createDefaultPipeline, generate as generateCommand, read as readCommand } from "src/core/compose";

// The spec's exact MCP tool shapes.
export type GenerateInput = GenerateCommandInput;
export type GenerateOutput = GenerateCommandOutput;
export type ReadInput = ReadCommandInput;
export type ReadOutput = ReadCommandOutput;

export interface McpAdapter {
	generate(input: GenerateInput): GenerateOutput;
	read(input: ReadInput): ReadOutput;
}

export function createMcpAdapter(generator: CodemapGenerator = createDefaultPipeline()): McpAdapter {
	return {
		generate(input: GenerateInput): GenerateOutput {
			return generateCommand(input, generator);
		},
		read(input: ReadInput): ReadOutput {
			return readCommand(input, generator);
		},
	};
}
