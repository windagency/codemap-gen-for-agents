import type { CodemapGenerator, GenerateCommandOutput } from "src/core/compose";
import { createDefaultPipeline, generateFromArgv } from "src/core/compose";

export interface CliAdapter {
	generate(argv: string[]): GenerateCommandOutput;
}

// `codemap generate [--root <dir>] [--out <dir>] [--config <path>] [--force] [--include-tests]`
// - generate-only, no query/filter subcommand.
export function createCliAdapter(generator: CodemapGenerator = createDefaultPipeline()): CliAdapter {
	return {
		generate(argv: string[]): GenerateCommandOutput {
			return generateFromArgv(argv, generator);
		},
	};
}
