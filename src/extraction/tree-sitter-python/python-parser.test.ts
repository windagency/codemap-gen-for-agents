import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtractedSymbols } from "src/core/types";
import { PythonTreeSitterParser } from "src/extraction/tree-sitter-python/python-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let rootDir: string;

beforeEach(() => {
	rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-python-parser-"));
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

function writeProjectManifest(name = "widget", dependencies: string[] = []): void {
	const depsLines =
		dependencies.length > 0 ? `dependencies = [\n${dependencies.map((dep) => `    "${dep}",`).join("\n")}\n]\n` : "";
	writeFile("pyproject.toml", `[project]\nname = "${name}"\nversion = "0.1.0"\n${depsLines}`);
}

function parseFiles(relPaths: string[]): Map<string, ExtractedSymbols> {
	const entries = relPaths.map((relPath) => ({
		relPath,
		absolutePath: path.join(rootDir, relPath),
	}));
	const results = new PythonTreeSitterParser().parse(
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

describe("PythonTreeSitterParser symbol classification", () => {
	it("classifies a top-level def as exported, a leading-underscore def as not", () => {
		writeProjectManifest();
		writeFile("widget.py", "def run():\n    pass\n\ndef _helper():\n    pass\n");

		const extracted = mustGet(parseFiles(["widget.py"]), "widget.py");

		expect(extracted.symbols).toStrictEqual([
			{
				localId: "run",
				name: "run",
				symbolKind: "function",
				startLine: 1,
				endLine: 2,
				exported: true,
			},
			{
				localId: "_helper",
				name: "_helper",
				symbolKind: "function",
				startLine: 4,
				endLine: 5,
				exported: false,
			},
		]);
	});

	it("classifies a class's own methods as method Symbols, never plain attributes", () => {
		writeProjectManifest();
		writeFile(
			"widget.py",
			[
				"class Widget:",
				"    name = 'widget'",
				"",
				"    def greet(self):",
				"        pass",
				"",
				"    def _private(self):",
				"        pass",
				"",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["widget.py"]), "widget.py");

		expect(extracted.symbols).toStrictEqual([
			expect.objectContaining({ name: "Widget", symbolKind: "class" }),
			expect.objectContaining({
				name: "greet",
				symbolKind: "method",
				exported: true,
			}),
			expect.objectContaining({
				name: "_private",
				symbolKind: "method",
				exported: false,
			}),
		]);
	});

	it("classifies a decorated top-level function/class the same as an undecorated one", () => {
		writeProjectManifest();
		writeFile(
			"widget.py",
			[
				"@dataclass",
				"class Widget:",
				"    @staticmethod",
				"    def make():",
				"        pass",
				"",
				"@cache",
				"def run():",
				"    pass",
				"",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["widget.py"]), "widget.py");

		expect(extracted.symbols).toStrictEqual([
			expect.objectContaining({ name: "Widget", symbolKind: "class" }),
			expect.objectContaining({ name: "make", symbolKind: "method" }),
			expect.objectContaining({ name: "run", symbolKind: "function" }),
		]);
	});

	it("classifies a module-level assignment as a const Symbol", () => {
		writeProjectManifest();
		writeFile("widget.py", "MAX_SIZE = 100\n_internal = 1\n");

		const extracted = mustGet(parseFiles(["widget.py"]), "widget.py");

		expect(extracted.symbols).toStrictEqual([
			expect.objectContaining({
				name: "MAX_SIZE",
				symbolKind: "const",
				exported: true,
			}),
			expect.objectContaining({
				name: "_internal",
				symbolKind: "const",
				exported: false,
			}),
		]);
	});
});

describe("PythonTreeSitterParser import resolution", () => {
	it("resolves an absolute import of a sibling module to that file", () => {
		writeProjectManifest();
		writeFile("sub.py", "def do_thing():\n    pass\n");
		writeFile("widget.py", "import sub\n\ndef run():\n    sub.do_thing()\n");

		const extracted = mustGet(parseFiles(["widget.py", "sub.py"]), "widget.py");

		expect(extracted.imports).toStrictEqual([
			{
				specifier: "sub",
				viaReExport: false,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "sub.py"),
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	it("resolves an import nested inside a try/except (the optional-dependency idiom)", () => {
		writeProjectManifest();
		writeFile("sub.py", "def do_thing():\n    pass\n");
		writeFile("widget.py", "try:\n    import sub\nexcept ImportError:\n    sub = None\n");

		const extracted = mustGet(parseFiles(["widget.py", "sub.py"]), "widget.py");

		expect(extracted.imports).toStrictEqual([
			{
				specifier: "sub",
				viaReExport: false,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "sub.py"),
				},
				locations: [{ startLine: 2, endLine: 2 }],
			},
		]);
	});

	it("resolves a from-import of a package submodule to that file", () => {
		writeProjectManifest();
		writeFile("pkg/__init__.py", "");
		writeFile("pkg/sub.py", "def make():\n    pass\n");
		writeFile("widget.py", "from pkg import sub\n");

		const extracted = mustGet(parseFiles(["widget.py", "pkg/sub.py", "pkg/__init__.py"]), "widget.py");

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "file",
			filePath: path.join(rootDir, "pkg/sub.py"),
		});
	});

	it("resolves a from-import of a symbol to its declaring module file", () => {
		writeProjectManifest();
		writeFile("pkg/__init__.py", "");
		writeFile("pkg/sub.py", "def make():\n    pass\n");
		writeFile("widget.py", "from pkg.sub import make\n");

		const extracted = mustGet(parseFiles(["widget.py", "pkg/sub.py", "pkg/__init__.py"]), "widget.py");

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "file",
			filePath: path.join(rootDir, "pkg/sub.py"),
		});
	});

	it("resolves a relative import (from . import x) to a sibling file", () => {
		writeProjectManifest();
		writeFile("pkg/__init__.py", "");
		writeFile("pkg/sibling.py", "def make():\n    pass\n");
		writeFile("pkg/widget.py", "from . import sibling\n");

		const extracted = mustGet(parseFiles(["pkg/widget.py", "pkg/sibling.py", "pkg/__init__.py"]), "pkg/widget.py");

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "file",
			filePath: path.join(rootDir, "pkg/sibling.py"),
		});
	});

	it("resolves a multi-level relative import (from .. import target) to the parent package's own module", () => {
		writeProjectManifest();
		writeFile("pkg/__init__.py", "");
		writeFile("pkg/sub/__init__.py", "");
		writeFile("pkg/target.py", "def make():\n    pass\n");
		writeFile("pkg/sub/widget.py", "from .. import target\n");

		const extracted = mustGet(
			parseFiles(["pkg/sub/widget.py", "pkg/target.py", "pkg/__init__.py", "pkg/sub/__init__.py"]),
			"pkg/sub/widget.py",
		);

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "file",
			filePath: path.join(rootDir, "pkg/target.py"),
		});
	});

	it("resolves an absolute import under a src/ layout project root", () => {
		writeProjectManifest();
		writeFile("src/sub.py", "def do_thing():\n    pass\n");
		writeFile("src/widget.py", "import sub\n\ndef run():\n    sub.do_thing()\n");

		const extracted = mustGet(parseFiles(["src/widget.py", "src/sub.py"]), "src/widget.py");

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "file",
			filePath: path.join(rootDir, "src/sub.py"),
		});

		const call = extracted.calls.find((c) => c.callerLocalId === "run");
		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "src/sub.py"), localId: "do_thing" }]);
	});

	it("resolves a declared dependency to an External target with its declared version", () => {
		writeProjectManifest("widget", ["requests>=2.28.0"]);
		writeFile("widget.py", "import requests\n");

		const extracted = mustGet(parseFiles(["widget.py"]), "widget.py");

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "external",
			packageName: "requests",
			version: ">=2.28.0",
			language: "python",
		});
	});

	it("treats an undeclared (stdlib-shaped) import as unresolved", () => {
		writeProjectManifest();
		writeFile("widget.py", "import os\n");

		const extracted = mustGet(parseFiles(["widget.py"]), "widget.py");

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "unresolved",
		});
	});
});

describe("PythonTreeSitterParser call resolution", () => {
	it("resolves a module-alias-qualified call (sub.do_thing(), via import sub) to that module's own file", () => {
		writeProjectManifest();
		writeFile("sub.py", "def do_thing():\n    pass\n");
		writeFile("widget.py", "import sub\n\ndef run():\n    sub.do_thing()\n");

		const extracted = mustGet(parseFiles(["widget.py", "sub.py"]), "widget.py");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "sub.py"), localId: "do_thing" }]);
	});

	it("resolves a self.method() call against every same-named method in the repo", () => {
		writeProjectManifest();
		writeFile(
			"widget.py",
			[
				"class Widget:",
				"    def run(self):",
				"        self.greet()",
				"",
				"    def greet(self):",
				"        pass",
				"",
				"class Gadget:",
				"    def greet(self):",
				"        pass",
				"",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["widget.py"]), "widget.py");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([
			{ filePath: path.join(rootDir, "widget.py"), localId: "greet" },
			{ filePath: path.join(rootDir, "widget.py"), localId: "greet#2" },
		]);
	});

	it("resolves an unqualified call against every same-named top-level function in the repo", () => {
		writeProjectManifest();
		writeFile("other.py", "def shared():\n    pass\n");
		writeFile("widget.py", "def shared():\n    pass\n\ndef run():\n    shared()\n");

		const extracted = mustGet(parseFiles(["widget.py", "other.py"]), "widget.py");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates.map((c) => c.filePath).sort()).toStrictEqual(
			[path.join(rootDir, "widget.py"), path.join(rootDir, "other.py")].sort(),
		);
	});

	it("resolves a bare (non-parenthesized) decorator as an implicit call on the decorated function", () => {
		writeProjectManifest();
		writeFile("deco.py", "def logged(fn):\n    return fn\n");
		writeFile("widget.py", ["from deco import logged", "", "@logged", "def run():", "    pass", ""].join("\n"));

		const extracted = mustGet(parseFiles(["widget.py", "deco.py"]), "widget.py");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "deco.py"), localId: "logged" }]);
	});

	it("attributes a parameterized decorator's call to the decorated method, not the enclosing class", () => {
		writeProjectManifest();
		writeFile(
			"widget.py",
			[
				"def app_route(path):",
				"    def wrapper(fn):",
				"        return fn",
				"    return wrapper",
				"",
				"class Handlers:",
				'    @app_route("/x")',
				"    def handle(self):",
				"        pass",
				"",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["widget.py"]), "widget.py");
		const call = extracted.calls.find((c) => c.callerLocalId === "handle");

		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "widget.py"), localId: "app_route" }]);
		expect(extracted.calls.find((c) => c.callerLocalId === "Handlers")).toBeUndefined();
	});
});

describe("PythonTreeSitterParser unparseable file policy", () => {
	it("produces no entry for a syntactically broken file", () => {
		writeProjectManifest();
		writeFile("broken.py", "def broken(:\n    pass\n");

		expect(parseFiles(["broken.py"]).size).toBe(0);
	});

	it("treats an import into a broken file as unresolved, never a dangling target", () => {
		writeProjectManifest();
		writeFile("broken.py", "def broken(:\n    pass\n");
		writeFile("main.py", "from . import broken\n");

		const main = mustGet(parseFiles(["broken.py", "main.py"]), "main.py");

		expect(main.imports.map((i) => i.resolvedTarget)).toStrictEqual([{ kind: "unresolved" }]);
	});
});
