import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiscoveredStructure, ExtractedSymbols, RawSymbol } from "src/core/types";
import { TsCompilerApiParser } from "src/extraction/ts-compiler-api/ts-compiler-api-parser";
import { DefaultGraphBuilder } from "src/graph-building/default/default-graph-builder";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let rootDir: string;

beforeEach(() => {
	// Realpathed up front: the compiler API resolves every path (including `rootDir` itself when
	// it's behind a symlink, as macOS's `/var` -> `/private/var` tmpdir is) to its real location, so
	// tests comparing against `rootDir` need the same canonical form.
	rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codemap-parser-")));
});

afterEach(() => {
	fs.rmSync(rootDir, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string): string {
	const filePath = path.join(rootDir, relPath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
	return filePath;
}

function writeJson(relPath: string, value: unknown): void {
	writeFile(relPath, JSON.stringify(value));
}

// Extracts every listed file (whole-program) and returns the result keyed by relative path,
// for tests that need to inspect more than one file's `ExtractedSymbols` at once. Matched by
// `extracted.filePath` rather than input index/position, since a syntactically-broken file now
// produces no entry at all - the result array is no longer guaranteed to be the same length,
// or in the same order, as `relPaths`.
function parseFiles(relPaths: string[]): Map<string, ExtractedSymbols> {
	const entries = relPaths.map((relPath) => ({
		relPath,
		absolutePath: path.join(rootDir, relPath),
	}));
	const results = new TsCompilerApiParser().parse(
		rootDir,
		entries.map((entry) => entry.absolutePath),
		entries.map((entry) => entry.absolutePath),
	);
	const relPathByAbsolute = new Map(entries.map((entry) => [entry.absolutePath, entry.relPath]));
	const byRelPath = new Map<string, ExtractedSymbols>();
	for (const extracted of results) {
		const relPath = relPathByAbsolute.get(extracted.filePath);
		if (relPath) byRelPath.set(relPath, extracted);
	}
	return byRelPath;
}

function mustGet(byRelPath: Map<string, ExtractedSymbols>, relPath: string): ExtractedSymbols {
	const extracted = byRelPath.get(relPath);
	if (!extracted) throw new Error(`No parsed result for ${relPath}`);
	return extracted;
}

function parseSnippet(source: string): RawSymbol[] {
	const filePath = path.join(rootDir, "snippet.ts");
	fs.writeFileSync(filePath, source);

	const [extracted] = new TsCompilerApiParser().parse(rootDir, [filePath], [filePath]);
	if (!extracted) throw new Error("Parser produced no ExtractedSymbols");

	expect(extracted.filePath).toBe(filePath);
	expect(extracted.imports).toStrictEqual([]);
	expect(extracted.calls).toStrictEqual([]);

	return extracted.symbols;
}

describe("TsCompilerApiParser", () => {
	it("returns nothing when there are no files to extract", () => {
		expect(new TsCompilerApiParser().parse(rootDir, [], [])).toStrictEqual([]);
	});

	describe("symbolKind classification", () => {
		it("classifies a function declaration as function", () => {
			const symbols = parseSnippet("export function greet() {}");

			expect(symbols).toStrictEqual([
				{
					localId: "greet",
					name: "greet",
					symbolKind: "function",
					startLine: 1,
					endLine: 1,
					exported: true,
				},
			]);
		});

		it("classifies a const bound to an arrow/function-expression value as function", () => {
			const symbols = parseSnippet(
				["export const add = (a: number, b: number) => a + b;", "export const wrapped = function () {};"].join("\n"),
			);

			expect(symbols.map((s) => s.symbolKind)).toStrictEqual(["function", "function"]);
		});

		it("classifies a non-function const as const, and never extracts let/var", () => {
			const symbols = parseSnippet(["export const PI = 3.14;", "let mutable = 1;", "var alsoMutable = 2;"].join("\n"));

			expect(symbols).toStrictEqual([
				{
					localId: "PI",
					name: "PI",
					symbolKind: "const",
					startLine: 1,
					endLine: 1,
					exported: true,
				},
			]);
		});

		it("classifies class/interface/type/enum declarations", () => {
			const symbols = parseSnippet(
				[
					"export class Widget {}",
					"export interface Shape { id: string }",
					"export type Id = string;",
					"export enum Color { Red, Green }",
				].join("\n"),
			);

			expect(symbols.map((s) => ({ name: s.name, kind: s.symbolKind }))).toStrictEqual([
				{ name: "Widget", kind: "class" },
				{ name: "Shape", kind: "interface" },
				{ name: "Id", kind: "type" },
				{ name: "Color", kind: "enum" },
			]);
		});

		it("classifies a direct class-member method as method, exporting per its class", () => {
			const symbols = parseSnippet(
				[
					"export class Widget {",
					"  count = 0;",
					"  increment(): void { this.count++; }",
					"  private helper() {}",
					"}",
				].join("\n"),
			);

			expect(symbols.map((s) => ({ name: s.name, kind: s.symbolKind }))).toStrictEqual([
				{ name: "Widget", kind: "class" },
				{ name: "increment", kind: "method" },
				{ name: "helper", kind: "method" },
			]);
			expect(symbols.every((s) => s.exported)).toBe(true);
		});
	});

	describe("nesting-depth boundary", () => {
		it("never extracts a function-body-local declaration", () => {
			const symbols = parseSnippet(
				[
					"export function outer() {",
					"  function innerHelper() {}",
					"  const innerConst = () => {};",
					"  [1, 2, 3].map(function callback() {});",
					"  return innerHelper;",
					"}",
				].join("\n"),
			);

			expect(symbols.map((s) => s.name)).toStrictEqual(["outer"]);
		});
	});

	describe("duplicate/overload-name suffixing", () => {
		it("suffixes TS function-overload signatures in source order, implementation included", () => {
			const symbols = parseSnippet(
				[
					"export function greet(x: number): string;",
					"export function greet(x: string): string;",
					"export function greet(x: unknown): string {",
					"  return String(x);",
					"}",
				].join("\n"),
			);

			expect(symbols.map((s) => s.localId)).toStrictEqual(["greet", "greet#2", "greet#3"]);
		});

		it("suffixes a declaration-merging collision (interface Foo + function Foo)", () => {
			const symbols = parseSnippet(["export interface Foo { id: string }", "export function Foo() {}"].join("\n"));

			expect(symbols.map((s) => ({ localId: s.localId, name: s.name }))).toStrictEqual([
				{ localId: "Foo", name: "Foo" },
				{ localId: "Foo#2", name: "Foo" },
			]);
		});
	});
});

describe("TsCompilerApiParser import & re-export resolution", () => {
	it("resolves a relative import to the target's absolute file path", () => {
		writeFile("target.ts", "export function helper() {}");
		const mainPath = writeFile("main.ts", 'import { helper } from "./target";');

		const main = mustGet(parseFiles(["target.ts", "main.ts"]), "main.ts");

		expect(main.imports).toStrictEqual([
			{
				specifier: "./target",
				viaReExport: false,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "target.ts"),
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
		expect(mainPath).toBe(path.join(rootDir, "main.ts"));
	});

	it("produces no edge (silently) for an unresolved specifier", () => {
		writeFile("main.ts", 'import { nope } from "./does-not-exist";');

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		expect(main.imports).toStrictEqual([
			{
				specifier: "./does-not-exist",
				viaReExport: false,
				resolvedTarget: { kind: "unresolved" },
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	it("classifies an installed node_modules dependency as External with its real installed version", () => {
		writeJson("node_modules/left-pad/package.json", {
			name: "left-pad",
			version: "9.9.9",
		});
		writeFile("node_modules/left-pad/index.d.ts", "export declare function leftPad(s: string): string;");
		writeFile("main.ts", 'import { leftPad } from "left-pad";');

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		expect(main.imports).toStrictEqual([
			{
				specifier: "left-pad",
				viaReExport: false,
				resolvedTarget: {
					kind: "external",
					packageName: "left-pad",
					version: "9.9.9",
					language: "typescript",
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	it("treats a missing/malformed package.json for an External import exactly like unresolved", () => {
		// node_modules/broken has no package.json at all.
		writeFile("node_modules/broken/index.d.ts", "export declare const x: number;");
		writeFile("main.ts", 'import { x } from "broken";');

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		expect(main.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "unresolved",
		});
	});

	it("falls back to the nearest package.json's declared version when a dependency is declared but never installed (no node_modules at all)", () => {
		// No node_modules anywhere - a repo whose dependencies were declared but `npm install` was
		// never run. Go/Rust/Java/Python's own manifest-only External resolution already tolerates
		// this; TS/JS should too, rather than silently producing no External node and no warning.
		writeJson("package.json", {
			name: "root-project",
			dependencies: { "human-signals": "^5.0.0" },
		});
		writeFile("main.ts", 'import signals from "human-signals";');

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		expect(main.imports).toStrictEqual([
			{
				specifier: "human-signals",
				viaReExport: false,
				resolvedTarget: {
					kind: "external",
					packageName: "human-signals",
					version: "^5.0.0",
					language: "typescript",
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	function declaredOnlyTarget(dependencies: Record<string, string>, specifier: string) {
		writeJson("package.json", { name: "root-project", dependencies });
		writeFile("main.ts", `import x from "${specifier}";`);
		const main = mustGet(parseFiles(["main.ts"]), "main.ts");
		return main.imports[0]?.resolvedTarget;
	}

	it("names a declared-only npm: alias after the real upstream package (ADR-0024)", () => {
		expect(declaredOnlyTarget({ foo: "npm:bar@^1.2.0" }, "foo")).toStrictEqual({
			kind: "external",
			packageName: "bar",
			version: "^1.2.0",
			language: "typescript",
		});
	});

	it("names a declared-only scoped npm: alias after the real scoped package", () => {
		expect(declaredOnlyTarget({ foo: "npm:@scope/bar@2.0.0" }, "foo")).toStrictEqual({
			kind: "external",
			packageName: "@scope/bar",
			version: "2.0.0",
			language: "typescript",
		});
	});

	it.each([
		"workspace:*",
		"file:../lib",
		"link:../lib",
		"git+https://github.com/o/r.git",
		"github:o/r",
		"o/r",
		"https://example.com/r.tgz",
		"npm:bar",
	])("leaves a declared-only %s dependency unresolved, since it names no registry version", (spec) => {
		expect(declaredOnlyTarget({ dep: spec }, "dep")).toStrictEqual({
			kind: "unresolved",
		});
	});

	it("never reads a package.json above the repo root", () => {
		const repo = path.join(rootDir, "repo");
		writeJson("package.json", {
			name: "outside",
			dependencies: { leaked: "^1.0.0" },
		});
		writeJson("repo/package.json", { name: "inside" });
		writeFile("repo/main.ts", 'import x from "leaked";');

		const results = new TsCompilerApiParser().parse(repo, [path.join(repo, "main.ts")], [path.join(repo, "main.ts")]);

		expect(results[0]?.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "unresolved",
		});
	});

	it("falls back to an ancestor package.json when the nearest one doesn't declare the dependency", () => {
		writeJson("package.json", {
			name: "root",
			devDependencies: { hoisted: "~3.1.0" },
		});
		writeJson("packages/app/package.json", { name: "app" });
		writeFile("packages/app/main.ts", 'import x from "hoisted";');

		const main = mustGet(parseFiles(["packages/app/main.ts"]), "packages/app/main.ts");

		expect(main.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "external",
			packageName: "hoisted",
			version: "~3.1.0",
			language: "typescript",
		});
	});

	it("classifies a plain CommonJS dependency with no bundled and no DefinitelyTyped declarations as External, not silently dropped", () => {
		// No .d.ts anywhere - the checker's own symbol resolution produces nothing for "untyped-lib",
		// so this only becomes an edge via the filesystem-only Node-resolution fallback.
		writeJson("node_modules/untyped-lib/package.json", {
			name: "untyped-lib",
			version: "1.2.3",
		});
		writeFile("node_modules/untyped-lib/index.js", "module.exports = 1;");
		writeFile("main.ts", 'import untyped from "untyped-lib";');

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		expect(main.imports).toStrictEqual([
			{
				specifier: "untyped-lib",
				viaReExport: false,
				resolvedTarget: {
					kind: "external",
					packageName: "untyped-lib",
					version: "1.2.3",
					language: "typescript",
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	it("classifies a DefinitelyTyped-only dependency as its real runtime package, not the @types/* shim", () => {
		// The checker resolves "typed-lib"'s specifier straight into @types/typed-lib's own .d.ts -
		// an accurate type resolution, but @types/typed-lib is never itself the actual dependency.
		writeJson("node_modules/typed-lib/package.json", {
			name: "typed-lib",
			version: "5.0.0",
		});
		writeFile("node_modules/typed-lib/index.js", "module.exports = 1;");
		writeJson("node_modules/@types/typed-lib/package.json", {
			name: "@types/typed-lib",
			version: "9.9.9",
		});
		writeFile("node_modules/@types/typed-lib/index.d.ts", "declare const typedLib: number; export default typedLib;");
		writeFile("main.ts", 'import typedLib from "typed-lib";');

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		expect(main.imports).toStrictEqual([
			{
				specifier: "typed-lib",
				viaReExport: false,
				resolvedTarget: {
					kind: "external",
					packageName: "typed-lib",
					version: "5.0.0",
					language: "typescript",
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	it("falls back to the @types/* package when a types-only dependency has no installed runtime counterpart", () => {
		writeJson("node_modules/@types/only-types/package.json", {
			name: "@types/only-types",
			version: "1.0.0",
		});
		writeFile(
			"node_modules/@types/only-types/index.d.ts",
			"declare const onlyTypes: number; export default onlyTypes;",
		);
		writeFile("main.ts", 'import onlyTypes from "only-types";');

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		expect(main.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "external",
			packageName: "@types/only-types",
			version: "1.0.0",
			language: "typescript",
		});
	});

	it("resolves a workspace package imported by name to a real File, not an External", () => {
		writeJson("package.json", { name: "fixture-root", private: true });
		writeJson("packages/pkg-b/package.json", {
			name: "@fixture/pkg-b",
			version: "2.0.0",
		});
		writeFile("packages/pkg-b/index.ts", "export function shared() {}");
		fs.mkdirSync(path.join(rootDir, "node_modules/@fixture"), {
			recursive: true,
		});
		fs.symlinkSync(path.join(rootDir, "packages/pkg-b"), path.join(rootDir, "node_modules/@fixture/pkg-b"), "dir");
		writeFile("main.ts", 'import { shared } from "@fixture/pkg-b";');

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		expect(main.imports).toStrictEqual([
			{
				specifier: "@fixture/pkg-b",
				viaReExport: false,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "packages/pkg-b/index.ts"),
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	it("resolves through a wildcard-only re-export (no entry) but keeps a named re-export as a visible hop", () => {
		writeFile("inner.ts", ["export function wildcarded() {}", "export function named() {}"].join("\n"));
		writeFile("barrel.ts", ['export * from "./inner";', 'export { named } from "./inner";'].join("\n"));

		const barrel = mustGet(parseFiles(["inner.ts", "barrel.ts"]), "barrel.ts");

		expect(barrel.imports).toStrictEqual([
			{
				specifier: "./inner",
				viaReExport: true,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "inner.ts"),
				},
				locations: [{ startLine: 2, endLine: 2 }],
			},
		]);
	});

	it("reads only the root tsconfig.json, never a package's own", () => {
		// Only the root config declares the `@root/*` path alias; pkg-a's own tsconfig.json (present,
		// but expected to be entirely ignored) declares no `paths` at all. An import resolving through
		// the alias can only mean the root project - never pkg-a's own - governed this file.
		writeJson("tsconfig.json", {
			compilerOptions: {
				baseUrl: ".",
				paths: { "@root/*": ["packages/pkg-a/*"] },
			},
		});
		writeJson("packages/pkg-a/tsconfig.json", { compilerOptions: {} });
		writeFile("packages/pkg-a/util.ts", "export function util() {}");
		writeFile("packages/pkg-a/main.ts", 'import { util } from "@root/util";');

		const main = mustGet(parseFiles(["packages/pkg-a/util.ts", "packages/pkg-a/main.ts"]), "packages/pkg-a/main.ts");

		expect(main.imports).toStrictEqual([
			{
				specifier: "@root/util",
				viaReExport: false,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "packages/pkg-a/util.ts"),
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	// No `tsconfig.json` exists anywhere under `rootDir` in either of these two - the plain-JS
	// fallback path (`hasRootConfig === false` in ts-compiler-api-parser.ts) where every file
	// resolves through its own `getDefaultProjectForFile`-inferred project rather than one root
	// `Project`. These two exercise exactly the pieces of that inferred project's default
	// `CompilerOptions` that change real resolution/interop outcomes (not just typechecking
	// strictness): `esModuleInterop`/CJS-default-import handling, and `moduleResolution`'s
	// package.json `exports`-map support.
	describe("plain-JS fallback (no tsconfig.json anywhere)", () => {
		it("resolves a default import of a CommonJS `module.exports` target to its file", () => {
			writeFile("bar.js", "module.exports = function bar() { return 42; };");
			writeFile("main.js", 'import bar from "./bar.js";');

			const main = mustGet(parseFiles(["bar.js", "main.js"]), "main.js");

			expect(main.imports).toStrictEqual([
				{
					specifier: "./bar.js",
					viaReExport: false,
					resolvedTarget: {
						kind: "file",
						filePath: path.join(rootDir, "bar.js"),
					},
					locations: [{ startLine: 1, endLine: 1 }],
				},
			]);
		});

		it("resolves a bare-specifier npm dependency published via an `exports`-map-only package.json (no `main`, non-`index`-named entry)", () => {
			// The entry point is neither `main` nor a package-root `index.*` - the only way anything
			// resolves this specifier at all is by actually reading the `exports` map (as
			// `moduleResolution: Bundler` does), not by falling back to `main`/implicit-`index`
			// conventions.
			writeJson("node_modules/exports-only-pkg/package.json", {
				name: "exports-only-pkg",
				version: "3.1.4",
				exports: "./lib/main.js",
			});
			writeFile("node_modules/exports-only-pkg/lib/main.d.ts", "export declare function shared(): void;");
			writeFile("node_modules/exports-only-pkg/lib/main.js", "module.exports.shared = function shared() {};");
			writeFile("main.js", 'import { shared } from "exports-only-pkg";');

			const main = mustGet(parseFiles(["main.js"]), "main.js");

			expect(main.imports).toStrictEqual([
				{
					specifier: "exports-only-pkg",
					viaReExport: false,
					resolvedTarget: {
						kind: "external",
						packageName: "exports-only-pkg",
						version: "3.1.4",
						language: "typescript",
					},
					locations: [{ startLine: 1, endLine: 1 }],
				},
			]);
		});
	});
});

describe("TsCompilerApiParser call resolution", () => {
	it("resolves a direct call to an imported function to exactly one candidate", () => {
		writeJson("tsconfig.json", {});
		writeFile("helper.ts", "export function helper() {}");
		writeFile(
			"main.ts",
			['import { helper } from "./helper";', "export function run() {", "  helper();", "}"].join("\n"),
		);

		const main = mustGet(parseFiles(["helper.ts", "main.ts"]), "main.ts");

		expect(main.calls).toStrictEqual([
			{
				callerLocalId: "run",
				candidates: [{ filePath: path.join(rootDir, "helper.ts"), localId: "helper" }],
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});

	it("resolves a call to an overloaded function's implementation, not its first bodiless signature", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"main.ts",
			[
				"export function greet(x: number): string;",
				"export function greet(x: string): string;",
				"export function greet(x: unknown): string {",
				"  return String(x);",
				"}",
				"",
				"export function bootstrap() {",
				"  return greet(1);",
				"}",
			].join("\n"),
		);

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");
		const call = main.calls.find((c) => c.callerLocalId === "bootstrap");

		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "main.ts"), localId: "greet#3" }]);
	});

	it("follows a call through an `as const` object-property alias to the aliased function", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"main.ts",
			[
				"function counterReducer(state: number, action: unknown): number {",
				"  return state;",
				"}",
				"",
				"const reducers = {",
				"  counter: counterReducer,",
				"} as const;",
				"",
				"export function bootstrap() {",
				"  return reducers.counter(0, {});",
				"}",
			].join("\n"),
		);

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");
		const call = main.calls.find((c) => c.callerLocalId === "bootstrap");

		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "main.ts"), localId: "counterReducer" }]);
	});

	it("resolves a direct method call on `this` to exactly one candidate", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"widget.ts",
			["export class Widget {", "  run() {", "    this.helper();", "  }", "  helper() {}", "}"].join("\n"),
		);

		const widget = mustGet(parseFiles(["widget.ts"]), "widget.ts");

		expect(widget.calls).toStrictEqual([
			{
				callerLocalId: "run",
				candidates: [{ filePath: path.join(rootDir, "widget.ts"), localId: "helper" }],
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});

	it("attributes a call to its innermost enclosing Symbol, not an enclosing class", () => {
		writeJson("tsconfig.json", {});
		writeFile("helper.ts", "export function helper() {}");
		writeFile(
			"widget.ts",
			['import { helper } from "./helper";', "export class Widget {", "  run() {", "    helper();", "  }", "}"].join(
				"\n",
			),
		);

		const widget = mustGet(parseFiles(["helper.ts", "widget.ts"]), "widget.ts");

		expect(widget.calls).toStrictEqual([
			{
				callerLocalId: "run",
				candidates: [{ filePath: path.join(rootDir, "helper.ts"), localId: "helper" }],
				locations: [{ startLine: 4, endLine: 4 }],
			},
		]);
	});

	it("enumerates every nominal interface implementor for an ambiguous call", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"shapes.ts",
			[
				"export interface Shape { area(): number; }",
				"export class Circle implements Shape { area() { return 1; } }",
				"export class Square implements Shape { area() { return 2; } }",
				"export class Triangle implements Shape { area() { return 3; } }",
			].join("\n"),
		);
		writeFile(
			"main.ts",
			['import type { Shape } from "./shapes";', "export function run(shape: Shape) {", "  shape.area();", "}"].join(
				"\n",
			),
		);

		const main = mustGet(parseFiles(["shapes.ts", "main.ts"]), "main.ts");

		expect(main.calls).toStrictEqual([
			{
				callerLocalId: "run",
				candidates: [
					{ filePath: path.join(rootDir, "shapes.ts"), localId: "area" },
					{ filePath: path.join(rootDir, "shapes.ts"), localId: "area#2" },
					{ filePath: path.join(rootDir, "shapes.ts"), localId: "area#3" },
				],
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});

	it("fixture: an ambiguous call with 3 implementors produces exactly 3 CallEdges end to end", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"shapes.ts",
			[
				"export interface Shape { area(): number; }",
				"export class Circle implements Shape { area() { return 1; } }",
				"export class Square implements Shape { area() { return 2; } }",
				"export class Triangle implements Shape { area() { return 3; } }",
			].join("\n"),
		);
		writeFile(
			"main.ts",
			['import type { Shape } from "./shapes";', "export function run(shape: Shape) {", "  shape.area();", "}"].join(
				"\n",
			),
		);

		const extracted = parseFiles(["shapes.ts", "main.ts"]);
		const symbols = [mustGet(extracted, "shapes.ts"), mustGet(extracted, "main.ts")];
		const structure: DiscoveredStructure = {
			programFiles: ["shapes.ts", "main.ts"],
			packages: [{ id: ".", name: "fixture", language: "typescript" }],
			directories: [],
			fileOwners: {
				"shapes.ts": { packageId: ".", directoryId: null },
				"main.ts": { packageId: ".", directoryId: null },
			},
			manifestlessFiles: [],
		};

		const graph = new DefaultGraphBuilder().build(
			symbols.map((extracted) => ({
				...extracted,
				filePath: path.basename(extracted.filePath),
				calls: extracted.calls.map((call) => ({
					...call,
					candidates: call.candidates.map((candidate) => ({
						...candidate,
						filePath: path.basename(candidate.filePath),
					})),
				})),
			})),
			structure,
		);

		const callEdges = graph.edges.filter((edge) => "type" in edge && edge.type === "call");
		expect(callEdges).toStrictEqual([
			{
				source: "main.ts#run",
				target: "shapes.ts#area",
				kind: "static",
				type: "call",
				locations: [{ startLine: 3, endLine: 3 }],
			},
			{
				source: "main.ts#run",
				target: "shapes.ts#area#2",
				kind: "static",
				type: "call",
				locations: [{ startLine: 3, endLine: 3 }],
			},
			{
				source: "main.ts#run",
				target: "shapes.ts#area#3",
				kind: "static",
				type: "call",
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});

	it("resolves an ambiguous call transitively through an interface's own extends chain", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"shapes.ts",
			[
				"export interface Named { area(): number; }",
				"export interface Shape extends Named {}",
				"export class Circle implements Shape { area() { return 1; } }",
			].join("\n"),
		);
		writeFile(
			"main.ts",
			['import type { Named } from "./shapes";', "export function run(named: Named) {", "  named.area();", "}"].join(
				"\n",
			),
		);

		const main = mustGet(parseFiles(["shapes.ts", "main.ts"]), "main.ts");

		expect(main.calls).toStrictEqual([
			{
				callerLocalId: "run",
				candidates: [{ filePath: path.join(rootDir, "shapes.ts"), localId: "area" }],
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});

	it("never registers a class's own bodiless abstract re-declaration as an implementor", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"shapes.ts",
			[
				"export interface Shape { area(): number; }",
				"export abstract class BaseShape implements Shape { abstract area(): number; }",
				"export class Circle extends BaseShape { area() { return 1; } }",
			].join("\n"),
		);
		writeFile(
			"main.ts",
			['import type { Shape } from "./shapes";', "export function run(shape: Shape) {", "  shape.area();", "}"].join(
				"\n",
			),
		);

		const main = mustGet(parseFiles(["shapes.ts", "main.ts"]), "main.ts");

		expect(main.calls).toStrictEqual([
			{
				callerLocalId: "run",
				candidates: [{ filePath: path.join(rootDir, "shapes.ts"), localId: "area#2" }],
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});

	it("enumerates candidates from a union-typed receiver's own constituents", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"animals.ts",
			["export class Cat { speak() { return 'meow'; } }", "export class Dog { speak() { return 'woof'; } }"].join("\n"),
		);
		writeFile(
			"main.ts",
			['import { Cat, Dog } from "./animals";', "export function run(pet: Cat | Dog) {", "  pet.speak();", "}"].join(
				"\n",
			),
		);

		const main = mustGet(parseFiles(["animals.ts", "main.ts"]), "main.ts");

		expect(main.calls).toStrictEqual([
			{
				callerLocalId: "run",
				candidates: [
					{ filePath: path.join(rootDir, "animals.ts"), localId: "speak" },
					{ filePath: path.join(rootDir, "animals.ts"), localId: "speak#2" },
				],
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});

	it("orders a multi-candidate call's candidates deterministically", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"shapes.ts",
			[
				"export interface Shape { area(): number; }",
				"export class Circle implements Shape { area() { return 1; } }",
				"export class Square implements Shape { area() { return 2; } }",
			].join("\n"),
		);
		writeFile(
			"main.ts",
			['import type { Shape } from "./shapes";', "export function run(shape: Shape) {", "  shape.area();", "}"].join(
				"\n",
			),
		);

		const first = mustGet(parseFiles(["shapes.ts", "main.ts"]), "main.ts");
		const second = mustGet(parseFiles(["shapes.ts", "main.ts"]), "main.ts");

		expect(first.calls).toStrictEqual(second.calls);
		expect(first.calls[0]?.candidates.map((c) => c.localId)).toStrictEqual(["area", "area#2"]);
	});

	it("drops a call with no enclosing Symbol (bare module-top-level statement)", () => {
		writeJson("tsconfig.json", {});
		writeFile("helper.ts", "export function helper() {}");
		writeFile("main.ts", ['import { helper } from "./helper";', "helper();"].join("\n"));

		const main = mustGet(parseFiles(["helper.ts", "main.ts"]), "main.ts");

		expect(main.calls).toStrictEqual([]);
	});

	it("drops a call whose callee resolves to a declaration that isn't an already-extracted Symbol", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"main.ts",
			["export function outer() {", "  function localHelper() {}", "  localHelper();", "}"].join("\n"),
		);

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		expect(main.calls).toStrictEqual([]);
	});

	it("drops a call to a global (setTimeout) rather than pointing at TypeScript's own bundled lib.d.ts under node_modules", () => {
		writeJson("tsconfig.json", {});
		writeFile("main.ts", ["export function run() {", "  setTimeout(() => {}, 0);", "}"].join("\n"));

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		expect(main.calls).toStrictEqual([]);
	});

	it("drops a dynamically computed callee under one unifying rule (dispatch table, callback parameter)", () => {
		writeJson("tsconfig.json", {});
		writeFile(
			"main.ts",
			[
				"export function run(fn: () => void) {",
				"  const handlers: Record<string, () => void> = { fn };",
				"  handlers.fn?.();",
				"  fn();",
				"  [1, 2].forEach(fn);",
				"}",
			].join("\n"),
		);

		const main = mustGet(parseFiles(["main.ts"]), "main.ts");

		// `.forEach` is the only genuine call site among these - `fn` is only ever passed as a
		// value/argument elsewhere - and its own callee resolves to a lib declaration, not an
		// extracted Symbol, so it's dropped too.
		expect(main.calls).toStrictEqual([]);
	});
});

describe("TsCompilerApiParser unparseable file policy", () => {
	it("produces no entry at all for a file with a genuine syntax error", () => {
		writeFile("broken.ts", "export function broken( {");

		const results = parseFiles(["broken.ts"]);

		expect(results.size).toBe(0);
	});

	it("extracts a valid file the root tsconfig.json doesn't include, rather than reporting it unparseable", () => {
		writeJson("tsconfig.json", { include: ["src"] });
		writeFile("src/index.ts", "export const inside = 1;");
		writeFile("vitest.config.ts", "export const outside = 1;");

		const results = parseFiles(["src/index.ts", "vitest.config.ts"]);

		expect(results.get("vitest.config.ts")?.symbols).toStrictEqual([
			{
				localId: "outside",
				name: "outside",
				symbolKind: "const",
				startLine: 1,
				endLine: 1,
				exported: true,
			},
		]);
	});

	it("extracts a file with type errors but valid syntax normally", () => {
		const symbols = parseSnippet("export const bad: number = 'not a number';");

		expect(symbols).toStrictEqual([
			{
				localId: "bad",
				name: "bad",
				symbolKind: "const",
				startLine: 1,
				endLine: 1,
				exported: true,
			},
		]);
	});

	it("treats another file's import into a syntactically-broken file as unresolved, never a dangling target", () => {
		writeFile("broken.ts", "export function broken( {");
		writeFile("main.ts", 'import { broken } from "./broken";');

		const results = parseFiles(["broken.ts", "main.ts"]);

		expect(results.size).toBe(1);
		const main = mustGet(results, "main.ts");
		expect(main.imports).toStrictEqual([
			{
				specifier: "./broken",
				viaReExport: false,
				resolvedTarget: { kind: "unresolved" },
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	it("drops a call whose only candidate lives in a syntactically-broken file", () => {
		writeJson("tsconfig.json", {});
		writeFile("broken.ts", ["export function helper() {}", "export function trailing( {"].join("\n"));
		writeFile(
			"main.ts",
			['import { helper } from "./broken";', "export function run() {", "  helper();", "}"].join("\n"),
		);

		const results = parseFiles(["broken.ts", "main.ts"]);

		expect(results.size).toBe(1);
		const main = mustGet(results, "main.ts");
		expect(main.calls).toStrictEqual([]);
	});

	it("still generates a complete map for every other file alongside one broken file", () => {
		writeFile("broken.ts", "export function broken( {");
		writeFile("good.ts", "export function good() {}");

		const results = parseFiles(["broken.ts", "good.ts"]);

		expect(results.size).toBe(1);
		const good = mustGet(results, "good.ts");
		expect(good.symbols).toStrictEqual([
			{
				localId: "good",
				name: "good",
				symbolKind: "function",
				startLine: 1,
				endLine: 1,
				exported: true,
			},
		]);
	});
});
