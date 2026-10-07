import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtractedSymbols } from "src/core/types";
import { RustTreeSitterParser } from "src/extraction/tree-sitter-rust/rust-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let rootDir: string;

beforeEach(() => {
	rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-rust-parser-"));
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

function writeCrateManifest(name = "widget"): void {
	writeFile("Cargo.toml", `[package]\nname = "${name}"\nversion = "0.1.0"\n`);
}

function parseFiles(relPaths: string[]): Map<string, ExtractedSymbols> {
	const entries = relPaths.map((relPath) => ({
		relPath,
		absolutePath: path.join(rootDir, relPath),
	}));
	const results = new RustTreeSitterParser().parse(
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

describe("RustTreeSitterParser symbol classification", () => {
	it("classifies a top-level pub fn as exported, a private fn as not", () => {
		writeCrateManifest();
		writeFile("src/lib.rs", "pub fn run() {}\n\nfn helper() {}\n");

		const extracted = mustGet(parseFiles(["src/lib.rs"]), "src/lib.rs");

		expect(extracted.symbols).toStrictEqual([
			{
				localId: "run",
				name: "run",
				symbolKind: "function",
				startLine: 1,
				endLine: 1,
				exported: true,
			},
			{
				localId: "helper",
				name: "helper",
				symbolKind: "function",
				startLine: 3,
				endLine: 3,
				exported: false,
			},
		]);
	});

	it("classifies an impl block's methods as method Symbols, never struct fields", () => {
		writeCrateManifest();
		writeFile(
			"src/lib.rs",
			[
				"pub struct Widget {",
				"    pub name: String,",
				"}",
				"",
				"impl Widget {",
				"    pub fn new() -> Self { Widget { name: String::new() } }",
				"    fn private_method(&self) {}",
				"}",
				"",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["src/lib.rs"]), "src/lib.rs");

		expect(extracted.symbols).toStrictEqual([
			expect.objectContaining({ name: "Widget", symbolKind: "type" }),
			expect.objectContaining({
				name: "new",
				symbolKind: "method",
				exported: true,
			}),
			expect.objectContaining({
				name: "private_method",
				symbolKind: "method",
				exported: false,
			}),
		]);
	});

	it("classifies a trait as an interface Symbol and an enum as an enum Symbol", () => {
		writeCrateManifest();
		writeFile("src/lib.rs", "pub trait Greeter {\n\tfn greet(&self) -> String;\n}\n\npub enum Status { On, Off }\n");

		const extracted = mustGet(parseFiles(["src/lib.rs"]), "src/lib.rs");

		expect(extracted.symbols).toStrictEqual([
			expect.objectContaining({ name: "Greeter", symbolKind: "interface" }),
			expect.objectContaining({ name: "Status", symbolKind: "enum" }),
		]);
	});

	it("excludes a #[test]-attributed function and a #[cfg(test)] module's contents by default", () => {
		writeCrateManifest();
		writeFile(
			"src/lib.rs",
			[
				"pub fn run() {}",
				"",
				"#[test]",
				"fn it_works() {}",
				"",
				"#[cfg(test)]",
				"mod tests {",
				"    fn helper() {}",
				"}",
				"",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["src/lib.rs"]), "src/lib.rs");

		// The parser itself still emits every item, tagged - `generate-map.ts` is what strips
		// `isTestItem`-tagged symbols by default (`--include-tests` reveals them unchanged).
		expect(extracted.symbols).toStrictEqual([
			expect.objectContaining({ name: "run" }),
			expect.objectContaining({ name: "it_works", isTestItem: true }),
			expect.objectContaining({ name: "helper", isTestItem: true }),
		]);
	});
});

describe("RustTreeSitterParser import resolution", () => {
	it("resolves a crate::-qualified module-file use to that file", () => {
		writeCrateManifest();
		writeFile("src/widget.rs", "pub fn make() {}\n");
		writeFile("src/lib.rs", "use crate::widget;\n\npub fn run() {\n\twidget::make();\n}\n");

		const extracted = mustGet(parseFiles(["src/lib.rs", "src/widget.rs"]), "src/lib.rs");

		expect(extracted.imports).toStrictEqual([
			{
				specifier: "crate::widget",
				viaReExport: false,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "src/widget.rs"),
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	it("resolves a crate::-qualified item use to its declaring module file", () => {
		writeCrateManifest();
		writeFile("src/widget.rs", "pub fn make() {}\n");
		writeFile("src/lib.rs", "use crate::widget::make;\n");

		const extracted = mustGet(parseFiles(["src/lib.rs", "src/widget.rs"]), "src/lib.rs");

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "file",
			filePath: path.join(rootDir, "src/widget.rs"),
		});
	});

	it("resolves a declared dependency to an External target with its declared version", () => {
		writeFile("Cargo.toml", '[package]\nname = "widget"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0.190"\n');
		writeFile("src/lib.rs", "use serde::Serialize;\n");

		const extracted = mustGet(parseFiles(["src/lib.rs"]), "src/lib.rs");

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "external",
			packageName: "serde",
			version: "1.0.190",
			language: "rust",
		});
	});

	it("treats an undeclared (stdlib-shaped) use as unresolved", () => {
		writeCrateManifest();
		writeFile("src/lib.rs", "use std::collections::HashMap;\n");

		const extracted = mustGet(parseFiles(["src/lib.rs"]), "src/lib.rs");

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "unresolved",
		});
	});

	it("resolves a bodiless `mod name;` file declaration to that sibling file, with no accompanying use", () => {
		writeCrateManifest();
		writeFile("src/widget.rs", "pub fn make() {}\n");
		writeFile("src/lib.rs", "pub mod widget;\n");

		const extracted = mustGet(parseFiles(["src/lib.rs", "src/widget.rs"]), "src/lib.rs");

		expect(extracted.imports).toStrictEqual([
			{
				specifier: "widget",
				viaReExport: false,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "src/widget.rs"),
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});

	it("resolves a use declared inside an inline (non-test) module, not just at file scope", () => {
		writeCrateManifest();
		writeFile("src/task.rs", "pub struct Task;\n");
		writeFile(
			"src/lib.rs",
			[
				"mod task;",
				"",
				"mod helpers {",
				"    use crate::task::Task;",
				"",
				"    pub fn describe(_task: Task) -> String {",
				'        String::from("task")',
				"    }",
				"}",
				"",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["src/lib.rs", "src/task.rs"]), "src/lib.rs");

		expect(extracted.imports.find((imp) => imp.specifier === "crate::task::Task")?.resolvedTarget).toStrictEqual({
			kind: "file",
			filePath: path.join(rootDir, "src/task.rs"),
		});
	});

	it("never collects a use declared inside a #[cfg(test)] inline module", () => {
		writeCrateManifest();
		writeFile("src/task.rs", "pub struct Task;\n");
		writeFile(
			"src/lib.rs",
			[
				"mod task;",
				"",
				"#[cfg(test)]",
				"mod tests {",
				"    use crate::task::Task;",
				"",
				"    #[test]",
				"    fn it_works() {",
				"        let _task = Task;",
				"    }",
				"}",
				"",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["src/lib.rs", "src/task.rs"]), "src/lib.rs");

		expect(extracted.imports.some((imp) => imp.specifier === "crate::task::Task")).toBe(false);
	});

	it("resolves a self::-qualified use into an inline (non-file) module to the declaring file itself", () => {
		writeCrateManifest();
		writeFile(
			"src/lib.rs",
			[
				"use self::helpers::double;",
				"",
				"pub fn run(input: &str) -> String {",
				"    double(input)",
				"}",
				"",
				"mod helpers {",
				"    pub fn double(input: &str) -> String {",
				'        format!("{}{}", input, input)',
				"    }",
				"}",
				"",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["src/lib.rs"]), "src/lib.rs");

		expect(extracted.imports).toStrictEqual([
			{
				specifier: "self::helpers::double",
				viaReExport: false,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "src/lib.rs"),
				},
				locations: [{ startLine: 1, endLine: 1 }],
			},
		]);
	});
});

describe("RustTreeSitterParser call resolution", () => {
	it("resolves an associated-function call (Type::method()) only to that type's own impl", () => {
		writeCrateManifest();
		writeFile(
			"src/lib.rs",
			[
				"pub struct Widget;",
				"impl Widget {",
				"    pub fn new() -> Self { Widget }",
				"}",
				"pub struct Gadget;",
				"impl Gadget {",
				"    pub fn new() -> Self { Gadget }",
				"}",
				"pub fn run() -> Widget {",
				"    Widget::new()",
				"}",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["src/lib.rs"]), "src/lib.rs");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "src/lib.rs"), localId: "new" }]);
	});

	it("resolves an associated-function call on a generic impl (Error::<F> vs. Error::new()) to that impl's method", () => {
		writeCrateManifest();
		writeFile(
			"src/lib.rs",
			[
				"pub trait Formatter {}",
				"pub struct Error<F: Formatter> {",
				"    _marker: std::marker::PhantomData<F>,",
				"}",
				"impl<F: Formatter> Error<F> {",
				"    pub fn invalid_utf8() -> Self { unimplemented!() }",
				"}",
				"pub fn run() {",
				"    crate::Error::invalid_utf8();",
				"}",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["src/lib.rs"]), "src/lib.rs");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "src/lib.rs"), localId: "invalid_utf8" }]);
	});

	it("follows a `pub(crate) use` re-export to resolve a module-path-qualified call to its real defining file", () => {
		writeCrateManifest();
		writeFile("src/util/str_to_bool.rs", "pub fn str_to_bool() -> bool { true }\n");
		writeFile("src/util/mod.rs", "pub(crate) use self::str_to_bool::str_to_bool;\n\nmod str_to_bool;\n");
		writeFile("src/lib.rs", "mod util;\n\npub fn run() -> bool {\n    crate::util::str_to_bool()\n}\n");

		const extracted = mustGet(parseFiles(["src/lib.rs", "src/util/mod.rs", "src/util/str_to_bool.rs"]), "src/lib.rs");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([
			{
				filePath: path.join(rootDir, "src/util/str_to_bool.rs"),
				localId: "str_to_bool",
			},
		]);
	});

	it("resolves a method call on an unknown-typed receiver against every same-named method in the repo", () => {
		writeCrateManifest();
		writeFile(
			"src/lib.rs",
			[
				"pub struct Widget;",
				"impl Widget {",
				"    pub fn greet(&self) {}",
				"}",
				"pub struct Gadget;",
				"impl Gadget {",
				"    pub fn greet(&self) {}",
				"}",
				"pub fn run(w: &Widget) {",
				"    w.greet();",
				"}",
			].join("\n"),
		);

		const extracted = mustGet(parseFiles(["src/lib.rs"]), "src/lib.rs");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([
			{ filePath: path.join(rootDir, "src/lib.rs"), localId: "greet" },
			{ filePath: path.join(rootDir, "src/lib.rs"), localId: "greet#2" },
		]);
	});

	it("resolves a bare module-alias-qualified call (sub::do_thing(), via use crate::sub;) to that module's own file", () => {
		writeCrateManifest();
		writeFile("src/sub.rs", "pub fn do_thing() {}\n");
		writeFile("src/lib.rs", "use crate::sub;\n\npub fn run() {\n\tsub::do_thing();\n}\n");

		const extracted = mustGet(parseFiles(["src/lib.rs", "src/sub.rs"]), "src/lib.rs");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "src/sub.rs"), localId: "do_thing" }]);
	});

	it("resolves a bare module-qualified call (sub::do_thing(), via a plain `mod sub;`, no `use` at all) to that module's own file", () => {
		writeCrateManifest();
		writeFile("src/sub.rs", "pub fn do_thing() {}\n");
		writeFile("src/lib.rs", "mod sub;\n\npub fn run() {\n\tsub::do_thing();\n}\n");

		const extracted = mustGet(parseFiles(["src/lib.rs", "src/sub.rs"]), "src/lib.rs");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([{ filePath: path.join(rootDir, "src/sub.rs"), localId: "do_thing" }]);
	});

	it("resolves an unqualified call against every same-named top-level function in the repo", () => {
		writeCrateManifest();
		writeFile("src/other.rs", "pub fn shared() {}\n");
		writeFile("src/lib.rs", "pub fn shared() {}\n\npub fn run() {\n\tshared();\n}\n");

		const extracted = mustGet(parseFiles(["src/lib.rs", "src/other.rs"]), "src/lib.rs");
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates.map((c) => c.filePath).sort()).toStrictEqual(
			[path.join(rootDir, "src/lib.rs"), path.join(rootDir, "src/other.rs")].sort(),
		);
	});
});
