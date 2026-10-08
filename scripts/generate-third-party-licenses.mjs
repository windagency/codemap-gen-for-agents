#!/usr/bin/env node
// Generates THIRD_PARTY_LICENSES.md from `pnpm licenses list --prod --json` plus each
// package's own licence file (read from node_modules, never hand-typed) so the doc can never
// drift from what's actually installed. Run `node scripts/generate-third-party-licenses.mjs` to
// write it, or `--check` (what CI runs) to fail without writing if the committed file is stale.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(ROOT, "THIRD_PARTY_LICENSES.md");
const CHECK = process.argv.includes("--check");

// SPDX ids with no copyleft or "contact the author" obligations. Anything outside this list
// fails the generator instead of silently shipping an unreviewed licence into the doc.
const PERMISSIVE_ALLOWLIST = new Set([
	"0BSD",
	"(Apache-2.0 AND BSD-3-Clause)", // @bufbuild/protobuf: both parts are allowlisted on their own
	"Apache-2.0",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"BlueOak-1.0.0",
	"CC0-1.0",
	"ISC",
	"MIT",
	"MIT-0",
	"Python-2.0",
	"Unlicense",
]);

const LICENSE_FILENAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "LICENCE.txt", "License"];

// For a package whose npm tarball ships no licence file at all. Each vendored file is copied, not
// typed: @bufbuild/protobuf's is the upstream repo's LICENSE at tag v2.16.0, followed by the
// Google BSD-3-Clause header the package itself carries in `dist/esm/wire/varint.js`.
const VENDORED_LICENSE_FILES = {
	"@bufbuild/protobuf": join(ROOT, "scripts", "vendored-licenses", "@bufbuild__protobuf.LICENSE"),
};

function readLicenseFile(packageDir, packageName) {
	const entries = readdirSync(packageDir);
	const match = LICENSE_FILENAMES.find((name) => entries.includes(name));
	if (!match) {
		const vendored = VENDORED_LICENSE_FILES[packageName];
		if (vendored) return readFileSync(vendored, "utf8").replace(/\r\n/g, "\n").trimEnd();
		throw new Error(`No LICENSE file found in ${packageDir}`);
	}
	// Some packages ship CRLF licence files (typescript, json-schema-typed). .gitattributes commits
	// THIRD_PARTY_LICENSES.md as LF, so copying CRLF verbatim makes --check fail on every fresh checkout.
	return readFileSync(join(packageDir, match), "utf8").replace(/\r\n/g, "\n").trimEnd();
}

// A representative package's LICENSE file still carries *that* package's own copyright line(s) -
// fine when it's the only package under that SPDX id (reproduced verbatim), wrong when it's
// standing in for a whole group (the boilerplate after the anchor is standardised by the licence
// itself; the preamble above it is not, and must not be presented as if it applied to every
// package in the group). For a group, cut the file at its first standard clause and prepend a
// generic placeholder instead of the one representative's actual copyright line.
const GENERIC_ANCHORS = {
	// Keys are SPDX licence identifiers, not variable names, so camelCase doesn't apply - two of
	// them aren't even valid bare JS identifiers (the hyphen).
	// biome-ignore lint/style/useNamingConvention: SPDX licence identifier
	MIT: {
		anchor: "Permission is hereby granted",
		header: "MIT License\n\nCopyright (c) <year> <copyright holder>\n\n",
	},
	// biome-ignore lint/style/useNamingConvention: SPDX licence identifier
	ISC: {
		anchor: "Permission to use,",
		header: "Copyright (c) <copyright holder>\n\n",
	},
	"BSD-2-Clause": {
		anchor: "Redistribution and use in source",
		header: "Copyright (c) <year> <copyright holder>\nAll rights reserved.\n\n",
	},
	"BSD-3-Clause": {
		anchor: "Redistribution and use in source",
		header: "Copyright (c) <year> <copyright holder>\nAll rights reserved.\n\n",
	},
};

function genericize(text, license) {
	const rule = GENERIC_ANCHORS[license];
	if (!rule) return text;
	const index = text.indexOf(rule.anchor);
	if (index === -1) return text;
	return rule.header + text.slice(index);
}

function escapeCell(value) {
	return value.replaceAll("|", "\\|");
}

function toTable(rows) {
	const header = "| Package | Version | License | Copyright |\n| --- | --- | --- | --- |";
	const body = rows
		.map(
			(r) =>
				`| ${escapeCell(r.name)} | ${escapeCell(r.versions.join(","))} | ${r.license} | ${escapeCell(r.author || "-")} |`,
		)
		.join("\n");
	return `${header}\n${body}`;
}

const raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
	cwd: ROOT,
	encoding: "utf8",
});
const grouped = JSON.parse(raw);

const packages = [];
for (const [license, entries] of Object.entries(grouped)) {
	for (const entry of entries) {
		packages.push({
			name: entry.name,
			versions: entry.versions,
			license,
			author: entry.author,
			path: entry.paths[0],
		});
	}
}
packages.sort((a, b) => a.license.localeCompare(b.license) || a.name.localeCompare(b.name));

const unknownLicenses = [...new Set(packages.map((p) => p.license))].filter((l) => !PERMISSIVE_ALLOWLIST.has(l));
if (unknownLicenses.length > 0) {
	console.error(
		`Found non-allowlisted license(s) in the production dependency tree: ${unknownLicenses.join(", ")}\n` +
			"Review the package(s) under this license by hand, then add the SPDX id to " +
			"PERMISSIVE_ALLOWLIST in scripts/generate-third-party-licenses.mjs once reviewed.",
	);
	process.exit(1);
}

const { dependencies = {} } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const directNames = new Set(Object.keys(dependencies));
const directRows = packages.filter((p) => directNames.has(p.name));

const licenseGroups = new Map();
for (const p of packages) {
	if (!licenseGroups.has(p.license)) licenseGroups.set(p.license, []);
	licenseGroups.get(p.license).push(p);
}

const NAME_LIST_THRESHOLD = 6;
const appendixSections = [...licenseGroups.entries()]
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([license, entries]) => {
		const names = entries.map((e) => e.name).sort();
		const rawText = readLicenseFile(entries[0].path, entries[0].name);
		const appliesTo =
			names.length === 1
				? `Applies to: ${names[0]}. Reproduced verbatim from the package's own license file, copyright line included.`
				: names.length <= NAME_LIST_THRESHOLD
					? `Applies to: ${names.join(", ")}, with the copyright line(s) from the table above substituted per package.`
					: `Applies to all ${names.length} ${license} packages in the table above, with the copyright line(s) from the table above substituted per package.`;
		const text = names.length === 1 ? rawText : genericize(rawText, license);
		return `### ${license}\n\n${appliesTo}\n\n\`\`\`\n${text}\n\`\`\``;
	})
	.join("\n\n");

const content = `# Third-party licenses

[Back to README.md](README.md) • [Back to AGENTS.md](AGENTS.md) • [Back to 0045-discovery-follows-the-root-gitignore.md](documentation/adr/0045-discovery-follows-the-root-gitignore.md) • [Back to TESTING.md](documentation/TESTING.md)

This file lists the licenses of every package in this project's **production** dependency tree - the packages that ship inside \`dist/\` and the published npm package, including transitive dependencies pulled in by direct ones. \`devDependencies\` (Biome, Vitest, TypeScript's own toolchain outside the \`typescript\` package itself, etc.) are not listed here: they are used to build and test this project but are never distributed with it.

This file is generated - do not hand-edit it. Regenerate it with:

\`\`\`bash
node scripts/generate-third-party-licenses.mjs
\`\`\`

CI runs the same script with \`--check\` and fails the build if this file is stale, or if a production dependency's license isn't on the generator's permissive allowlist - see \`.github/workflows/ci.yml\`.

All ${packages.length} packages in the production tree use a permissive license (${[...licenseGroups.keys()].sort().join(", ")}). None introduce copyleft obligations.

## Direct dependencies

The packages this project's own \`package.json\` depends on directly.

${toTable(directRows)}

## Full production dependency tree

Every package resolved into the production tree (direct and transitive), as installed by \`pnpm-lock.yaml\`. A dash in the Copyright column means the package's own metadata does not declare an author.

${toTable(packages)}

## License texts

Each permissive license's full terms require the text below plus the copyright line(s) for the specific package - see the Copyright column in the tables above for the holder that applies to each package. Where only one package in the tree uses a license, its license file is reproduced verbatim, copyright line included.

${appendixSections}
`;

if (CHECK) {
	let existing = "";
	try {
		existing = readFileSync(OUT_FILE, "utf8");
	} catch {
		// treated as empty - falls through to the mismatch branch below
	}
	if (existing !== content) {
		console.error(
			"THIRD_PARTY_LICENSES.md is stale. Run `node scripts/generate-third-party-licenses.mjs` and commit the result.",
		);
		process.exit(1);
	}
	console.log("THIRD_PARTY_LICENSES.md is up to date.");
} else {
	writeFileSync(OUT_FILE, content);
	console.log(`Wrote ${OUT_FILE}`);
}
