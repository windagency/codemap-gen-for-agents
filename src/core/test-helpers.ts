// Shared test-only setup, factored out of `read-command.test.ts`, `generate-map.test.ts`,
// `mcp-adapter.test.ts`, `skill-adapter.test.ts`, and `cli-adapter.test.ts` (code-review DRY
// finding): every one of those files was hand-rolling an identical `fakeLogger()` and/or an
// identical "mkdtemp (+ realpath) + optional package.json + source file(s)" fixture-repo
// `beforeEach`. Test-only, never imported by production code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentLogContext, type LogContext, type Logger } from "src/core/observability/logger";

/**
 * A capturing fake `Logger`: every call is pushed to `calls` as `[level, message, context]`
 * instead of being written anywhere, so a test can assert exactly what was logged. `context`
 * includes any ambient `withLogContext` fields, as the console logger would write them.
 */
export function fakeLogger(): {
	logger: Logger;
	calls: [string, string, LogContext | undefined][];
} {
	const calls: [string, string, LogContext | undefined][] = [];
	const record = (level: string) => (message: string, context?: LogContext) => {
		const ambient = currentLogContext();
		calls.push([level, message, Object.keys(ambient).length > 0 ? { ...ambient, ...context } : context]);
	};
	return {
		logger: {
			debug: record("debug"),
			info: record("info"),
			warn: record("warn"),
			error: record("error"),
		},
		calls,
	};
}

export interface FixtureRepoOptions {
	/** `fs.mkdtempSync` prefix, kept distinct per caller for readable tmp-dir names. */
	prefix: string;
	/**
	 * Resolve the mkdtemp'd path through `fs.realpathSync` (macOS's `/var` -> `/private/var`
	 * tmpdir symlink) - needed only when a test later compares a result against its own `rootDir`.
	 */
	realpath?: boolean;
	/** Written as `package.json` (JSON-stringified) when provided. */
	packageJson?: Record<string, unknown>;
	/** Each entry is written as `<rootDir>/<relativePath>` with the given contents. */
	files?: Record<string, string>;
}

/**
 * Creates a fresh temp-dir fixture repo: an `fs.mkdtempSync` directory, optionally realpathed,
 * optionally seeded with a `package.json` and/or source files. Returns the resulting `rootDir`.
 * Callers are still responsible for their own `afterEach(() => fs.rmSync(rootDir, { recursive:
 * true, force: true }))` cleanup.
 */
export function createFixtureRepo(options: FixtureRepoOptions): string {
	let rootDir = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix));
	if (options.realpath) {
		rootDir = fs.realpathSync(rootDir);
	}
	if (options.packageJson) {
		fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify(options.packageJson));
	}
	for (const [relativePath, contents] of Object.entries(options.files ?? {})) {
		fs.writeFileSync(path.join(rootDir, relativePath), contents);
	}
	return rootDir;
}
