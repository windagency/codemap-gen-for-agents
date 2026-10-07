#!/usr/bin/env node
import { createConsoleLogger, isHelpRequest } from "src/core/compose";
import { runEntrypoint } from "src/integration/run-entrypoint";
import { createSkillAdapter } from "src/integration/skill/skill-adapter";
import { SKILL_HELP, SKILL_USAGE } from "src/integration/skill/skill-help";

const argv = process.argv.slice(2);
const [subcommand, ...rest] = argv;

if (isHelpRequest(argv)) {
	console.log(SKILL_HELP);
	process.exit(0);
}

const adapter = createSkillAdapter();

if (subcommand !== "generate" && subcommand !== "read") {
	createConsoleLogger().error(SKILL_USAGE);
	process.exit(1);
}

runEntrypoint(() => (subcommand === "generate" ? adapter.generate(rest) : adapter.read(rest)), { subcommand });
