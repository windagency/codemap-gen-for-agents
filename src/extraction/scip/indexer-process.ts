import { type SpawnSyncReturns, spawnSync } from "node:child_process";

// documentation/adr/0056 decision 1: the only module that spawns a process. Synchronous, so
// `generateMap` stays synchronous, and never through a shell: each argument reaches the indexer
// verbatim. The child inherits this process's environment, an activated virtualenv included.

export interface IndexerCommand {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
}

export type IndexerExit = { ok: true } | { ok: false; reason: string };

export interface IndexerProcess {
	run(command: IndexerCommand): IndexerExit;
}

// Generous, since an indexer's stderr is read only for its last line; overflowing the buffer
// would kill the child mid-run.
const STDERR_BUFFER_BYTES = 64 * 1024 * 1024;

function lastLineOf(output: string): string | undefined {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.at(-1);
}

function errorCodeOf(error: Error | undefined): string | undefined {
	return error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function exitStatusReason(status: number | null, stderr: string): string {
	const detail = lastLineOf(stderr);
	return `exited with status ${status}${detail ? `: ${detail}` : ""}`;
}

function failureReasonOf(result: SpawnSyncReturns<string>, { command, timeoutMs }: IndexerCommand): string | undefined {
	const code = errorCodeOf(result.error);
	if (code === "ENOENT") return `${command} not found on PATH`;
	if (code === "ETIMEDOUT") return `timed out after ${timeoutMs / 1000}s`;
	if (result.error) return result.error.message;
	if (result.signal !== null) return `killed by ${result.signal}`;
	if (result.status !== 0) return exitStatusReason(result.status, result.stderr ?? "");
	return undefined;
}

export function createIndexerProcess(): IndexerProcess {
	return {
		run(indexerCommand) {
			const result = spawnSync(indexerCommand.command, indexerCommand.args, {
				cwd: indexerCommand.cwd,
				timeout: indexerCommand.timeoutMs,
				shell: false,
				stdio: ["ignore", "ignore", "pipe"],
				encoding: "utf8",
				maxBuffer: STDERR_BUFFER_BYTES,
			});
			const reason = failureReasonOf(result, indexerCommand);
			return reason === undefined ? { ok: true } : { ok: false, reason };
		},
	};
}
