import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { IndexSchema } from "@scip-code/scip";

// Regenerates each SCIP-indexed fixture's committed `index.scip` (documentation/adr/0056).
// Runs the real indexer, which must already be installed (`scip-go` on PATH for Go, `rust-analyzer`
// for Rust), then rewrites `metadata.projectRoot` to a machine-neutral URI, so the
// committed file never records the path of whoever regenerated it. The generator resolves
// document paths against the index file's own directory whenever `projectRoot` does not exist.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const FIXTURES = [
	{
		name: "python-scip",
		command: "npx",
		args: [
			"--yes",
			"@sourcegraph/scip-python@0.6.6",
			"index",
			".",
			"--project-name=python-scip",
			"--project-version=0.1.0",
			"--quiet",
		],
	},
	{
		// A fixed module version: scip-go otherwise records the current git commit in every symbol.
		name: "go-scip",
		command: "scip-go",
		args: ["index", "--module-version=0.1.0", "--quiet"],
	},
	{
		// Build-script output goes to the scratch directory, not a `target/` inside the fixture.
		name: "rust-scip",
		command: "rust-analyzer",
		args: ["scip", "."],
		env: (scratchDir) => ({
			// biome-ignore lint/style/useNamingConvention: environment variable name
			CARGO_TARGET_DIR: path.join(scratchDir, "target"),
		}),
	},
];

// Fixture names on the command line regenerate only those; none regenerates every one.
const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !FIXTURES.some((fixture) => fixture.name === name));
if (unknown.length > 0) throw new Error(`Unknown SCIP fixture: ${unknown.join(", ")}`);
const selected = requested.length === 0 ? FIXTURES : FIXTURES.filter((fixture) => requested.includes(fixture.name));

for (const fixture of selected) {
	const fixtureDir = path.join(REPO_ROOT, "fixtures", fixture.name);
	const scratchDir = mkdtempSync(path.join(os.tmpdir(), "codemap-scip-"));
	const rawIndexPath = path.join(scratchDir, "index.scip");
	try {
		execFileSync(fixture.command, [...fixture.args, "--output", rawIndexPath], {
			cwd: fixtureDir,
			stdio: "inherit",
			env: { ...process.env, ...fixture.env?.(scratchDir) },
		});

		const index = fromBinary(IndexSchema, readFileSync(rawIndexPath));
		if (index.metadata) index.metadata.projectRoot = `file:///${fixture.name}`;
		writeFileSync(path.join(fixtureDir, "index.scip"), toBinary(IndexSchema, index));
		console.log(`Wrote fixtures/${fixture.name}/index.scip`);
	} finally {
		rmSync(scratchDir, { recursive: true, force: true });
	}
}
