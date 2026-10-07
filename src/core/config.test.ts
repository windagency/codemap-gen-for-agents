import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OUT_DIR, loadConfig, resolveAbsoluteOutDir, resolveOutDir } from "src/core/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("loadConfig", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-config-"));
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("returns built-in defaults when no config file is present", () => {
		const config = loadConfig(rootDir);

		expect(config.outDir).toBe(DEFAULT_OUT_DIR);
		expect(config.exclude).toStrictEqual([
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/coverage/**",
			"**/target/**",
			"**/vendor/**",
			"**/.stryker-tmp/**",
			"**/.pnpm-store/**",
		]);
	});

	it("merges a present config file's outDir/exclude with the defaults, layering exclude on top", () => {
		fs.writeFileSync(
			path.join(rootDir, "codemap.config.json"),
			JSON.stringify({ outDir: "out", exclude: ["**/generated/**"] }),
		);

		const config = loadConfig(rootDir);

		expect(config.outDir).toBe("out");
		expect(config.exclude).toStrictEqual([
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/coverage/**",
			"**/target/**",
			"**/vendor/**",
			"**/.stryker-tmp/**",
			"**/.pnpm-store/**",
			"**/generated/**",
		]);
	});

	it("uses an explicit config path verbatim, with no fallback to <rootDir>/codemap.config.json", () => {
		fs.writeFileSync(path.join(rootDir, "codemap.config.json"), JSON.stringify({ outDir: "ignored-default-location" }));
		const explicitDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-config-explicit-"));
		const explicitPath = path.join(explicitDir, "custom.json");
		fs.writeFileSync(explicitPath, JSON.stringify({ outDir: "explicit-out" }));

		const config = loadConfig(rootDir, explicitPath);

		expect(config.outDir).toBe("explicit-out");
		fs.rmSync(explicitDir, { recursive: true, force: true });
	});

	it("does not walk upward looking for a config file when none exists at rootDir", () => {
		const nested = path.join(rootDir, "nested");
		fs.mkdirSync(nested);
		fs.writeFileSync(path.join(rootDir, "codemap.config.json"), JSON.stringify({ outDir: "should-not-be-found" }));

		const config = loadConfig(nested);

		expect(config.outDir).toBe(DEFAULT_OUT_DIR);
	});

	it("throws a clear error when the config file's shape fails validation", () => {
		fs.writeFileSync(path.join(rootDir, "codemap.config.json"), JSON.stringify({ outDir: 123 }));

		expect(() => loadConfig(rootDir)).toThrow(/outDir/);
	});

	it("throws a clear error on an unknown top-level field", () => {
		fs.writeFileSync(path.join(rootDir, "codemap.config.json"), JSON.stringify({ rootDir: "/should-not-exist-here" }));

		expect(() => loadConfig(rootDir)).toThrow();
	});
});

describe("resolveOutDir", () => {
	it("prefers an explicit caller value over the config file's value", () => {
		expect(resolveOutDir("explicit", { outDir: "configured" })).toBe("explicit");
	});

	it("falls back to the config file's value when no explicit value is given", () => {
		expect(resolveOutDir(undefined, { outDir: "configured" })).toBe("configured");
	});

	it("falls back to the built-in default when neither an explicit value nor a config value is given", () => {
		expect(resolveOutDir(undefined, {})).toBe(DEFAULT_OUT_DIR);
	});
});

describe("resolveAbsoluteOutDir", () => {
	it("anchors a relative outDir to rootDir, not to the process's cwd", () => {
		expect(resolveAbsoluteOutDir("/repo", undefined, { outDir: "out" })).toBe(path.join("/repo", "out"));
	});

	it("leaves an already-absolute outDir untouched", () => {
		expect(resolveAbsoluteOutDir("/repo", "/elsewhere/out", {})).toBe("/elsewhere/out");
	});
});
