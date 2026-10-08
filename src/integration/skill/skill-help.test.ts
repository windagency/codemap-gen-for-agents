import { SKILL_HELP, SKILL_USAGE } from "src/integration/skill/skill-help";
import { describe, expect, it } from "vitest";

describe("SKILL_HELP", () => {
	it("starts with the usage line", () => {
		expect(SKILL_HELP.startsWith(SKILL_USAGE)).toBe(true);
	});

	it.each([
		"generate",
		"read",
		"--root",
		"--out",
		"--config",
		"--force",
		"--include-tests",
		"--scip-index",
		"--path",
		"--symbol-kind",
		"--search",
		"--help",
		"-h",
	])("documents %s", (token) => {
		expect(SKILL_HELP).toContain(token);
	});
});
