import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { IndexSchema } from "@scip-code/scip";

// Regenerates each SCIP-indexed fixture's committed `index.scip` (documentation/adr/0056).
// Runs the real indexer, then rewrites `metadata.projectRoot` to a machine-neutral URI, so the
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
];

for (const fixture of FIXTURES) {
	const fixtureDir = path.join(REPO_ROOT, "fixtures", fixture.name);
	const scratchDir = mkdtempSync(path.join(os.tmpdir(), "codemap-scip-"));
	const rawIndexPath = path.join(scratchDir, "index.scip");
	try {
		execFileSync(fixture.command, [...fixture.args, "--output", rawIndexPath], { cwd: fixtureDir, stdio: "inherit" });

		const index = fromBinary(IndexSchema, readFileSync(rawIndexPath));
		if (index.metadata) index.metadata.projectRoot = `file:///${fixture.name}`;
		writeFileSync(path.join(fixtureDir, "index.scip"), toBinary(IndexSchema, index));
		console.log(`Wrote fixtures/${fixture.name}/index.scip`);
	} finally {
		rmSync(scratchDir, { recursive: true, force: true });
	}
}
