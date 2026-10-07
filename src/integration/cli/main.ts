#!/usr/bin/env node
import { createConsoleLogger, isHelpRequest } from "src/core/compose";
import { createCliAdapter } from "src/integration/cli/cli-adapter";
import { CLI_HELP, CLI_USAGE } from "src/integration/cli/cli-help";
import { runEntrypoint } from "src/integration/run-entrypoint";

const argv = process.argv.slice(2);
const [subcommand, ...rest] = argv;

if (isHelpRequest(argv)) {
	console.log(CLI_HELP);
	process.exit(0);
}

if (subcommand !== "generate") {
	createConsoleLogger().error(CLI_USAGE);
	process.exit(1);
}

runEntrypoint(() => createCliAdapter().generate(rest), { subcommand });
