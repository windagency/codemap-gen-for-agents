import { readCargoManifest } from "src/core/cargo-toml";
import { describe, expect, it } from "vitest";

describe("readCargoManifest", () => {
	it("reads a crate's declared name from its [package] table", () => {
		const content = `[package]\nname = "widget-core"\nversion = "0.1.0"\nedition = "2021"\n`;
		expect(readCargoManifest(content)).toStrictEqual({ name: "widget-core" });
	});

	it("returns undefined for a pure virtual workspace manifest with no [package] table", () => {
		const content = `[workspace]\nmembers = ["crates/*"]\n`;
		expect(readCargoManifest(content)).toBeUndefined();
	});

	it("still reports a package root when [package] exists but name is unreadable", () => {
		const content = `[package]\nversion = "0.1.0"\n`;
		expect(readCargoManifest(content)).toStrictEqual({ name: undefined });
	});

	it("reads the [package] table regardless of a following [workspace] table", () => {
		const content = `[package]\nname = "root-crate"\n\n[workspace]\nmembers = ["crates/*"]\n`;
		expect(readCargoManifest(content)).toStrictEqual({ name: "root-crate" });
	});
});
