import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [base, head] = process.argv.slice(2);
if (!base || !head) {
	console.error("usage: node scripts/check-tdd-order.mjs <base-sha> <head-sha>");
	process.exit(2);
}

const git = (args, options = {}) => execFileSync("git", args, { encoding: "utf8", ...options });

const isTestFile = (file) => file.startsWith("src/") && /\.(test|spec)\.ts$/.test(file);
const isSourceFile = (file) =>
	file.startsWith("src/") && file.endsWith(".ts") && !isTestFile(file) && !file.includes("/__tests__/");

// A main-to-int sync PR brings in main's squash commits, which join each change's test and
// implementation commits into one. Their order was already checked on the way into int.
const mainRef = "origin/main";
const hasMainRef = (() => {
	try {
		git(["rev-parse", "--verify", "--quiet", mainRef], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

const commits = git([
	"rev-list",
	"--reverse",
	"--no-merges",
	`${base}..${head}`,
	...(hasMainRef ? [`^${mainRef}`] : []),
])
	.split("\n")
	.filter(Boolean);

const describe = (sha) => git(["log", "-1", "--format=%h %s", sha]).trim();
const isExempt = (sha) => /^TDD-Exempt:\s*\S/m.test(git(["log", "-1", "--format=%B", sha]));

const changesOf = (sha) => {
	const tokens = git(["diff-tree", "--no-commit-id", "-r", "--name-status", "--no-renames", "-z", sha])
		.split("\0")
		.filter(Boolean);
	const changes = [];
	for (let i = 0; i < tokens.length; i += 2) {
		changes.push({ status: tokens[i], file: tokens[i + 1] });
	}
	return changes;
};

const runNewTestsAt = (sha, files) => {
	const worktree = mkdtempSync(path.join(os.tmpdir(), "tdd-order-"));
	const linkedModules = path.join(worktree, "node_modules");
	try {
		git(["worktree", "add", "--detach", worktree, sha], { stdio: "ignore" });
		symlinkSync(path.resolve("node_modules"), linkedModules, "dir");
		try {
			const output = execFileSync(path.join(linkedModules, ".bin", "vitest"), ["run", ...files], {
				cwd: worktree,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			return { status: 0, output };
		} catch (error) {
			return { status: error.status, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
		}
	} finally {
		unlinkSync(linkedModules);
		git(["worktree", "remove", "--force", worktree], { stdio: "ignore" });
		rmSync(worktree, { recursive: true, force: true });
	}
};

const violations = [];
let earlierTestOnlyCommit = false;

for (const sha of commits) {
	const changes = changesOf(sha);
	const touchesTests = changes.some((change) => isTestFile(change.file));
	const touchesSource = changes.some((change) => isSourceFile(change.file));
	const exempt = isExempt(sha);
	const label = describe(sha);

	if (touchesSource && !exempt) {
		if (touchesTests) {
			violations.push(`${label}: tests and implementation share one commit; split them, test commit first`);
		} else if (!earlierTestOnlyCommit) {
			violations.push(`${label}: implementation has no earlier test-only commit`);
		}
	}

	if (touchesTests && !touchesSource) {
		earlierTestOnlyCommit = true;

		const addedTests = changes
			.filter((change) => change.status === "A" && isTestFile(change.file))
			.map((change) => change.file);

		if (addedTests.length > 0 && !exempt) {
			const result = runNewTestsAt(sha, addedTests);
			if (result.status === 0) {
				violations.push(`${label}: new tests pass before implementation; they must fail first`);
			} else if (result.output.includes("No test files found")) {
				violations.push(`${label}: new test files are not matched by vitest include (src/**/*.test.ts)`);
			} else if (result.status !== 1) {
				violations.push(`${label}: vitest exited ${result.status} at this commit, expected a test failure`);
			}
		}
	}
}

if (violations.length > 0) {
	console.error("tdd-order: violations found");
	for (const violation of violations) {
		console.error(`  - ${violation}`);
	}
	console.error("Exempt a commit with a 'TDD-Exempt: <reason>' trailer when TDD does not apply.");
	process.exitCode = 1;
} else {
	console.log(`tdd-order: ${commits.length} commit(s) checked, no violations`);
}
