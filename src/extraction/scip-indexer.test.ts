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

// Writes an index wherever `--output` points, unless told how to fail instead. `exits` overrides
// the exit of one command, such as the `go` of a pre-index check.
function fakeProcess(
	behaviour: { exit?: IndexerExit; writeIndex?: boolean; exits?: Record<string, IndexerExit> } = {},
): {
	process: IndexerProcess;
	commands: IndexerCommand[];
} {
	const commands: IndexerCommand[] = [];
	return {
		commands,
		process: {
			run(command) {
				commands.push(command);
				const exit = behaviour.exits?.[command.command] ?? behaviour.exit ?? { ok: true };
				const output = command.args.indexOf("--output");
				if (exit.ok && output !== -1 && behaviour.writeIndex !== false) {
					fs.writeFileSync(command.args[output + 1] ?? "", "fake index");
				}
				return exit;
			},
		},
	};
}

// One Go Package at `services/api@go`, beside the Python ones.
function withGoPackage(rootDir: string, request: IndexerRequest): IndexerRequest {
	fs.writeFileSync(path.join(rootDir, "services", "api", "main.go"), "package main\n");
	return {
		...request,
		languages: ["go"],
		structure: {
			...request.structure,
			programFiles: [...request.structure.programFiles, "services/api/main.go"],
			packages: [...request.structure.packages, { id: "services/api@go", name: "api", language: "go" }],
			fileOwners: {
				...request.structure.fileOwners,
				"services/api/main.go": { packageId: "services/api@go", directoryId: "services/api" },
			},
		},
	};
}

const GO_BUILD_ERRORS = "# example.com/api\nmain.go:3:9: undefined: x\nmain.go:4:9: undefined: y\n";

// One Rust Package at `services/api@rust`, beside the Python ones.
function withRustPackage(rootDir: string, request: IndexerRequest): IndexerRequest {
	fs.mkdirSync(path.join(rootDir, "services", "api", "src"), { recursive: true });
	fs.writeFileSync(path.join(rootDir, "services", "api", "src", "lib.rs"), "pub fn run() {}\n");
	return {
		...request,
		languages: ["rust"],
		structure: {
			...request.structure,
			programFiles: [...request.structure.programFiles, "services/api/src/lib.rs"],
			packages: [...request.structure.packages, { id: "services/api@rust", name: "api", language: "rust" }],
			fileOwners: {
				...request.structure.fileOwners,
				"services/api/src/lib.rs": { packageId: "services/api@rust", directoryId: "services/api/src" },
			},
		},
	};
}

// `--message-format=short` puts warnings before errors, and a summary line after them.
const CARGO_CHECK_ERRORS = [
	"src/lib.rs:7:4: warning: function `unused` is never used",
	"src/lib.rs:2:5: error[E0308]: mismatched types: expected `String`, found `&str`",
	"error: could not compile `api` (lib) due to 1 previous error",
	"",
].join("\n");

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
			checkFailures: [],
		});
	});

	it("runs go build, then scip-go, in each Go Package's root, keeping scip-go's stderr for a failure reason", () => {
		const { rootDir, outDir, request } = setUpRepo();
		const { process, commands } = fakeProcess();
		const goIndex = path.join(outDir, "scip", "services%2Fapi%40go.scip");
		const main = path.join(rootDir, "services", "api", "main.go");
		const cwd = path.join(rootDir, "services", "api");

		const result = createScipIndexer(process, fakeLogger().logger).index(withGoPackage(rootDir, request));

		expect(commands).toStrictEqual([
			{ command: "go", args: ["build", "-o", os.devNull, "./..."], cwd, timeoutMs: 600_000 },
			{ command: "scip-go", args: ["index", "--output", goIndex], cwd, timeoutMs: 600_000 },
		]);
		expect(result).toStrictEqual({
			sources: [{ language: "go", indexPath: goIndex, fileHashes: { [main]: sha256(main) } }],
			failures: [],
			checkFailures: [],
		});
	});

	it("keeps the index of a Package go build fails on, reporting its first error, and again once reused", () => {
		const { rootDir, request } = setUpRepo();
		const goRequest = withGoPackage(rootDir, request);
		const failingBuild = fakeProcess({
			exits: { go: { ok: false, reason: "exited with status 1: main.go:4:9: undefined: y", stderr: GO_BUILD_ERRORS } },
		});
		const checkFailure = { packageId: "services/api@go", check: "go build", reason: "main.go:3:9: undefined: x" };

		const first = createScipIndexer(failingBuild.process, fakeLogger().logger).index(goRequest);
		const reused = createScipIndexer(failingBuild.process, fakeLogger().logger).index(goRequest);

		expect(first.sources).toHaveLength(1);
		expect(first.checkFailures).toStrictEqual([checkFailure]);
		expect(reused.sources).toHaveLength(1);
		expect(reused.checkFailures).toStrictEqual([checkFailure]);
		expect(failingBuild.commands).toHaveLength(2);
	});

	it("reports a go build that never ran by its reason, and none when scip-go fails too", () => {
		const { rootDir, request } = setUpRepo();
		const goRequest = withGoPackage(rootDir, request);
		const other = setUpRepo();
		const otherGoRequest = withGoPackage(other.rootDir, other.request);
		const missingGo = { ok: false as const, reason: "go not found on PATH", stderr: "" };

		const indexed = createScipIndexer(fakeProcess({ exits: { go: missingGo } }).process, fakeLogger().logger).index(
			goRequest,
		);
		const notIndexed = createScipIndexer(
			fakeProcess({
				exit: { ok: false, reason: "exited with status 1: boom", stderr: "boom\n" },
				exits: { go: missingGo },
			}).process,
			fakeLogger().logger,
		).index(otherGoRequest);

		expect(indexed.checkFailures).toStrictEqual([
			{ packageId: "services/api@go", check: "go build", reason: "go not found on PATH" },
		]);
		expect(notIndexed.checkFailures).toStrictEqual([]);
		expect(notIndexed.failures).toHaveLength(1);
	});

	it("runs cargo check, then rust-analyzer, in each Rust Package's root, with build output under <outDir>/scip/", () => {
		const { rootDir, outDir, request } = setUpRepo();
		const { process, commands } = fakeProcess();
		const rustIndex = path.join(outDir, "scip", "services%2Fapi%40rust.scip");
		const lib = path.join(rootDir, "services", "api", "src", "lib.rs");
		const cwd = path.join(rootDir, "services", "api");
		// biome-ignore lint/style/useNamingConvention: environment variable name
		const env = { CARGO_TARGET_DIR: path.join(outDir, "scip", "cargo-target") };

		const result = createScipIndexer(process, fakeLogger().logger).index(withRustPackage(rootDir, request));

		expect(commands).toStrictEqual([
			{
				command: "cargo",
				args: ["check", "--locked", "--all-targets", "--message-format=short", "--quiet"],
				cwd,
				timeoutMs: 600_000,
				env,
			},
			{
				command: "rust-analyzer",
				args: ["scip", ".", "--output", rustIndex],
				cwd,
				timeoutMs: 600_000,
				env,
				detail: "first-error",
			},
		]);
		expect(result).toStrictEqual({
			sources: [{ language: "rust", indexPath: rustIndex, fileHashes: { [lib]: sha256(lib) } }],
			failures: [],
			checkFailures: [],
		});
	});

	it("reports cargo check's first error, past any warning, and keeps the index", () => {
		const { rootDir, request } = setUpRepo();
		const failingCheck = fakeProcess({
			exits: {
				cargo: { ok: false, reason: "exited with status 101: error: could not compile", stderr: CARGO_CHECK_ERRORS },
			},
		});

		const result = createScipIndexer(failingCheck.process, fakeLogger().logger).index(
			withRustPackage(rootDir, request),
		);

		expect(result.sources).toHaveLength(1);
		expect(result.checkFailures).toStrictEqual([
			{
				packageId: "services/api@rust",
				check: "cargo check",
				reason: "src/lib.rs:2:5: error[E0308]: mismatched types: expected `String`, found `&str`",
			},
		]);
	});

	it("runs nothing for a language left out of the request", () => {
		const { request } = setUpRepo();
		const { process, commands } = fakeProcess();

		const result = createScipIndexer(process, fakeLogger().logger).index({ ...request, languages: [] });

		expect(commands).toStrictEqual([]);
		expect(result).toStrictEqual({ sources: [], failures: [], checkFailures: [] });
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

		const failing = fakeProcess({ exit: { ok: false, reason: "exited with status 1: boom", stderr: "boom\n" } });
		const result = createScipIndexer(failing.process, fakeLogger().logger).index(request);

		expect(result).toStrictEqual({
			sources: [],
			failures: [
				{ packageId: ".", indexer: "scip-python", reason: "exited with status 1: boom" },
				{ packageId: "services/api", indexer: "scip-python", reason: "exited with status 1: boom" },
			],
			checkFailures: [],
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
		const failing = fakeProcess({ exit: { ok: false, reason: "timed out after 600s", stderr: "" } });
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
