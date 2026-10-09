import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LogContext, Logger } from "src/core/observability/logger";
import type { DiscoveredStructure } from "src/core/types";
import type { IndexerCommand, IndexerExit, IndexerProcess } from "src/extraction/scip/indexer-process";
import { createScipIndexer, type IndexerRequest } from "src/extraction/scip-indexer";
import { describe, expect, it } from "vitest";

// documentation/adr/0056 decision 1, with a fake process: no indexer has to be installed.

function fakeLogger(): { logger: Logger; calls: [string, string, LogContext | undefined][] } {
	const calls: [string, string, LogContext | undefined][] = [];
	const record = (level: string) => (message: string, context?: LogContext) => {
		calls.push([level, message, context]);
	};
	return {
		logger: { debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") },
		calls,
	};
}

// Writes an index wherever `--output` points, unless told how to fail instead.
function fakeProcess(behaviour: { exit?: IndexerExit; writeIndex?: boolean } = {}): {
	process: IndexerProcess;
	commands: IndexerCommand[];
} {
	const commands: IndexerCommand[] = [];
	return {
		commands,
		process: {
			run(command) {
				commands.push(command);
				const exit = behaviour.exit ?? { ok: true };
				if (exit.ok && behaviour.writeIndex !== false) {
					fs.writeFileSync(command.args[command.args.indexOf("--output") + 1] ?? "", "fake index");
				}
				return exit;
			},
		},
	};
}

function sha256(filePath: string): string {
	return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// A root Python Package, a nested one, an empty one, and a TypeScript one.
function setUpRepo(): { rootDir: string; outDir: string; request: IndexerRequest } {
	const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codemap-scip-indexer-")));
	const outDir = path.join(rootDir, ".codemap");
	const files = ["app/main.py", "services/api/handler.py", "web/index.ts"];
	for (const file of files) {
		fs.mkdirSync(path.dirname(path.join(rootDir, file)), { recursive: true });
		fs.writeFileSync(path.join(rootDir, file), `# ${file}\n`);
	}
	const structure: DiscoveredStructure = {
		programFiles: files,
		packages: [
			{ id: ".", name: "app", language: "python" },
			{ id: "services/api", name: "api", language: "python" },
			{ id: "empty", name: "empty", language: "python" },
			{ id: "web", name: "web", language: "typescript" },
		],
		directories: [],
		fileOwners: {
			"app/main.py": { packageId: ".", directoryId: "app" },
			"services/api/handler.py": { packageId: "services/api", directoryId: "services/api" },
			"web/index.ts": { packageId: "web", directoryId: "web" },
		},
		manifestlessFiles: [],
	};
	return { rootDir, outDir, request: { rootDir, outDir, structure, languages: ["python"], timeoutSeconds: 600 } };
}

describe("createScipIndexer", () => {
	it("runs scip-python once per Python Package with files, in that Package's root, writing under <outDir>/scip/", () => {
		const { rootDir, outDir, request } = setUpRepo();
		const { process, commands } = fakeProcess();
		const rootIndex = path.join(outDir, "scip", "%2E.scip");
		const apiIndex = path.join(outDir, "scip", "services%2Fapi.scip");

		const result = createScipIndexer(process, fakeLogger().logger).index(request);

		expect(commands).toStrictEqual([
			{ command: "scip-python", args: ["index", "--output", rootIndex, "--quiet"], cwd: rootDir, timeoutMs: 600_000 },
			{
				command: "scip-python",
				args: ["index", "--output", apiIndex, "--quiet"],
				cwd: path.join(rootDir, "services", "api"),
				timeoutMs: 600_000,
			},
		]);
		const main = path.join(rootDir, "app", "main.py");
		const handler = path.join(rootDir, "services", "api", "handler.py");
		expect(result).toStrictEqual({
			sources: [
				{ language: "python", indexPath: rootIndex, fileHashes: { [main]: sha256(main) } },
				{ language: "python", indexPath: apiIndex, fileHashes: { [handler]: sha256(handler) } },
			],
			failures: [],
		});
	});

	it("runs scip-go in each Go Package's root, keeping its stderr for a failure reason", () => {
		const { rootDir, outDir, request } = setUpRepo();
		fs.writeFileSync(path.join(rootDir, "services", "api", "main.go"), "package main\n");
		const { process, commands } = fakeProcess();
		const structure: DiscoveredStructure = {
			...request.structure,
			programFiles: [...request.structure.programFiles, "services/api/main.go"],
			packages: [...request.structure.packages, { id: "services/api@go", name: "api", language: "go" }],
			fileOwners: {
				...request.structure.fileOwners,
				"services/api/main.go": { packageId: "services/api@go", directoryId: "services/api" },
			},
		};
		const goIndex = path.join(outDir, "scip", "services%2Fapi%40go.scip");
		const main = path.join(rootDir, "services", "api", "main.go");

		const result = createScipIndexer(process, fakeLogger().logger).index({ ...request, structure, languages: ["go"] });

		expect(commands).toStrictEqual([
			{
				command: "scip-go",
				args: ["index", "--output", goIndex],
				cwd: path.join(rootDir, "services", "api"),
				timeoutMs: 600_000,
			},
		]);
		expect(result).toStrictEqual({
			sources: [{ language: "go", indexPath: goIndex, fileHashes: { [main]: sha256(main) } }],
			failures: [],
		});
	});

	it("runs nothing for a language left out of the request", () => {
		const { request } = setUpRepo();
		const { process, commands } = fakeProcess();

		const result = createScipIndexer(process, fakeLogger().logger).index({ ...request, languages: [] });

		expect(commands).toStrictEqual([]);
		expect(result).toStrictEqual({ sources: [], failures: [] });
	});

	it("reuses an earlier index while its Package's files hash the same, and re-runs after an edit", () => {
		const { rootDir, request } = setUpRepo();
		const { process, commands } = fakeProcess();
		const indexer = createScipIndexer(process, fakeLogger().logger);

		indexer.index(request);
		const reused = indexer.index(request);
		fs.writeFileSync(path.join(rootDir, "app", "main.py"), "# edited\n");
		indexer.index(request);

		expect(reused.sources).toHaveLength(2);
		expect(commands.map((command) => command.cwd)).toStrictEqual([
			rootDir,
			path.join(rootDir, "services", "api"),
			rootDir,
		]);
	});

	it("re-runs when its earlier index is gone", () => {
		const { rootDir, outDir, request } = setUpRepo();
		const { process, commands } = fakeProcess();
		const indexer = createScipIndexer(process, fakeLogger().logger);

		indexer.index(request);
		fs.rmSync(path.join(outDir, "scip", "%2E.scip"));
		indexer.index(request);

		expect(commands.map((command) => command.cwd).filter((cwd) => cwd === rootDir)).toHaveLength(2);
	});

	it("reports a failed run, and leaves no earlier index behind to be read against newer files", () => {
		const { rootDir, outDir, request } = setUpRepo();
		createScipIndexer(fakeProcess().process, fakeLogger().logger).index(request);
		fs.writeFileSync(path.join(rootDir, "app", "main.py"), "# edited\n");
		fs.writeFileSync(path.join(rootDir, "services", "api", "handler.py"), "# edited\n");

		const failing = fakeProcess({ exit: { ok: false, reason: "exited with status 1: boom" } });
		const result = createScipIndexer(failing.process, fakeLogger().logger).index(request);

		expect(result).toStrictEqual({
			sources: [],
			failures: [
				{ packageId: ".", indexer: "scip-python", reason: "exited with status 1: boom" },
				{ packageId: "services/api", indexer: "scip-python", reason: "exited with status 1: boom" },
			],
		});
		expect(fs.existsSync(path.join(outDir, "scip", "%2E.scip"))).toBe(false);
	});

	it("reports a run that exits cleanly but writes no index", () => {
		const { request } = setUpRepo();

		const result = createScipIndexer(fakeProcess({ writeIndex: false }).process, fakeLogger().logger).index(request);

		expect(result.sources).toStrictEqual([]);
		expect(result.failures[0]).toStrictEqual({
			packageId: ".",
			indexer: "scip-python",
			reason: "exited cleanly but wrote no index",
		});
	});

	it("logs each run's start and outcome, and each reused index", () => {
		const { request } = setUpRepo();
		const { logger, calls } = fakeLogger();
		const indexer = createScipIndexer(fakeProcess().process, logger);

		indexer.index({
			...request,
			structure: { ...request.structure, packages: request.structure.packages.slice(0, 1) },
		});
		indexer.index({
			...request,
			structure: { ...request.structure, packages: request.structure.packages.slice(0, 1) },
		});
		const failing = fakeProcess({ exit: { ok: false, reason: "timed out after 600s" } });
		fs.rmSync(path.join(request.outDir, "scip", "%2E.scip"));
		createScipIndexer(failing.process, logger).index({
			...request,
			structure: { ...request.structure, packages: request.structure.packages.slice(0, 1) },
		});

		const run = { language: "python", packageId: ".", indexer: "scip-python" };
		expect(calls).toStrictEqual([
			["info", "scip indexer started", run],
			["info", "scip indexer finished", { ...run, durationMs: expect.any(Number) }],
			["info", "scip index reused", run],
			["info", "scip indexer started", run],
			["warn", "scip indexer failed", { ...run, reason: "timed out after 600s", durationMs: expect.any(Number) }],
		]);
	});
});
