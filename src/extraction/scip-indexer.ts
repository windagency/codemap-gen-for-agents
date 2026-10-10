import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashFile } from "src/core/cache/extraction-cache";
import { extensionOf, languageOfExtension, parsePackageDir, type ScipLanguage } from "src/core/languages";
import type { LogContext, Logger } from "src/core/observability/logger";
import type { DiscoveredPackage, DiscoveredStructure } from "src/core/types";
import { type IndexHashes, parseIndexHashes } from "src/extraction/scip/index-hashes-schema";
import { createIndexerProcess, type IndexerProcess } from "src/extraction/scip/indexer-process";
import type { IndexSource } from "src/extraction/scip-resolver";

// documentation/adr/0056 decision 1: with `--run-indexers`, one indexer run per Package root of
// each requested language. Output lands under `<outDir>/scip/`, never in the target repo, beside
// a sidecar of the content hashes it was built from. A Package whose files all hash the same as
// last time reuses its earlier index.

export interface IndexerRequest {
	rootDir: string; // canonical
	outDir: string;
	structure: DiscoveredStructure;
	languages: readonly ScipLanguage[]; // the ones with no supplied index
	timeoutSeconds: number;
}

export interface IndexerFailure {
	packageId: string;
	indexer: string;
	reason: string;
}

// The index was written, but the pre-index check says it may miss part of the Package.
export interface IndexerCheckFailure {
	packageId: string;
	check: string;
	reason: string;
}

export interface IndexerResult {
	sources: IndexSource[];
	failures: IndexerFailure[];
	checkFailures: IndexerCheckFailure[];
}

export interface ScipIndexer {
	index(request: IndexerRequest): IndexerResult;
}

interface IndexerSpec {
	command: string;
	args(outputPath: string): string[];
	// Run first, in the same directory, for an indexer that exits 0 on code it could not fully read.
	check?: { label: string; command: string; args: string[] };
}

// Fixed argv, checked against `scip-python index --help` 0.6.6 and `scip-go index --help` 0.2.7.
// The working directory is the Package root, which is also what each indexer indexes. scip-go
// writes progress to stdout, which is discarded; its `--quiet` would also silence the stderr a
// failure reason comes from.
const INDEXERS: Readonly<Record<ScipLanguage, IndexerSpec>> = {
	python: { command: "scip-python", args: (outputPath) => ["index", "--output", outputPath, "--quiet"] },
	// scip-go exits 0 with an empty stderr on a syntax error, a type error, or a missing
	// dependency. `go build` reports each; `-o` to the null device writes no binary into the repo.
	go: {
		command: "scip-go",
		args: (outputPath) => ["index", "--output", outputPath],
		check: { label: "go build", command: "go", args: ["build", "-o", os.devNull, "./..."] },
	},
};

const SCIP_DIR_NAME = "scip";

// `encodeURIComponent` keeps every Package id distinct as a file name: `.` becomes `%2E`, a `/`
// becomes `%2F`.
function outputBaseOf(outDir: string, packageId: string): string {
	const fileName = packageId === "." ? "%2E" : encodeURIComponent(packageId);
	return path.join(outDir, SCIP_DIR_NAME, fileName);
}

function readHashes(hashesPath: string): IndexHashes | undefined {
	try {
		return parseIndexHashes(JSON.parse(fs.readFileSync(hashesPath, "utf8")));
	} catch {
		return undefined;
	}
}

// The first line that names a problem, skipping `go build`'s `# <package>` headers; the last one
// is often `too many errors` or the `go get` hint under a missing dependency.
function firstProblemLine(stderr: string): string | undefined {
	return stderr
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line !== "" && !line.startsWith("#"));
}

function sameHashes(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
	const leftKeys = Object.keys(left);
	return leftKeys.length === Object.keys(right).length && leftKeys.every((key) => left[key] === right[key]);
}

function filesOf(structure: DiscoveredStructure, pkg: DiscoveredPackage, language: ScipLanguage): string[] {
	return structure.programFiles.filter(
		(file) => structure.fileOwners[file]?.packageId === pkg.id && languageOfExtension(extensionOf(file)) === language,
	);
}

// Every Package of a requested language that owns at least one file of it.
function packagesToIndex(
	request: IndexerRequest,
): { pkg: DiscoveredPackage; language: ScipLanguage; files: string[] }[] {
	return request.languages.flatMap((language) =>
		request.structure.packages.flatMap((pkg) => {
			if (pkg.language !== language) return [];
			const files = filesOf(request.structure, pkg, language);
			return files.length === 0 ? [] : [{ pkg, language, files }];
		}),
	);
}

interface IndexedPackage {
	source: IndexSource;
	checkFailure?: IndexerCheckFailure;
}

export function createScipIndexer(indexerProcess: IndexerProcess, logger: Logger): ScipIndexer {
	function runCheck(spec: IndexerSpec, cwd: string, timeoutMs: number, run: LogContext): string | undefined {
		if (!spec.check) return undefined;
		const startedAt = performance.now();
		const exit = indexerProcess.run({ command: spec.check.command, args: spec.check.args, cwd, timeoutMs });
		if (exit.ok) return undefined;
		const reason = firstProblemLine(exit.stderr) ?? exit.reason;
		const durationMs = Math.round(performance.now() - startedAt);
		logger.warn("scip indexer check failed", { ...run, check: spec.check.label, reason, durationMs });
		return reason;
	}

	function indexPackage(
		request: IndexerRequest,
		pkg: DiscoveredPackage,
		language: ScipLanguage,
		files: string[],
	): IndexedPackage | IndexerFailure {
		const spec = INDEXERS[language];
		const base = outputBaseOf(request.outDir, pkg.id);
		const indexPath = `${base}.scip`;
		const hashesPath = `${base}.hashes.json`;
		const hashes = Object.fromEntries(files.map((file) => [file, hashFile(path.join(request.rootDir, file))]));
		const source: IndexSource = {
			language,
			indexPath,
			fileHashes: Object.fromEntries(files.map((file) => [path.join(request.rootDir, file), hashes[file] ?? ""])),
		};
		const run = { language, packageId: pkg.id, indexer: spec.command };
		const indexed = (checkFailure: string | undefined): IndexedPackage =>
			checkFailure === undefined || !spec.check
				? { source }
				: { source, checkFailure: { packageId: pkg.id, check: spec.check.label, reason: checkFailure } };

		const previous = readHashes(hashesPath);
		if (previous && fs.existsSync(indexPath) && sameHashes(previous.files, hashes)) {
			logger.info("scip index reused", run);
			return indexed(previous.checkFailure);
		}

		// An index from an earlier run must never be read against files that have since changed.
		fs.rmSync(indexPath, { force: true });
		fs.rmSync(hashesPath, { force: true });
		fs.mkdirSync(path.dirname(indexPath), { recursive: true });

		const cwd = path.join(request.rootDir, parsePackageDir(pkg.id));
		const timeoutMs = request.timeoutSeconds * 1000;
		const checkFailure = runCheck(spec, cwd, timeoutMs, run);

		logger.info("scip indexer started", run);
		const startedAt = performance.now();
		const exit = indexerProcess.run({ command: spec.command, args: spec.args(indexPath), cwd, timeoutMs });
		const durationMs = Math.round(performance.now() - startedAt);

		const reason = exit.ok ? (fs.existsSync(indexPath) ? undefined : "exited cleanly but wrote no index") : exit.reason;
		if (reason !== undefined) {
			logger.warn("scip indexer failed", { ...run, reason, durationMs });
			return { packageId: pkg.id, indexer: spec.command, reason };
		}
		logger.info("scip indexer finished", { ...run, durationMs });
		fs.writeFileSync(hashesPath, JSON.stringify({ files: hashes, checkFailure } satisfies IndexHashes));
		return indexed(checkFailure);
	}

	return {
		index(request) {
			const result: IndexerResult = { sources: [], failures: [], checkFailures: [] };
			for (const { pkg, language, files } of packagesToIndex(request)) {
				const outcome = indexPackage(request, pkg, language, files);
				if (!("source" in outcome)) {
					result.failures.push(outcome);
					continue;
				}
				result.sources.push(outcome.source);
				if (outcome.checkFailure) result.checkFailures.push(outcome.checkFailure);
			}
			return result;
		},
	};
}

// The composition root's entry point: `core/` may not import `scip/` directly, so the real
// process adapter is attached here.
export function createDefaultScipIndexer(logger: Logger): ScipIndexer {
	return createScipIndexer(createIndexerProcess(), logger);
}
