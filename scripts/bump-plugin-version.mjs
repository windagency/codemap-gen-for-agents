#!/usr/bin/env node
// Writes a release version into the Claude Code plugin: `version` in plugin.json and the exact package
// version its .mcp.json launches through npx. Run by @semantic-release/exec's prepareCmd, so the release
// commit carries the new pin. Replaces text in place rather than re-serializing, to keep Biome's layout.
// Usage: `node scripts/bump-plugin-version.mjs <version>`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "codemap");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
	console.error("usage: node scripts/bump-plugin-version.mjs <version>");
	process.exit(2);
}

const replaceOnce = (file, pattern, replacement) => {
	const path = join(PLUGIN_DIR, file);
	const text = readFileSync(path, "utf8");
	if (text.match(new RegExp(pattern.source, "g"))?.length !== 1) {
		console.error(`${file}: expected exactly one match for ${pattern}`);
		process.exit(1);
	}
	writeFileSync(path, text.replace(pattern, replacement));
};

replaceOnce(".claude-plugin/plugin.json", /"version": "[^"]+"/, `"version": "${version}"`);
replaceOnce(
	".mcp.json",
	/@windagency\/codemap-gen-for-agents@[^"]+"/,
	`@windagency/codemap-gen-for-agents@${version}"`,
);
console.log(`Plugin pinned to ${version}.`);
