import { type SpawnSyncReturns, spawnSync } from "node:child_process";

// documentation/adr/0056 decision 1: the only module that spawns a process. Synchronous, so
// `generateMap` stays synchronous, and never through a shell: each argument reaches the indexer
// verbatim. The child inherits this process's environment, an activated virtualenv included.

export interface IndexerCommand {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
	env?: Readonly<Record<string, string>>; // added to the inherited environment
	// Which stderr line explains a non-zero exit: the last, by default, or the first error line,
	// for a tool that ends a failure with a backtrace.
	detail?: "last-line" | "first-error";
}

// `stderr` is the whole of it, for a caller whose tool puts its useful line first.
export type IndexerExit = { ok: true } | { ok: false; reason: string; stderr: string };

export interface IndexerProcess {
	run(command: IndexerCommand): IndexerExit;
}

// Generous, since an indexer's stderr is read only for one line; overflowing the buffer
// would kill the child mid-run.
const STDERR_BUFFER_BYTES = 64 * 1024 * 1024;

function linesOf(output: string): string[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

// `error: ...`, `Error: ...`, or a compiler diagnostic such as `src/lib.rs:2:5: error[E0308]: ...`.
// Never an `error:` inside prose, such as `exited with an error:`.
const ERROR_LINE = /(^|: )error(\[\w+\])?:/i;

export function firstErrorLine(output: string): string | undefined {
	return linesOf(output).find((line) => ERROR_LINE.test(line));
}

function errorCodeOf(error: Error | undefined): string | undefined {
	return error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function exitStatusReason(status: number | null, stderr: string, mode: IndexerCommand["detail"]): string {
	const detail = (mode === "first-error" ? firstErrorLine(stderr) : undefined) ?? linesOf(stderr).at(-1);
	return `exited with status ${status}${detail ? `: ${detail}` : ""}`;
}

function failureReasonOf(
	result: SpawnSyncReturns<string>,
	{ command, timeoutMs, detail }: IndexerCommand,
): string | undefined {
	const code = errorCodeOf(result.error);
	if (code === "ENOENT") return `${command} not found on PATH`;
	if (code === "ETIMEDOUT") return `timed out after ${timeoutMs / 1000}s`;
	if (result.error) return result.error.message;
	if (result.signal !== null) return `killed by ${result.signal}`;
	if (result.status !== 0) return exitStatusReason(result.status, result.stderr ?? "", detail);
	return undefined;
}

export function createIndexerProcess(): IndexerProcess {
	return {
		run(indexerCommand) {
			const result = spawnSync(indexerCommand.command, indexerCommand.args, {
				cwd: indexerCommand.cwd,
				env: indexerCommand.env ? { ...process.env, ...indexerCommand.env } : process.env,
				timeout: indexerCommand.timeoutMs,
				shell: false,
				stdio: ["ignore", "ignore", "pipe"],
				encoding: "utf8",
				maxBuffer: STDERR_BUFFER_BYTES,
			});
			const reason = failureReasonOf(result, indexerCommand);
			return reason === undefined ? { ok: true } : { ok: false, reason, stderr: result.stderr ?? "" };
		},
	};
}
