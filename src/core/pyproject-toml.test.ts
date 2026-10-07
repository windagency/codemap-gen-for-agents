import { readPyprojectManifest } from "src/core/pyproject-toml";
import { describe, expect, it } from "vitest";

describe("readPyprojectManifest", () => {
	it("reads a project's declared name from its [project] table", () => {
		const content = '[project]\nname = "widget-core"\nversion = "0.1.0"\n';
		expect(readPyprojectManifest(content)).toStrictEqual({
			name: "widget-core",
		});
	});

	it("returns undefined for a Poetry-only manifest with no [project] table", () => {
		const content = '[tool.poetry]\nname = "widget-core"\nversion = "0.1.0"\n';
		expect(readPyprojectManifest(content)).toBeUndefined();
	});

	it("still reports a package root when [project] exists but name is unreadable", () => {
		const content = '[project]\nversion = "0.1.0"\n';
		expect(readPyprojectManifest(content)).toStrictEqual({ name: undefined });
	});

	it("reads the [project] table regardless of a following [build-system] table", () => {
		const content = '[project]\nname = "root-project"\n\n[build-system]\nrequires = ["setuptools"]\n';
		expect(readPyprojectManifest(content)).toStrictEqual({
			name: "root-project",
		});
	});
});
