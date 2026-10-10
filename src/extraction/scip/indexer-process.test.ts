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
