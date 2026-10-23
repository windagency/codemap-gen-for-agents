import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs scripts/generate-back-links.mjs as a black box against a throwaway git repo. The script
// resolves its root from its own location, so each test copies it into the temp repo's scripts/.
const SCRIPT = path.resolve(import.meta.dirname, "..", "..", "..", "scripts", "generate-back-links.mjs");

let rootDir: string;

beforeEach(() => {
	rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codemap-back-links-")));
	execFileSync("git", ["init", "-q"], { cwd: rootDir });
	fs.mkdirSync(path.join(rootDir, "scripts"));
	fs.copyFileSync(SCRIPT, path.join(rootDir, "scripts", "generate-back-links.mjs"));
});

afterEach(() => {
	fs.rmSync(rootDir, { recursive: true, force: true });
});

function write(file: string, content: string): void {
	fs.writeFileSync(path.join(rootDir, file), content);
}

function read(file: string): string {
	return fs.readFileSync(path.join(rootDir, file), "utf8");
}

function run(...args: string[]): { status: number; output: string } {
	try {
		const output = execFileSync(process.execPath, ["scripts/generate-back-links.mjs", ...args], {
			cwd: rootDir,
			encoding: "utf8",
			stdio: "pipe",
		});
		return { status: 0, output };
	} catch (error) {
		const failure = error as { status: number; stdout: string; stderr: string };
		return { status: failure.status, output: failure.stdout + failure.stderr };
	}
}

describe("generate-back-links", () => {
	it("writes a back-link line under the title of a mentioned file", () => {
		write("README.md", "# Root\n\nSee [a](a.md).\n");
		write("a.md", "# A\n\nbody\n");

		run();

		expect(read("a.md")).toBe("# A\n\n[Back to README.md](README.md)\n\nbody\n");
	});

	it("removes the back-link line of a file that lost every mention", () => {
		write("README.md", "# Root\n\nNo mention.\n");
		write("a.md", "# A\n\n[Back to README.md](README.md)\n\nbody\n");

		run();

		expect(read("a.md")).toBe("# A\n\nbody\n");
	});

	it("fails --check on the back-link line of a file that lost every mention", () => {
		write("README.md", "# Root\n\nNo mention.\n");
		write("a.md", "# A\n\n[Back to README.md](README.md)\n\nbody\n");

		const { status, output } = run("--check");

		expect(status).toBe(1);
		expect(output).toContain("  a.md");
	});

	it("fails --check on a print-only file's back-link line once nothing mentions it", () => {
		write("README.md", "# Root\n\nNo mention.\n");
		write("THIRD_PARTY_LICENSES.md", "# Licenses\n\n[Back to README.md](README.md)\n\nbody\n");

		const { status, output } = run("--check");

		expect(status).toBe(1);
		expect(output).toContain("  THIRD_PARTY_LICENSES.md");
	});
});
