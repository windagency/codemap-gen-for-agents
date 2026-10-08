import { parseGenerateFlags, parseReadFlags, type RawFlags, REPEATABLE_FLAGS } from "src/core/cli-args-schema";
import type { GenerateCommandInput } from "src/core/generate-command";
import type { ReadCommandInput } from "src/core/read-command";

// Shared argv-parsing for the `generate`/`read` subcommands - lives in `core/` (not either
// integration adapter) so the CLI and the Skill's companion script parse identical flags from one
// implementation instead of two that could drift apart.

function isFlag(arg: string | undefined): boolean {
	return arg?.startsWith("--") ?? false;
}

// Pairs each `--flag` with the argument after it, or `true` when the next argument is another
// flag or missing. A repeatable flag collects its values into a list. Which flags exist, and
// which take a value, is the schema's job.
function addFlag(flags: RawFlags, arg: string, value: string | true): void {
	const previous = flags[arg];
	if (REPEATABLE_FLAGS.has(arg) && value !== true) {
		flags[arg] = [...(Array.isArray(previous) ? previous : []), value];
	} else {
		flags[arg] = value;
	}
}

function collectFlags(argv: string[]): RawFlags {
	const flags: RawFlags = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] ?? "";
		if (!isFlag(arg)) {
			throw new Error(`Unexpected argument ${JSON.stringify(arg)}`);
		}
		const next = argv[i + 1];
		const value = next !== undefined && !isFlag(next) ? next : true;
		if (value !== true) i++;
		addFlag(flags, arg, value);
	}
	return flags;
}

// Checked before any other argv parsing, so help wins over a missing subcommand or a bad flag.
export function isHelpRequest(argv: string[]): boolean {
	return argv.some((arg) => arg === "--help" || arg === "-h");
}

export function parseGenerateArgs(argv: string[]): GenerateCommandInput {
	const flags = parseGenerateFlags(collectFlags(argv));
	return {
		rootDir: flags["--root"],
		outDir: flags["--out"],
		configPath: flags["--config"],
		force: flags["--force"] ?? false,
		includeTests: flags["--include-tests"] ?? false,
		...(flags["--scip-index"] ? { scipIndexes: flags["--scip-index"] } : {}),
	};
}

export function parseReadArgs(argv: string[]): ReadCommandInput {
	const flags = parseReadFlags(collectFlags(argv));
	return {
		rootDir: flags["--root"],
		outDir: flags["--out"],
		configPath: flags["--config"],
		path: flags["--path"],
		symbolKind: flags["--symbol-kind"],
		search: flags["--search"],
		includeTests: flags["--include-tests"] ?? false,
		...(flags["--scip-index"] ? { scipIndexes: flags["--scip-index"] } : {}),
	};
}
