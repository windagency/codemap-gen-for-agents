import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ModuleDetector } from "src/clustering/module-detector";
import {
	type CacheFile,
	computeEpoch,
	diffFiles,
	hashFile,
	loadCache,
	saveCache,
} from "src/core/cache/extraction-cache";
import type { ScipIndexPaths } from "src/core/config";
import { GENERATOR_VERSION } from "src/core/generator-version";
import { formatIndexWarning, type IndexWarning } from "src/core/index-warning";
import {
	DEPENDENCY_FILE_NAMES,
	extensionOf,
	languageOfExtension,
	parsePackageDir,
	SCIP_LANGUAGES,
} from "src/core/languages";
import { createConsoleLogger, currentLogContext, type Logger, withLogContext } from "src/core/observability/logger";
import { formatSkippedFile, type SkippedFile } from "src/core/skipped-file";
import type { ClusteredGraph, DiscoveredStructure, ExtractedSymbols } from "src/core/types";
import type { Discovery } from "src/discovery/discovery";
import type { Parser } from "src/extraction/parser";
import type { IndexResolver, IndexSource } from "src/extraction/scip-resolver";
import type { GraphBuilder } from "src/graph-building/graph-builder";
import type { Transformer } from "src/output/transformer";

const CACHE_FILE_NAME = "cache.json";
const DEFAULT_SCIP_INDEX_FILE_NAME = "index.scip";

function toPosixRelative(rootDir: string, absolutePath: string): string {
	return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function readIfPresent(filePath: string): string | null {
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

// Every manifest and lockfile at the repo root or a Package root. The root is always read, since
// a workspace-level lockfile (a Cargo `[workspace]`, a pnpm workspace) needn't be a Package.
function readDependencyFiles(rootDir: string, structure: DiscoveredStructure): Record<string, string> {
	const packageDirs = new Set([".", ...structure.packages.map((pkg) => parsePackageDir(pkg.id))]);
	const fileNames = new Set(Object.values(DEPENDENCY_FILE_NAMES).flat());
	const entries = [...packageDirs].flatMap((dir) =>
		[...fileNames].flatMap((fileName) => {
			const relativePath = path.posix.join(dir, fileName);
			const content = readIfPresent(path.join(rootDir, relativePath));
			return content === null ? [] : [[relativePath, content] as const];
		}),
	);
	return Object.fromEntries(entries);
}

// `Parser` reads `<rootDir>/tsconfig.json`, so its raw content is an epoch input: an edit to it
// can change every resolved import/external without touching a single file's own content.
// Hashing the raw file text (rather than the fully `extends`-resolved CompilerOptions) is a
// deliberate simplification: it won't invalidate the cache when only a transitively
// `extends`-ed base config changes, an accepted gap.
function computeCurrentEpoch(
	rootDir: string,
	structure: DiscoveredStructure,
	exclude: string[],
	includeTests: boolean,
	indexSources: IndexSource[],
): string {
	return computeEpoch({
		generatorVersion: GENERATOR_VERSION,
		tsconfigRawText: readIfPresent(path.join(rootDir, "tsconfig.json")),
		excludePatterns: exclude,
		includeTests,
		dependencyFiles: readDependencyFiles(rootDir, structure),
		scipIndexes: hashIndexSources(indexSources),
	});
}

// documentation/adr/0056 decision 2: an explicit path per language, else `<rootDir>/index.scip`
// when that file exists. An explicit path that does not exist is still a source, so the run warns
// about it instead of silently ignoring it.
function resolveIndexSources(rootDir: string, scipIndexes: ScipIndexPaths): IndexSource[] {
	const defaultPath = path.join(rootDir, DEFAULT_SCIP_INDEX_FILE_NAME);
	const hasDefault = fs.existsSync(defaultPath);
	return SCIP_LANGUAGES.flatMap((language): IndexSource[] => {
		const indexPath = scipIndexes[language] ?? (hasDefault ? defaultPath : undefined);
		return indexPath === undefined ? [] : [{ language, indexPath }];
	});
}

// Decision 5: an index's content is an epoch input, so a regenerated index re-extracts every file
// instead of serving refinements cached against the old one. An unreadable index hashes as "".
function hashIndexSources(indexSources: IndexSource[]): Record<string, string> {
	return Object.fromEntries(
		indexSources.map(({ language, indexPath }) => {
			let contentHash = "";
			try {
				contentHash = crypto.createHash("sha256").update(fs.readFileSync(indexPath)).digest("hex");
			} catch {
				// Reported by the resolver as an unreadable index.
			}
			return [`${language}:${indexPath}`, contentHash];
		}),
	);
}

// A file's stored fallback reason, cached or fresh, plus each index the resolver could not read.
function collectIndexWarnings(
	rootDir: string,
	symbols: ExtractedSymbols[],
	unreadableIndexes: { indexPath: string; reason: string }[],
): IndexWarning[] {
	return [
		...symbols.flatMap((extracted): IndexWarning[] =>
			extracted.indexFallback ? [{ reason: extracted.indexFallback, file: extracted.filePath }] : [],
		),
		...unreadableIndexes.map(({ indexPath, reason }) => ({
			reason: "index-unreadable" as const,
			file: path.isAbsolute(indexPath) ? toPosixRelative(rootDir, indexPath) : indexPath,
			detail: reason,
		})),
	];
}

// `force` bypasses the cache entirely (an empty epoch never matches, so every file comes back
// `changed`); otherwise a real on-disk cache is loaded and diffed against `currentEpoch`.
function diffAgainstCache(
	cachePath: string,
	files: string[],
	currentEpoch: string,
	force: boolean,
): {
	extractFiles: string[];
	cached: Record<string, ExtractedSymbols>;
	contentHashes: Record<string, string>;
} {
	const cache = force ? { epoch: "", files: {} } : loadCache(cachePath);
	const { changed, cached, contentHashes } = diffFiles(cache, files, currentEpoch);

	return { extractFiles: force ? files : changed, cached, contentHashes };
}

// Reconciles this run's two symbol sources - files reused from the cache and files `Parser`
// just re-extracted - into one lookup keyed by absolute path, the same keying both sources use.
function mergeSymbolsByFile(
	cached: Record<string, ExtractedSymbols>,
	freshSymbols: ExtractedSymbols[],
): Map<string, ExtractedSymbols> {
	const symbolsByFile = new Map<string, ExtractedSymbols>();
	for (const [filePath, symbols] of Object.entries(cached)) {
		symbolsByFile.set(filePath, symbols);
	}
	for (const symbols of freshSymbols) {
		symbolsByFile.set(symbols.filePath, symbols);
	}
	return symbolsByFile;
}

// `GraphBuilder`/the schema need repo-relative filePaths (matching `structure.programFiles`
// and every File node id); `symbolsByFile` is still keyed by the absolute paths `Parser` and
// the cache use, so the swap happens here, once, right before crossing into `GraphBuilder`.
// `structure.programFiles` and `files` are the same list in the same order (`files` was
// built from it in `generateMap`), so zipping by index needs no repeated `path.join`. A
// `file`-kind import target is `Parser`'s own absolute resolved path for the same reason and
// gets the same treatment - `GraphBuilder` is a pure shape-assembler with no `path` access of
// its own to do this conversion itself.
//
// A file absent from `symbolsByFile` was silently skipped by `Parser` under its
// unparseable-file policy (ticket 13) - it contributes no entry here (no Symbols, no
// FileNode) and is collected as a skipped path to exclude it from `structure` and to report
// it as a warning, rather than treated as a bug.
function rewriteSymbolPaths(
	rootDir: string,
	structure: DiscoveredStructure,
	files: string[],
	symbolsByFile: Map<string, ExtractedSymbols>,
): { symbols: ExtractedSymbols[]; skippedRelativePaths: string[] } {
	const skippedRelativePaths: string[] = [];
	const symbols = structure.programFiles.flatMap((relativePath, index) => {
		const absolutePath = files[index];
		const extracted = absolutePath && symbolsByFile.get(absolutePath);
		if (!extracted) {
			skippedRelativePaths.push(relativePath);
			return [];
		}
		return [
			{
				...extracted,
				filePath: relativePath,
				imports: extracted.imports.map((rawImport) =>
					rawImport.resolvedTarget.kind === "file"
						? {
								...rawImport,
								resolvedTarget: {
									kind: "file" as const,
									filePath: toPosixRelative(rootDir, rawImport.resolvedTarget.filePath),
								},
							}
						: rawImport,
				),
				calls: extracted.calls.map((rawCall) => ({
					...rawCall,
					candidates: rawCall.candidates.map((candidate) => ({
						...candidate,
						filePath: toPosixRelative(rootDir, candidate.filePath),
					})),
				})),
			},
		];
	});

	return { symbols, skippedRelativePaths };
}

// Kept as the original `structure` instance (not a copy) whenever nothing was skipped, so
// an unaffected run's `GraphBuilder` still sees the exact object `Discovery` produced.
function buildStructureForGraph(structure: DiscoveredStructure, skippedRelativePaths: string[]): DiscoveredStructure {
	if (skippedRelativePaths.length === 0) return structure;

	const skippedSet = new Set(skippedRelativePaths);
	return {
		...structure,
		programFiles: structure.programFiles.filter((relativePath) => !skippedSet.has(relativePath)),
	};
}

// Cross-run counterpart to `TsCompilerApiParser`'s own same-run skip-set check
// (`resolveImportTarget` in `ts-compiler-api-parser.ts`, ticket 13's unparseable-file policy): a
// cached file's import can point at a file that broke on *this* run (no longer produces a node)
// even though its own cached extraction - computed on some earlier, valid run - was never
// touched. Rewriting that target to `unresolved` here, before `symbols` reaches `GraphBuilder`,
// keeps "what counts as unresolved" defined in exactly one place rather than teaching
// `GraphBuilder` a second, independent reason an edge can be dropped
// (`documentation/adr/0025-cross-run-dangling-edge-fix.md`). Never persisted back to the cache - each
// file's own cache entry keeps the parser's raw, unmodified output, so a target that stops being
// broken self-heals on a later run with no invalidation logic needed.
function rewriteDanglingFileImports(
	symbols: ExtractedSymbols[],
	validFilePaths: ReadonlySet<string>,
): ExtractedSymbols[] {
	return symbols.map((extracted) => {
		let changed = false;
		const imports = extracted.imports.map((rawImport) => {
			if (rawImport.resolvedTarget.kind !== "file" || validFilePaths.has(rawImport.resolvedTarget.filePath)) {
				return rawImport;
			}
			changed = true;
			return { ...rawImport, resolvedTarget: { kind: "unresolved" as const } };
		});
		return changed ? { ...extracted, imports } : extracted;
	});
}

// Rust's item-granularity test convention (`#[cfg(test)]` modules / `#[test]`-attributed
// functions, tagged `RawSymbol.isTestItem` by `RustTreeSitterParser`) is the one test-exclusion
// rule that can't be enforced at Discovery/file granularity (documentation/adr/0011)
// - this is where it's actually applied,
// one layer downstream of Go/Java/TS's own file-level exclusion inside Discovery. A stripped
// symbol also drops any call whose own `callerLocalId` names it (its caller is gone) and any
// *other* symbol's call candidate that names it, the same "no traceable declaration -> drop" rule
// `ts-compiler-api/call-resolution.ts` already applies for its own reasons - mirroring
// `rewriteDanglingFileImports`'s "never a dangling edge to a node that was never created"
// guarantee just above.
function stripHiddenTestItems(symbols: ExtractedSymbols[], includeTests: boolean): ExtractedSymbols[] {
	if (includeTests) return symbols;

	const hiddenIds = new Set<string>();
	for (const extracted of symbols) {
		for (const symbol of extracted.symbols) {
			if (symbol.isTestItem) hiddenIds.add(`${extracted.filePath}#${symbol.localId}`);
		}
	}
	if (hiddenIds.size === 0) return symbols;

	return symbols.map((extracted) => {
		const symbolsVisible = extracted.symbols.filter((symbol) => !symbol.isTestItem);
		const calls = extracted.calls
			.filter((call) => !hiddenIds.has(`${extracted.filePath}#${call.callerLocalId}`))
			.map((call) => ({
				...call,
				candidates: call.candidates.filter((candidate) => !hiddenIds.has(`${candidate.filePath}#${candidate.localId}`)),
			}))
			.filter((call) => call.candidates.length > 0);

		return { ...extracted, symbols: symbolsVisible, calls };
	});
}

function countSymbols(symbols: ExtractedSymbols[]): number {
	return symbols.reduce((total, extracted) => total + extracted.symbols.length, 0);
}

// Reuses the content hash `diffFiles` already computed for a file (unchanged or changed, as
// long as it had a prior cache entry) instead of re-reading and re-hashing the same bytes a
// second time; only a file with no prior entry (never hashed yet) is hashed here.
function buildCacheFiles(
	files: string[],
	symbolsByFile: Map<string, ExtractedSymbols>,
	knownContentHashes: Record<string, string>,
): CacheFile["files"] {
	const cacheFiles: CacheFile["files"] = {};
	for (const filePath of files) {
		const extracted = symbolsByFile.get(filePath);
		if (!extracted) continue;
		cacheFiles[filePath] = {
			contentHash: knownContentHashes[filePath] ?? hashFile(filePath),
			extractedSymbols: extracted,
		};
	}
	return cacheFiles;
}

// Repo-relative paths counted by their language, for the run summary.
function countByLanguage(filePaths: string[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const filePath of filePaths) {
		const language = languageOfExtension(extensionOf(filePath)) ?? "unknown";
		counts[language] = (counts[language] ?? 0) + 1;
	}
	return counts;
}

export interface GeneratedMap {
	json: string;
	html: string;
	// Every file this run left out, and why: a Parser-skipped unparseable file or a
	// Discovery-flagged manifest-less one. The same list reaches `json`'s top-level `warnings`
	// field as formatted lines (documentation/adr/0029); commands log it from here.
	skippedFiles: SkippedFile[];
	// Every SCIP index fallback (documentation/adr/0056), after `skippedFiles` in `warnings`. Absent
	// when there are none.
	indexWarnings?: IndexWarning[];
	// Computed straight from `clusteredGraph`, not by re-parsing `json`.
	nodeCount: number;
	edgeCount: number;
}

export interface GenerateMapOptions {
	exclude: string[];
	outDir: string;
	force?: boolean;
	includeTests?: boolean;
	// Language -> absolute SCIP index path (documentation/adr/0056).
	scipIndexes?: ScipIndexPaths;
}

export interface CodemapGenerator {
	generateMap(rootDir: string, options: GenerateMapOptions): GeneratedMap;
}

export interface CodemapGeneratorDependencies {
	discovery: Discovery;
	parser: Parser;
	graphBuilder: GraphBuilder;
	moduleDetector: ModuleDetector;
	jsonTransformer: Transformer;
	htmlTransformer: Transformer;
	// Absent means SCIP indexes are ignored.
	indexResolver?: IndexResolver;
}

export function createCodemapGenerator(
	dependencies: CodemapGeneratorDependencies,
	logger: Logger = createConsoleLogger(),
): CodemapGenerator {
	const { discovery, parser, graphBuilder, moduleDetector, jsonTransformer, htmlTransformer, indexResolver } =
		dependencies;

	// Times each pipeline stage and remembers which one is running, so a failure can name it.
	function createStageTimer() {
		const startedAt = performance.now();
		const durationsMs: Record<string, number> = {};
		let current = "setup";
		return {
			run<T>(stage: string, work: () => T): T {
				current = stage;
				const stageStartedAt = performance.now();
				const result = work();
				durationsMs[stage] = Math.round(performance.now() - stageStartedAt);
				return result;
			},
			currentStage: () => current,
			summary: () => ({
				...durationsMs,
				total: Math.round(performance.now() - startedAt),
			}),
		};
	}

	function runGeneration(
		inputRootDir: string,
		options: GenerateMapOptions,
		timer: ReturnType<typeof createStageTimer>,
	): GeneratedMap {
		// Canonicalised once, up front: `Parser`'s checker-resolved import targets always come back
		// realpathed (typescript@7 follows symlinks - including one behind `rootDir` itself, like
		// macOS's `/var` -> `/private/var` tmpdir - to compute a file's canonical identity), so every
		// downstream `path.relative(rootDir, …)` needs the same canonical form or produces garbage.
		const rootDir = fs.realpathSync(inputRootDir);
		const { exclude, outDir, force = false, includeTests = false, scipIndexes = {} } = options;
		const cachePath = path.join(outDir, CACHE_FILE_NAME);
		const indexSources = indexResolver ? resolveIndexSources(rootDir, scipIndexes) : [];

		const { structure, files, currentEpoch, cacheDiff } = timer.run("discover", () => {
			const structure = discovery.discover(rootDir, exclude, includeTests);
			// Discovery's ids are repo-relative (they double as node ids); the cache and Parser need
			// real filesystem paths, resolved here at the orchestrator boundary. `rewriteSymbolPaths`
			// converts Parser's output back before `GraphBuilder` sees it.
			const files = structure.programFiles.map((relativePath) => path.join(rootDir, relativePath));
			const currentEpoch = computeCurrentEpoch(rootDir, structure, exclude, includeTests, indexSources);
			const cacheDiff = diffAgainstCache(cachePath, files, currentEpoch, force);
			return { structure, files, currentEpoch, cacheDiff };
		});
		logger.info("cache diff computed", {
			totalFiles: files.length,
			changedFiles: cacheDiff.extractFiles.length,
			cachedFiles: Object.keys(cacheDiff.cached).length,
		});

		const { symbolsByFile, symbolsForGraph, structureForGraph, unparseable, unreadableIndexes } = timer.run(
			"parse",
			() => {
				const parsedSymbols = parser.parse(rootDir, files, cacheDiff.extractFiles);
				const resolution = indexResolver?.resolve(
					indexSources,
					parsedSymbols,
					mergeSymbolsByFile(cacheDiff.cached, parsedSymbols),
				) ?? { symbols: parsedSymbols, unreadableIndexes: [] };
				const freshSymbols = resolution.symbols;
				const symbolsByFile = mergeSymbolsByFile(cacheDiff.cached, freshSymbols);
				const { symbols, skippedRelativePaths } = rewriteSymbolPaths(rootDir, structure, files, symbolsByFile);
				const structureForGraph = buildStructureForGraph(structure, skippedRelativePaths);
				const symbolsWithValidImports = rewriteDanglingFileImports(symbols, new Set(structureForGraph.programFiles));
				const symbolsForGraph = stripHiddenTestItems(symbolsWithValidImports, includeTests);
				logger.info("hidden test items stripped", {
					hiddenSymbols: countSymbols(symbolsWithValidImports) - countSymbols(symbolsForGraph),
				});
				return {
					symbolsByFile,
					symbolsForGraph,
					structureForGraph,
					unparseable: skippedRelativePaths,
					unreadableIndexes: resolution.unreadableIndexes,
				};
			},
		);

		const rawGraph = timer.run("build", () => graphBuilder.build(symbolsForGraph, structureForGraph));
		const clusteredGraph = timer.run("cluster", () => moduleDetector.detect(rawGraph));
		logModuleAssignment(clusteredGraph);

		timer.run("saveCache", () =>
			saveCache(cachePath, {
				epoch: currentEpoch,
				files: buildCacheFiles(files, symbolsByFile, cacheDiff.contentHashes),
			}),
		);

		// Manifest-less first, then unparseable: the order `codemap.json`'s `warnings` has always had.
		const skippedFiles: SkippedFile[] = [
			...structure.manifestlessFiles.map((file) => ({
				file,
				reason: "manifest-less" as const,
			})),
			...unparseable.map((file) => ({ file, reason: "unparseable" as const })),
		];
		const indexWarnings = collectIndexWarnings(rootDir, symbolsForGraph, unreadableIndexes);

		const { json, html } = timer.run("transform", () => ({
			json: jsonTransformer.transform(clusteredGraph, {
				warnings: [...skippedFiles.map(formatSkippedFile), ...indexWarnings.map(formatIndexWarning)],
			}),
			html: htmlTransformer.transform(clusteredGraph),
		}));

		logger.info("generate complete", {
			nodeCount: clusteredGraph.nodes.length,
			edgeCount: clusteredGraph.edges.length,
			warningCount: skippedFiles.length + indexWarnings.length,
			indexSources: indexSources.length,
			indexFallbacks: indexWarnings.length,
			filesByLanguage: countByLanguage(structure.programFiles),
			skippedByLanguage: countByLanguage(skippedFiles.map(({ file }) => file)),
			durationsMs: timer.summary(),
		});

		return {
			json,
			html,
			skippedFiles,
			...(indexWarnings.length > 0 ? { indexWarnings } : {}),
			nodeCount: clusteredGraph.nodes.length,
			edgeCount: clusteredGraph.edges.length,
		};
	}

	function logModuleAssignment(clusteredGraph: ClusteredGraph): void {
		const fileNodes = clusteredGraph.nodes.filter((node) => node.kind === "file");
		const assigned = fileNodes.filter((node) => node.moduleId !== null).length;
		// Only the reasons actually present this run, not a fixed breakdown of every
		// `UnassignedReason` - keeps this log line from drifting out of sync with that union as new
		// reasons are added (documentation/adr/0048's "config" most recently).
		const unassignedByReason: Record<string, number> = {};
		for (const node of fileNodes) {
			if (node.moduleId !== null) continue;
			const reason = node.unassignedReason ?? "unknown";
			unassignedByReason[reason] = (unassignedByReason[reason] ?? 0) + 1;
		}
		logger.info("module detection complete", {
			assigned,
			unassigned: fileNodes.length - assigned,
			unassignedByReason,
		});
	}

	return {
		generateMap(inputRootDir: string, options: GenerateMapOptions): GeneratedMap {
			// One id per run on every log line, so a run can be reassembled from logs alone. A caller
			// that already set one (an MCP request, a CLI invocation) keeps it.
			const runId = currentLogContext().runId ?? crypto.randomUUID();
			return withLogContext({ runId }, () => {
				const timer = createStageTimer();
				try {
					return runGeneration(inputRootDir, options, timer);
				} catch (error) {
					logger.error("generate failed", {
						stage: timer.currentStage(),
						error: error instanceof Error ? error.message : String(error),
						durationsMs: timer.summary(),
					});
					throw error;
				}
			});
		},
	};
}
