import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIndexerProcess } from "src/extraction/scip/indexer-process";
import { describe, expect, it } from "vitest";

// The real child process, driven through `node -e` so no indexer has to be installed.
const NODE = process.execPath;

function scratchDir(): string {
	return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codemap-indexer-process-")));
}

describe("createIndexerProcess", () => {
	it("reports a zero exit as success, having run in the given directory", () => {
		const cwd = scratchDir();

		const exit = createIndexerProcess().run({
			command: NODE,
			args: ["-e", "require('fs').writeFileSync('ran', process.cwd())"],
			cwd,
			timeoutMs: 10_000,
		});

		expect(exit).toStrictEqual({ ok: true });
		expect(fs.readFileSync(path.join(cwd, "ran"), "utf8")).toBe(cwd);
	});

	it("reports a non-zero exit with the last line the indexer wrote to stderr", () => {
		const exit = createIndexerProcess().run({
			command: NODE,
			args: ["-e", "console.error('first'); console.error('boom'); process.exit(3)"],
			cwd: scratchDir(),
			timeoutMs: 10_000,
		});

		expect(exit).toStrictEqual({ ok: false, reason: "exited with status 3: boom", stderr: "first\nboom\n" });
	});

	// rust-analyzer ends a failure with a backtrace, so its useful line is the first error.
	it("reports the first error line instead of the last when asked to", () => {
		const stderr = "WARN loading\nError: no projects\nStack backtrace:\n   9: _main\n";

		const exit = createIndexerProcess().run({
			command: NODE,
			args: ["-e", `process.stderr.write(${JSON.stringify(stderr)}); process.exit(1)`],
			cwd: scratchDir(),
			timeoutMs: 10_000,
			detail: "first-error",
		});

		expect(exit).toStrictEqual({ ok: false, reason: "exited with status 1: Error: no projects", stderr });
	});

	it("adds the given variables to the inherited environment", () => {
		const cwd = scratchDir();

		createIndexerProcess().run({
			command: NODE,
			args: [
				"-e",
				"require('fs').writeFileSync('env', [process.env.CODEMAP_TEST_VAR, process.env.PATH ? 'path' : ''].join())",
			],
			cwd,
			timeoutMs: 10_000,
			// biome-ignore lint/style/useNamingConvention: environment variable name
			env: { CODEMAP_TEST_VAR: "set" },
		});

		expect(fs.readFileSync(path.join(cwd, "env"), "utf8")).toBe("set,path");
	});

	it("reports a command that is not installed", () => {
		const exit = createIndexerProcess().run({
			command: "codemap-no-such-indexer",
			args: [],
			cwd: scratchDir(),
			timeoutMs: 10_000,
		});

		expect(exit).toStrictEqual({ ok: false, reason: "codemap-no-such-indexer not found on PATH", stderr: "" });
	});

	it("stops a run that outlives its timeout", () => {
		const exit = createIndexerProcess().run({
			command: NODE,
			args: ["-e", "setTimeout(() => {}, 10_000)"],
			cwd: scratchDir(),
			timeoutMs: 200,
		});

		expect(exit).toStrictEqual({ ok: false, reason: "timed out after 0.2s", stderr: "" });
	});

	it("passes each argument verbatim, never through a shell", () => {
		const cwd = scratchDir();

		createIndexerProcess().run({
			command: NODE,
			args: ["-e", "require('fs').writeFileSync('arg', process.argv[1])", "$(echo injected); true"],
			cwd,
			timeoutMs: 10_000,
		});

		expect(fs.readFileSync(path.join(cwd, "arg"), "utf8")).toBe("$(echo injected); true");
	});
});
