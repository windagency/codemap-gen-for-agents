import { extractStringArrayField } from "src/core/toml-section";
import { describe, expect, it } from "vitest";

describe("extractStringArrayField", () => {
	it("reads a single-line string array", () => {
		const section = 'name = "widget"\ndependencies = ["requests", "click"]\n';
		expect(extractStringArrayField(section, "dependencies")).toStrictEqual(["requests", "click"]);
	});

	it("reads a multi-line string array", () => {
		const section = ['name = "widget"', "dependencies = [", '    "requests>=2.28.0",', '    "click==8.1.3",', "]"].join(
			"\n",
		);
		expect(extractStringArrayField(section, "dependencies")).toStrictEqual(["requests>=2.28.0", "click==8.1.3"]);
	});

	it("returns an empty array when the field is absent", () => {
		expect(extractStringArrayField('name = "widget"', "dependencies")).toStrictEqual([]);
	});

	it("returns an empty array for a declared-but-empty array", () => {
		expect(extractStringArrayField("dependencies = []", "dependencies")).toStrictEqual([]);
	});
});
