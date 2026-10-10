import { createModuleDetector } from "src/clustering/module-detector-factory";
import { parseGenerateArgs, parseReadArgs } from "src/core/cli-args";
import type { GenerateCommandInput, GenerateCommandOutput } from "src/core/generate-command";
import { runGenerateCommand } from "src/core/generate-command";
import type { CodemapGenerator } from "src/core/generate-map";
import { createCodemapGenerator } from "src/core/generate-map";
import type { ParserLanguage } from "src/core/languages";
import { createConsoleLogger } from "src/core/observability/logger";
import { withParseLogging } from "src/core/observability/parse-logging";
import type { ReadCommandInput, ReadCommandOutput } from "src/core/read-command";
import { runReadCommand } from "src/core/read-command";
import { createDiscovery } from "src/discovery/discovery";
import { createCompositeParser } from "src/extraction/composite-parser";
import { createParserFactory } from "src/extraction/parser-factory";
import { createScipIndexResolver } from "src/extraction/scip-resolver";
import { createGraphBuilderFactory } from "src/graph-building/graph-builder-factory";
import { createHtmlTransformer, createJsonTransformer } from "src/output/transformer";

export { isHelpRequest } from "src/core/cli-args";
export type {
	GenerateCommandInput,
	GenerateCommandOutput,
} from "src/core/generate-command";
export type { CodemapGenerator } from "src/core/generate-map";
export { GENERATOR_VERSION } from "src/core/generator-version";
export { SCIP_LANGUAGES } from "src/core/languages";
export {
	createConsoleLogger,
	type LogContext,
	type Logger,
	withLogContext,
} from "src/core/observability/logger";
export type {
	ReadCommandInput,
	ReadCommandOutput,
} from "src/core/read-command";
export { SYMBOL_KINDS } from "src/core/types";

// The single composition root: every concrete stub is obtained through its own slice's
// Factory (or, for Discovery/ModuleDetector, its construction function) - never imported
// directly - so `core/` stays independent of every implementation subfolder (arch-unit-ts
// enforced).
export function createDefaultPipeline(): CodemapGenerator {
	const logger = createConsoleLogger();
	const parserFactory = createParserFactory();
	const graphBuilderFactory = createGraphBuilderFactory();
	const parserFor = (language: ParserLanguage) =>
		withParseLogging(language, parserFactory.createParser(language), logger);
	const parser = createCompositeParser({
		typescript: parserFor("typescript"),
		go: parserFor("go"),
		rust: parserFor("rust"),
		java: parserFor("java"),
		python: parserFor("python"),
	});

	return createCodemapGenerator(
		{
			discovery: createDiscovery(),
			parser,
			graphBuilder: graphBuilderFactory.create(),
			moduleDetector: createModuleDetector(),
			jsonTransformer: createJsonTransformer(),
			htmlTransformer: createHtmlTransformer(),
			indexResolver: createScipIndexResolver(),
		},
		logger,
	);
}

// Everything below is the *only* surface the CliAdapter/McpAdapter/SkillAdapter peers may
// depend on from `core/` (documentation/adr/0003-generator-pipeline-seams.md) - a single compose.ts composition root, not four
// separate core/ modules. `generate-command.ts`/`read-command.ts` take their `generator`
// argument as required (no default) specifically so they never need to import back into this
// file, which would make compose.ts and its own dependents circular.

export function generate(
	input: GenerateCommandInput,
	generator: CodemapGenerator = createDefaultPipeline(),
): GenerateCommandOutput {
	return runGenerateCommand(input, generator);
}

export function generateFromArgv(
	argv: string[],
	generator: CodemapGenerator = createDefaultPipeline(),
): GenerateCommandOutput {
	return runGenerateCommand(parseGenerateArgs(argv), generator);
}

export function read(
	input: ReadCommandInput,
	generator: CodemapGenerator = createDefaultPipeline(),
): ReadCommandOutput {
	return runReadCommand(input, generator);
}

export function readFromArgv(argv: string[], generator: CodemapGenerator = createDefaultPipeline()): ReadCommandOutput {
	return runReadCommand(parseReadArgs(argv), generator);
}
