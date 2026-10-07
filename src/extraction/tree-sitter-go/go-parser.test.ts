import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtractedSymbols } from "src/core/types";
import { GoTreeSitterParser } from "src/extraction/tree-sitter-go/go-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let rootDir: string;

beforeEach(() => {
	rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-go-parser-"));
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

// Extracts every listed file whole-program, keyed by relative path.
function parseFiles(relPaths: string[]): Map<string, ExtractedSymbols> {
	const entries = relPaths.map((relPath) => ({
		relPath,
		absolutePath: path.join(rootDir, relPath),
	}));
	const results = new GoTreeSitterParser().parse(
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

describe("GoTreeSitterParser symbol classification", () => {
	it("classifies a top-level function as a function Symbol, exported by capitalization", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("main.go", "package main\n\nfunc Run() {}\n\nfunc helper() {}\n");

		const extracted = mustGet(parseFiles(["main.go"]), "main.go");

		expect(extracted.symbols).toStrictEqual([
			{
				localId: "Run",
				name: "Run",
				symbolKind: "function",
				startLine: 3,
				endLine: 3,
				exported: true,
			},
			{
				localId: "helper",
				name: "helper",
				symbolKind: "function",
				startLine: 5,
				endLine: 5,
				exported: false,
			},
		]);
	});

	it("classifies a receiver method as a method Symbol, never the struct's own fields", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile(
			"widget.go",
			[
				"package widget",
				"",
				"type Widget struct {",
				"\tName string",
				"}",
				"",
				"func (w *Widget) Greet() string {",
				"\treturn w.Name",
				"}",
				"",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["widget.go"]), "widget.go");

		expect(extracted.symbols).toStrictEqual([
			{
				localId: "Widget",
				name: "Widget",
				symbolKind: "type",
				startLine: 3,
				endLine: 5,
				exported: true,
			},
			{
				localId: "Greet",
				name: "Greet",
				symbolKind: "method",
				startLine: 7,
				endLine: 9,
				exported: true,
			},
		]);
	});

	it("classifies an interface type distinctly from a struct type", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("types.go", "package widget\n\ntype Greeter interface {\n\tGreet() string\n}\n");

		const extracted = mustGet(parseFiles(["types.go"]), "types.go");

		expect(extracted.symbols).toStrictEqual([expect.objectContaining({ name: "Greeter", symbolKind: "interface" })]);
	});

	it("classifies multi-name const/var specs as one const Symbol per name", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("consts.go", "package widget\n\nconst A, B = 1, 2\nvar C = 3\n");

		const extracted = mustGet(parseFiles(["consts.go"]), "consts.go");

		expect(extracted.symbols.map((s) => [s.name, s.symbolKind])).toStrictEqual([
			["A", "const"],
			["B", "const"],
			["C", "const"],
		]);
	});

	it("suffixes a redeclared name with #2, by source order", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("dup.go", "package widget\n\nfunc Do() {}\n\ntype Do struct{}\n");

		const extracted = mustGet(parseFiles(["dup.go"]), "dup.go");

		expect(extracted.symbols.map((s) => s.localId)).toStrictEqual(["Do", "Do#2"]);
	});
});

describe("GoTreeSitterParser import resolution", () => {
	it("resolves an internal same-module import to every .go file in the target package directory", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("sub/a.go", "package sub\n\nfunc A() {}\n");
		writeFile("sub/b.go", "package sub\n\nfunc B() {}\n");
		writeFile("main.go", 'package main\n\nimport "example.com/widget/sub"\n\nfunc main() {\n\tsub.A()\n}\n');

		const extracted = mustGet(parseFiles(["main.go", "sub/a.go", "sub/b.go"]), "main.go");

		const targets = extracted.imports
			.map((imp) => (imp.resolvedTarget.kind === "file" ? imp.resolvedTarget.filePath : null))
			.sort();
		expect(targets).toStrictEqual([path.join(rootDir, "sub/a.go"), path.join(rootDir, "sub/b.go")].sort());
	});

	it("resolves a require-declared external dependency to an External target with its declared version", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n\nrequire example.com/dep v1.2.3\n");
		writeFile("main.go", 'package main\n\nimport "example.com/dep"\n\nfunc main() {\n\tdep.Do()\n}\n');

		const extracted = mustGet(parseFiles(["main.go"]), "main.go");

		expect(extracted.imports).toStrictEqual([
			{
				specifier: "example.com/dep",
				viaReExport: false,
				resolvedTarget: {
					kind: "external",
					packageName: "example.com/dep",
					version: "v1.2.3",
					language: "go",
				},
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});

	it("never fans an import out to the target package's own _test.go file, even when tests are included in programFiles", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("sub/a.go", "package sub\n\nfunc A() {}\n");
		writeFile("sub/a_test.go", 'package sub\n\nimport "testing"\n\nfunc TestA(t *testing.T) {}\n');
		writeFile("main.go", 'package main\n\nimport "example.com/widget/sub"\n\nfunc main() {\n\tsub.A()\n}\n');

		// `programFiles` includes the test file, as it would when `--include-tests` is on - a
		// _test.go file is never part of the package another file imports, regardless.
		const extracted = mustGet(parseFiles(["main.go", "sub/a.go", "sub/a_test.go"]), "main.go");

		const targets = extracted.imports
			.map((imp) => (imp.resolvedTarget.kind === "file" ? imp.resolvedTarget.filePath : null))
			.sort();
		expect(targets).toStrictEqual([path.join(rootDir, "sub/a.go")]);
	});

	it("treats an unversioned (stdlib-shaped) import as unresolved", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("main.go", 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n');

		const extracted = mustGet(parseFiles(["main.go"]), "main.go");

		expect(extracted.imports).toStrictEqual([
			{
				specifier: "fmt",
				viaReExport: false,
				resolvedTarget: { kind: "unresolved" },
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});
});

describe("GoTreeSitterParser call resolution", () => {
	it("resolves a same-file call to its declaration", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("main.go", "package main\n\nfunc helper() {}\n\nfunc Run() {\n\thelper()\n}\n");

		const extracted = mustGet(parseFiles(["main.go"]), "main.go");
		const call = extracted.calls.find((c) => c.callerLocalId === "Run");

		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "main.go"), localId: "helper" }]);
	});

	it("resolves a namespace-qualified call (pkg.Func()) to its specific import target only", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("sub/a.go", "package sub\n\nfunc A() {}\n");
		writeFile(
			"other/a.go",
			"package other\n\nfunc A() {}\n", // same-named function elsewhere in the repo
		);
		writeFile("main.go", 'package main\n\nimport "example.com/widget/sub"\n\nfunc Run() {\n\tsub.A()\n}\n');

		const extracted = mustGet(parseFiles(["main.go", "sub/a.go", "other/a.go"]), "main.go");
		const call = extracted.calls.find((c) => c.callerLocalId === "Run");

		// Only sub.A - not other/a.go's unrelated same-named A - despite the ambiguous name.
		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "sub/a.go"), localId: "A" }]);
	});

	it("resolves an unqualified call against every same-named top-level function in the repo", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("sub/a.go", "package sub\n\nfunc Shared() {}\n");
		writeFile("main.go", "package main\n\nfunc Shared() {}\n\nfunc Run() {\n\tShared()\n}\n");

		const extracted = mustGet(parseFiles(["main.go", "sub/a.go"]), "main.go");
		const call = extracted.calls.find((c) => c.callerLocalId === "Run");

		expect(call?.candidates.map((c) => c.filePath).sort()).toStrictEqual(
			[path.join(rootDir, "main.go"), path.join(rootDir, "sub/a.go")].sort(),
		);
	});

	it("resolves a method call on an unknown-typed receiver against every same-named method in the repo", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("widget.go", "package main\n\ntype Widget struct{}\n\nfunc (w *Widget) Greet() {}\n");
		writeFile("gadget.go", "package main\n\ntype Gadget struct{}\n\nfunc (g *Gadget) Greet() {}\n");
		writeFile("main.go", "package main\n\nfunc Run(w *Widget) {\n\tw.Greet()\n}\n");

		const extracted = mustGet(parseFiles(["main.go", "widget.go", "gadget.go"]), "main.go");
		const call = extracted.calls.find((c) => c.callerLocalId === "Run");

		expect(call?.candidates.map((c) => c.filePath).sort()).toStrictEqual(
			[path.join(rootDir, "widget.go"), path.join(rootDir, "gadget.go")].sort(),
		);
	});
});

describe("GoTreeSitterParser unparseable file policy", () => {
	it("produces no entry for a syntactically broken file", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("broken.go", "package widget\n\nfunc Broken( {\n");

		expect(parseFiles(["broken.go"]).size).toBe(0);
	});
});
