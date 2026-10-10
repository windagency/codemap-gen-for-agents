import fs from "node:fs";
import path from "node:path";
import {
	loadConfig,
	type ResolvedCodemapConfig,
	resolveAbsoluteOutDir,
	resolveScipIndexes,
	type ScipIndexPaths,
} from "src/core/config";
import type { CodemapGenerator } from "src/core/generate-map";
import { formatIndexWarning, type IndexWarning } from "src/core/index-warning";
import { createConsoleLogger, type Logger } from "src/core/observability/logger";
import { formatSkippedFile, type SkippedFile } from "src/core/skipped-file";

const JSON_FILE_NAME = "codemap.json";
const HTML_FILE_NAME = "codemap.html";

export interface ResolvedCommandContext {
	rootDir: string;
	outDir: string;
	config: ResolvedCodemapConfig;
}

// Shared by `runGenerateCommand`/`runReadCommand`: both resolve `rootDir` (defaulting to the
// process cwd), load `codemap.config.json`, and anchor an absolute `outDir` the same way -
// only what they do with `config.exclude`/`force` afterwards differs.
export function resolveCommandContext(input: {
	rootDir?: string;
	configPath?: string;
	outDir?: string;
}): ResolvedCommandContext {
	const rootDir = input.rootDir ?? process.cwd();
	const config = loadConfig(rootDir, input.configPath);
	const outDir = resolveAbsoluteOutDir(rootDir, input.outDir, config);

	return { rootDir, outDir, config };
}

// Shared by the CLI `generate` command, the MCP `generate` tool, and the Skill's `generate`
// subcommand - one contract, three thin surfaces.
export interface GenerateCommandInput {
	rootDir?: string;
	configPath?: string;
	outDir?: string;
	force?: boolean;
	includeTests?: boolean;
	// Language -> SCIP index path, relative to `rootDir` (documentation/adr/0056).
	scipIndexes?: ScipIndexPaths;
	// Runs each language's SCIP indexer, and so the target repo's build tooling (decision 1).
	runIndexers?: boolean;
}

// Never `nodes`/`edges` - a large graph must never cross a tool-call response.
export interface GenerateCommandOutput {
	jsonPath: string;
	htmlPath: string;
	nodeCount: number;
	edgeCount: number;
}

// `generateMap`'s skipped-file warnings have no return slot on either `GenerateCommandOutput` or
// `ReadCommandOutput` (spec-locked, ADR-0004), so
// both commands log them here in the same structured shape instead - an observability gap
// otherwise (`CODING_RULES/14-observability.md`). Two distinct skip reasons (`generate-map.ts`)
// get two distinct log events, so a reader filtering structured logs can tell a syntax problem
// from a missing-manifest one.
export function logSkippedFiles(logger: Logger, skippedFiles: SkippedFile[]): void {
	for (const skipped of skippedFiles) {
		logger.warn(`file skipped: ${skipped.reason}`, {
			file: skipped.file,
			warning: formatSkippedFile(skipped),
		});
	}
}

// One event per SCIP fallback, named by reason, alongside `logSkippedFiles`'s own events.
export function logIndexWarnings(logger: Logger, indexWarnings: IndexWarning[] = []): void {
	for (const indexWarning of indexWarnings) {
		logger.warn(`scip index fallback: ${indexWarning.reason}`, {
			file: indexWarning.file,
			warning: formatIndexWarning(indexWarning),
		});
	}
}

export function runGenerateCommand(
	input: GenerateCommandInput,
	generator: CodemapGenerator,
	logger: Logger = createConsoleLogger(),
): GenerateCommandOutput {
	const { rootDir, outDir, config } = resolveCommandContext(input);

	const result = generator.generateMap(rootDir, {
		outDir,
		exclude: config.exclude,
		force: input.force,
		includeTests: input.includeTests,
		scipIndexes: resolveScipIndexes(rootDir, input.scipIndexes, config),
		runIndexers: input.runIndexers,
		indexerTimeoutSeconds: config.indexerTimeoutSeconds,
	});

	// Every adapter (CLI/MCP/Skill) goes through this one function, so logging here reaches all
	// three.
	logSkippedFiles(logger, result.skippedFiles);
	logIndexWarnings(logger, result.indexWarnings);

	fs.mkdirSync(outDir, { recursive: true });
	const jsonPath = path.join(outDir, JSON_FILE_NAME);
	const htmlPath = path.join(outDir, HTML_FILE_NAME);
	fs.writeFileSync(jsonPath, result.json);
	fs.writeFileSync(htmlPath, result.html);

	return {
		jsonPath,
		htmlPath,
		nodeCount: result.nodeCount,
		edgeCount: result.edgeCount,
	};
}
