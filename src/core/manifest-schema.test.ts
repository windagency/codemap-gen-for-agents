import {
	parseDeclaredDependencies,
	parseInstalledPackageJson,
	parsePackageJsonName,
	validGoRequires,
	validJavaDependencies,
	validPythonDependencies,
	validRustDependencies,
} from "src/core/manifest-schema";
import { describe, expect, it } from "vitest";

describe("package.json schemas", () => {
	it.each([null, "string", { name: "" }, { name: "  " }, { name: 42 }])(
		"rejects %j as a package name manifest",
		(raw) => {
			expect(parsePackageJsonName(raw)).toBeUndefined();
		},
	);

	it("rejects an installed manifest missing its version", () => {
		expect(parseInstalledPackageJson({ name: "lodash" })).toBeUndefined();
	});

	it("drops one malformed dependency field without hiding the others", () => {
		expect(
			parseDeclaredDependencies({
				dependencies: { lodash: 4 },
				devDependencies: { vitest: "^5.0.0" },
			}),
		).toStrictEqual({ vitest: "^5.0.0" });
	});

	it("lets `dependencies` win over `devDependencies` for the same name", () => {
		expect(
			parseDeclaredDependencies({
				dependencies: { a: "1.0.0" },
				devDependencies: { a: "2.0.0" },
			}),
		).toStrictEqual({ a: "1.0.0" });
	});
});

describe("regex-read manifest records", () => {
	it("keeps a well-formed go require and drops one without a v-prefixed version", () => {
		expect(
			validGoRequires([
				{ modulePath: "github.com/a/b", version: "v1.2.3" },
				{ modulePath: "github.com/a/c", version: "1.2.3" },
			]),
		).toStrictEqual([{ modulePath: "github.com/a/b", version: "v1.2.3" }]);
	});

	it("drops a Rust dependency whose name holds injected markup", () => {
		expect(validRustDependencies([{ name: "serde<x>", externCrateName: "serde", version: "1.0" }])).toStrictEqual([]);
	});

	it("drops a Java dependency with whitespace in a coordinate", () => {
		expect(validJavaDependencies([{ groupId: "org.x y", artifactId: "a", version: "1" }])).toStrictEqual([]);
	});

	it("drops undefined and empty-version Python requirements", () => {
		expect(
			validPythonDependencies([undefined, { name: "requests", version: "" }, { name: "flask", version: ">=3.0" }]),
		).toStrictEqual([{ name: "flask", version: ">=3.0" }]);
	});
});
