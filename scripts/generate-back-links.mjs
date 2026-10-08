#!/usr/bin/env node
// Writes a "[Back to X](path)" line under the title of every Markdown file, one link per other
// Markdown file that mentions it (a Markdown link, a plain or backticked `*.md` path, or a
// backticked folder path standing for that folder's README.md). Existing back-link lines are
// ignored when finding mentions and replaced on write, so re-running only applies the delta.
// Run `node scripts/generate-back-links.mjs` from anywhere to write, or `--check` (what the
// pre-commit hook runs) to fail without writing if any back-link line is stale.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACK_LINK_PREFIX = "[Back to ";
const CHECK = process.argv.includes("--check");

// SKILL.md is copied into dist/ and installed outside this repo, where relative links break.
// THIRD_PARTY_LICENSES.md is generated: its back-link line lives in
// scripts/generate-third-party-licenses.mjs, so this script only prints the line to paste there.
const PRINT_ONLY = new Set(["src/integration/skill/SKILL.md", "THIRD_PARTY_LICENSES.md"]);

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"], {
	cwd: ROOT,
	encoding: "utf8",
})
	.trim()
	.split("\n")
	.filter((file) => !file.startsWith("fixtures/"))
	.sort();
const fileSet = new Set(files);

const filesByBasename = new Map();
for (const file of files) {
	filesByBasename.set(basename(file), [...(filesByBasename.get(basename(file)) ?? []), file]);
}

const read = (file) => readFileSync(join(ROOT, file), "utf8");

const resolveMention = (from, raw) => {
	const target = raw.split("#")[0].split("?")[0].replace(/^<|>$/g, "");
	if (!target || /^[a-z]+:/i.test(target)) return null;
	const candidates = [normalize(join(dirname(from), target)), normalize(target.replace(/^\//, ""))];
	for (const candidate of candidates.map((c) => c.replace(/\/$/, ""))) {
		if (fileSet.has(candidate)) return candidate;
		if (fileSet.has(`${candidate}/README.md`)) return `${candidate}/README.md`;
	}
	// A bare filename with no resolvable path still counts when only one file has that name.
	const sameName = target.endsWith(".md") ? filesByBasename.get(basename(target)) : undefined;
	return sameName?.length === 1 ? sameName[0] : null;
};

const referrers = new Map(files.map((file) => [file, new Set()]));
for (const from of files) {
	const text = read(from)
		.split("\n")
		.filter((line) => !line.startsWith(BACK_LINK_PREFIX))
		.join("\n");
	const mentions = [
		...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]),
		...[...text.matchAll(/[\w./-]*[\w-]+\.md\b/g)].map((match) => match[0]),
		...[...text.matchAll(/`([\w./-]+\/)`/g)].map((match) => match[1]),
	];
	for (const mention of mentions) {
		const target = resolveMention(from, mention);
		if (target && target !== from) referrers.get(target).add(from);
	}
}

const label = (file) =>
	file !== "README.md" && filesByBasename.get(basename(file)).length > 1 ? file : basename(file);

const backLinkLine = (target) =>
	[...referrers.get(target)]
		.sort((a, b) => (a === "README.md" ? -1 : b === "README.md" ? 1 : a.localeCompare(b)))
		.map((referrer) => `${BACK_LINK_PREFIX}${label(referrer)}](${relative(dirname(target), referrer)})`)
		.join(" • ");

const stale = [];
for (const [target, refs] of referrers) {
	if (refs.size === 0) continue;
	const lines = read(target).split("\n");
	if (PRINT_ONLY.has(target)) {
		// Only a file that already carries a back-link line (the generated one) can go stale.
		if (CHECK && lines[2]?.startsWith(BACK_LINK_PREFIX) && lines[2] !== backLinkLine(target)) stale.push(target);
		if (!CHECK) console.log(`Not written, ${target}: ${backLinkLine(target)}`);
		continue;
	}
	if (!lines[0].startsWith("# ")) {
		console.log(`Not written, ${target}: first line is not a "# " title`);
		continue;
	}
	let bodyStart = 1;
	while (bodyStart < lines.length && (lines[bodyStart] === "" || lines[bodyStart].startsWith(BACK_LINK_PREFIX))) {
		bodyStart++;
	}
	const content = [lines[0], "", backLinkLine(target), "", ...lines.slice(bodyStart)].join("\n");
	if (content === lines.join("\n")) continue;
	if (CHECK) stale.push(target);
	else writeFileSync(join(ROOT, target), content);
}

if (stale.length > 0) {
	console.error(`Back-link lines are stale in:\n${stale.map((file) => `  ${file}`).join("\n")}`);
	console.error("Run `pnpm run backlinks:generate` and stage the result.");
	if (stale.some((file) => PRINT_ONLY.has(file))) {
		console.error("For a not-written file, paste the line it prints into that file's generator.");
	}
	process.exit(1);
}
if (CHECK) console.log("Back-link lines are up to date.");
