import { CLI_HELP, CLI_USAGE } from "src/integration/cli/cli-help";
import { describe, expect, it } from "vitest";

describe("CLI_HELP", () => {
	it("starts with the usage line", () => {
		expect(CLI_HELP.startsWith(CLI_USAGE)).toBe(true);
	});

	it.each(["--root", "--out", "--config", "--force", "--include-tests", "--scip-index", "--help", "-h"])(
		"documents %s",
		(flag) => {
			expect(CLI_HELP).toContain(flag);
		},
	);
});
