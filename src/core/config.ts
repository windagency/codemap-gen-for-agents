import fs from "node:fs";
import path from "node:path";
import { type CodemapConfig, parseCodemapConfig } from "src/core/config-schema";

export interface ResolvedCodemapConfig {
	outDir: string;
	exclude: string[];
}

export const DEFAULT_OUT_DIR = ".codemap";

// Always applied, with the config file's own `exclude` layered on top (never replacing it).
const DEFAULT_EXCLUDE: readonly string[] = [
	"**/node_modules/**",
	"**/dist/**",
	"**/build/**",
	"**/coverage/**",
	"**/target/**", // Rust cargo / Java Maven build output
	"**/vendor/**", // Go vendored dependencies
	"**/.stryker-tmp/**", // Stryker mutation-testing sandbox - a full copy of the project per run
	"**/.pnpm-store/**", // pnpm's local content-addressable package store
];

// `codemap.config.json` is user-authored, external input (`CONTRIBUTING.md`'s "all external
// input validated with Zod before use") - a malformed file surfaces a clear validation error
// rather than silently misapplying a wrong shape.
function readConfigFile(configPath: string): CodemapConfig {
	if (!fs.existsSync(configPath)) return {};

	const raw: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
	return parseCodemapConfig(raw, configPath);
}

// Flat, non-walking lookup (documentation/adr/0004-public-interface-contract.md): `<rootDir>/codemap.config.json`,
// or `explicitConfigPath` verbatim if given - no upward directory search, no user/global fallback.
// A missing file (default or explicit path) degrades to built-in defaults rather than throwing.
export function loadConfig(rootDir: string, explicitConfigPath?: string): ResolvedCodemapConfig {
	const configPath = explicitConfigPath ?? path.join(rootDir, "codemap.config.json");
	const fileConfig = readConfigFile(configPath);

	return {
		outDir: fileConfig.outDir ?? DEFAULT_OUT_DIR,
		exclude: [...DEFAULT_EXCLUDE, ...(fileConfig.exclude ?? [])],
	};
}

// Reusable by both the CLI and MCP callers: an explicit caller-supplied value (a `--out` flag,
// an `outDir` tool param) always wins over the config file's value for the same setting.
export function resolveOutDir(explicitOutDir: string | undefined, config: Pick<CodemapConfig, "outDir">): string {
	return explicitOutDir ?? config.outDir ?? DEFAULT_OUT_DIR;
}

// Shared by `generate-command.ts`/`read-command.ts` (both resolve `outDir` from the same three
// inputs the same way) - a relative outDir is always anchored to `rootDir`, never to whatever
// directory the process happens to be started from.
export function resolveAbsoluteOutDir(
	rootDir: string,
	explicitOutDir: string | undefined,
	config: Pick<CodemapConfig, "outDir">,
): string {
	const outDir = resolveOutDir(explicitOutDir, config);
	return path.isAbsolute(outDir) ? outDir : path.join(rootDir, outDir);
}
