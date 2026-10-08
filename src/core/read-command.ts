import type { ModuleSummary } from "src/clustering/module-naming";
import { resolveScipIndexes, type ScipIndexPaths } from "src/core/config";
import type { GraphFilters } from "src/core/filter-graph";
import { filterGraph } from "src/core/filter-graph";
import { logIndexWarnings, logSkippedFiles, resolveCommandContext } from "src/core/generate-command";
import type { CodemapGenerator } from "src/core/generate-map";
import { createConsoleLogger, type Logger } from "src/core/observability/logger";
import type { ClusteredGraph } from "src/core/types";

// Shared by the MCP `read` tool and the Skill's `read` subcommand.
export interface ReadCommandInput extends GraphFilters {
	rootDir?: string;
	configPath?: string;
	outDir?: string;
	includeTests?: boolean;
	scipIndexes?: ScipIndexPaths;
}

// The shape of `generateMap`'s `json` output (`src/output/json/build-map-json.ts`'s `MapJson`),
// duplicated rather than imported: `core/` never depends on an `output/` implementation
// subfolder (`documentation/adr/0003`'s dependency-direction rule, enforced by
// `dependency-direction.test.ts`) - only this one extra field (`modules`) this command actually
// reads is named here, not the whole envelope.
type GeneratedMapJson = ClusteredGraph & { modules: ModuleSummary[] };

export interface ReadCommandOutput {
	nodes: ClusteredGraph["nodes"];
	edges: ClusteredGraph["edges"];
	// Always the full, unfiltered lookup table `generate`'s own JSON envelope already computes
	// over the complete graph - never recomputed from `nodes` after filtering, since a Module's
	// collision-resolved name is only well-defined relative to the complete graph it was derived
	// from.
	modules: ModuleSummary[];
}

// Self-heals: always re-runs the incremental pipeline before filtering, so it works whether or
// not `generate` was ever called, and reflects any file changed underneath a stale prior map.
export function runReadCommand(
	input: ReadCommandInput,
	generator: CodemapGenerator,
	logger: Logger = createConsoleLogger(),
): ReadCommandOutput {
	const { rootDir, outDir, config } = resolveCommandContext(input);

	const result = generator.generateMap(rootDir, {
		outDir,
		exclude: config.exclude,
		force: false,
		includeTests: input.includeTests,
		scipIndexes: resolveScipIndexes(rootDir, input.scipIndexes, config),
	});

	// Same pipeline, same skip-and-warn policy as `runGenerateCommand` - surfaced the same way
	// for consistency between the two commands.
	logSkippedFiles(logger, result.skippedFiles);
	logIndexWarnings(logger, result.indexWarnings);

	const mapJson = JSON.parse(result.json) as GeneratedMapJson;

	const filtered = filterGraph(mapJson, {
		path: input.path,
		symbolKind: input.symbolKind,
		search: input.search,
	});

	return { ...filtered, modules: mapJson.modules };
}
