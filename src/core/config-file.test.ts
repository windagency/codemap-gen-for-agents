import { isConfigFile } from "src/core/config-file";
import { describe, expect, it } from "vitest";

describe("isConfigFile", () => {
	it("matches a root-level eslint.config.js", () => {
		expect(isConfigFile("eslint.config.js")).toBe(true);
	});

	it("matches a nested package's eslint.config.js", () => {
		expect(isConfigFile("packages/valora-plugin-api/eslint.config.js")).toBe(true);
	});

	it("matches other recognised tool config basenames and extensions", () => {
		expect(isConfigFile("vitest.config.ts")).toBe(true);
		expect(isConfigFile("jest.config.cjs")).toBe(true);
		expect(isConfigFile("babel.config.mjs")).toBe(true);
		expect(isConfigFile("lint-staged.config.cjs")).toBe(true);
		expect(isConfigFile("stryker.config.mjs")).toBe(true);
	});

	it("matches the .<tool>rc.<ext> dotfile convention", () => {
		expect(isConfigFile(".eslintrc.js")).toBe(true);
		expect(isConfigFile("packages/foo/.prettierrc.cjs")).toBe(true);
	});

	it("does not match a file that merely contains 'config' as a domain word", () => {
		expect(isConfigFile("src/config/providers.config.ts")).toBe(false);
		expect(isConfigFile("src/mcp/mcp-server-config.schema.ts")).toBe(false);
		expect(isConfigFile("src/core/config.ts")).toBe(false);
		expect(isConfigFile("packages/valora-plugin-obsidian/src/config.schema.ts")).toBe(false);
	});

	it("does not match a config file for an unrecognised tool", () => {
		expect(isConfigFile("some-made-up-tool.config.ts")).toBe(false);
	});

	it("does not match a non-JS/TS extension", () => {
		expect(isConfigFile("eslint.config.json")).toBe(false);
	});
});
