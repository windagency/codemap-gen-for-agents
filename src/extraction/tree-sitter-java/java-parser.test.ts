import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtractedSymbols } from "src/core/types";
import { JavaTreeSitterParser } from "src/extraction/tree-sitter-java/java-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let rootDir: string;

beforeEach(() => {
	rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-java-parser-"));
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

function writePom(): void {
	writeFile("pom.xml", "<project><artifactId>widget-service</artifactId></project>");
}

function parseFiles(relPaths: string[]): Map<string, ExtractedSymbols> {
	const entries = relPaths.map((relPath) => ({
		relPath,
		absolutePath: path.join(rootDir, relPath),
	}));
	const results = new JavaTreeSitterParser().parse(
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

describe("JavaTreeSitterParser symbol classification", () => {
	it("classifies a public class's public/private methods and constructor, never its fields", () => {
		writePom();
		writeFile(
			"src/main/java/com/example/Widget.java",
			[
				"package com.example;",
				"",
				"public class Widget {",
				"    private String name;",
				"",
				"    public Widget(String name) { this.name = name; }",
				"",
				"    public String greet() { return name; }",
				"",
				"    private String other() { return name; }",
				"}",
				"",
			].join("\n"),
		);

		const extracted = mustGet(
			parseFiles(["src/main/java/com/example/Widget.java"]),
			"src/main/java/com/example/Widget.java",
		);

		expect(extracted.symbols).toStrictEqual([
			expect.objectContaining({
				name: "Widget",
				symbolKind: "class",
				exported: true,
			}),
			expect.objectContaining({
				name: "Widget",
				symbolKind: "method",
				exported: true,
			}),
			expect.objectContaining({
				name: "greet",
				symbolKind: "method",
				exported: true,
			}),
			expect.objectContaining({
				name: "other",
				symbolKind: "method",
				exported: false,
			}),
		]);
		expect(extracted.symbols.map((s) => s.name)).not.toContain("name");
	});

	it("classifies an interface as an interface Symbol and an enum as an enum Symbol", () => {
		writePom();
		writeFile(
			"src/main/java/com/example/Greeter.java",
			"package com.example;\n\npublic interface Greeter {\n\tString greet();\n}\n",
		);
		writeFile("src/main/java/com/example/Status.java", "package com.example;\n\npublic enum Status { ON, OFF }\n");

		const byRelPath = parseFiles(["src/main/java/com/example/Greeter.java", "src/main/java/com/example/Status.java"]);

		expect(mustGet(byRelPath, "src/main/java/com/example/Greeter.java").symbols).toStrictEqual([
			expect.objectContaining({ name: "Greeter", symbolKind: "interface" }),
			expect.objectContaining({ name: "greet", symbolKind: "method" }),
		]);
		expect(mustGet(byRelPath, "src/main/java/com/example/Status.java").symbols).toStrictEqual([
			expect.objectContaining({ name: "Status", symbolKind: "enum" }),
		]);
	});
});

describe("JavaTreeSitterParser import resolution", () => {
	it("resolves a same-repo import to its declaring file via package + class name, not directory layout", () => {
		writePom();
		writeFile(
			"src/main/java/com/example/other/Helper.java",
			"package com.example.other;\n\npublic class Helper {\n\tpublic static void assist() {}\n}\n",
		);
		writeFile(
			"src/main/java/com/example/Widget.java",
			[
				"package com.example;",
				"",
				"import com.example.other.Helper;",
				"",
				"public class Widget {",
				"    public void run() { Helper.assist(); }",
				"}",
				"",
			].join("\n"),
		);

		const extracted = mustGet(
			parseFiles(["src/main/java/com/example/Widget.java", "src/main/java/com/example/other/Helper.java"]),
			"src/main/java/com/example/Widget.java",
		);

		expect(extracted.imports).toStrictEqual([
			{
				specifier: "com.example.other.Helper",
				viaReExport: false,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "src/main/java/com/example/other/Helper.java"),
				},
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});

	it("resolves a static import to the declaring class's file", () => {
		writePom();
		writeFile(
			"src/main/java/com/example/Utils.java",
			"package com.example;\n\npublic class Utils {\n\tpublic static void doThing() {}\n}\n",
		);
		writeFile(
			"src/main/java/com/example/Widget.java",
			"package com.example;\n\nimport static com.example.Utils.doThing;\n",
		);

		const extracted = mustGet(
			parseFiles(["src/main/java/com/example/Widget.java", "src/main/java/com/example/Utils.java"]),
			"src/main/java/com/example/Widget.java",
		);

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "file",
			filePath: path.join(rootDir, "src/main/java/com/example/Utils.java"),
		});
	});

	it("resolves a dependency declared in pom.xml to an External target with its declared version", () => {
		writeFile(
			"pom.xml",
			[
				"<project>",
				"<artifactId>widget-service</artifactId>",
				"<dependencies>",
				"<dependency>",
				"<groupId>com.fasterxml.jackson.core</groupId>",
				"<artifactId>jackson-databind</artifactId>",
				"<version>2.15.2</version>",
				"</dependency>",
				"</dependencies>",
				"</project>",
			].join("\n"),
		);
		writeFile(
			"src/main/java/com/example/Widget.java",
			"package com.example;\n\nimport com.fasterxml.jackson.core.JsonParser;\n",
		);

		const extracted = mustGet(
			parseFiles(["src/main/java/com/example/Widget.java"]),
			"src/main/java/com/example/Widget.java",
		);

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "external",
			packageName: "com.fasterxml.jackson.core:jackson-databind",
			version: "2.15.2",
			language: "java",
		});
	});

	it("resolves a dependency declared in build.gradle (Groovy DSL) to an External target with its declared version", () => {
		writeFile(
			"build.gradle",
			"dependencies {\n\timplementation 'com.fasterxml.jackson.core:jackson-databind:2.15.2'\n}\n",
		);
		writeFile(
			"src/main/java/com/example/Widget.java",
			"package com.example;\n\nimport com.fasterxml.jackson.core.JsonParser;\n",
		);

		const extracted = mustGet(
			parseFiles(["src/main/java/com/example/Widget.java"]),
			"src/main/java/com/example/Widget.java",
		);

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "external",
			packageName: "com.fasterxml.jackson.core:jackson-databind",
			version: "2.15.2",
			language: "java",
		});
	});

	it("resolves an import whose package diverges from the dependency's groupId only in the trailing segment (the real jackson-databind case)", () => {
		// jackson-databind's actual Maven coordinate is groupId `com.fasterxml.jackson.core`,
		// artifactId `jackson-databind` - but the Java package it exposes is
		// `com.fasterxml.jackson.databind`, not `com.fasterxml.jackson.core`. A literal groupId-prefix
		// match alone would miss this (one of the most widely used Java libraries there is); the
		// shared `com.fasterxml.jackson` ancestor one segment up still identifies it unambiguously.
		writeFile(
			"pom.xml",
			[
				"<project>",
				"<artifactId>widget-service</artifactId>",
				"<dependencies>",
				"<dependency>",
				"<groupId>com.fasterxml.jackson.core</groupId>",
				"<artifactId>jackson-databind</artifactId>",
				"<version>2.15.2</version>",
				"</dependency>",
				"</dependencies>",
				"</project>",
			].join("\n"),
		);
		writeFile(
			"src/main/java/com/example/Widget.java",
			"package com.example;\n\nimport com.fasterxml.jackson.databind.ObjectMapper;\n",
		);

		const extracted = mustGet(
			parseFiles(["src/main/java/com/example/Widget.java"]),
			"src/main/java/com/example/Widget.java",
		);

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "external",
			packageName: "com.fasterxml.jackson.core:jackson-databind",
			version: "2.15.2",
			language: "java",
		});
	});

	it("never widens a 3-segment-or-shorter groupId, to avoid matching unrelated products under the same bare vendor prefix", () => {
		// `com.google.guava`'s groupId is already only 3 segments - dropping one more would reach the
		// bare "com.google" prefix shared by many unrelated Google-published libraries, so it must
		// stay un-truncated.
		writeFile(
			"pom.xml",
			[
				"<project>",
				"<artifactId>widget-service</artifactId>",
				"<dependencies>",
				"<dependency>",
				"<groupId>com.google.guava</groupId>",
				"<artifactId>guava</artifactId>",
				"<version>32.1.3-jre</version>",
				"</dependency>",
				"</dependencies>",
				"</project>",
			].join("\n"),
		);
		writeFile("src/main/java/com/example/Widget.java", "package com.example;\n\nimport com.google.gson.Gson;\n");

		const extracted = mustGet(
			parseFiles(["src/main/java/com/example/Widget.java"]),
			"src/main/java/com/example/Widget.java",
		);

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "unresolved",
		});
	});

	it("treats an undeclared (JDK-shaped) import as unresolved", () => {
		writePom();
		writeFile("src/main/java/com/example/Widget.java", "package com.example;\n\nimport java.util.List;\n");

		const extracted = mustGet(
			parseFiles(["src/main/java/com/example/Widget.java"]),
			"src/main/java/com/example/Widget.java",
		);

		expect(extracted.imports[0]?.resolvedTarget).toStrictEqual({
			kind: "unresolved",
		});
	});

	it("resolves a same-package extends/implements to its declaring file, with no import statement needed", () => {
		writePom();
		writeFile(
			"src/main/java/com/example/Identifiable.java",
			"package com.example;\n\npublic interface Identifiable {\n\tString id();\n}\n",
		);
		writeFile(
			"src/main/java/com/example/BaseEntity.java",
			'package com.example;\n\npublic class BaseEntity implements Identifiable {\n\tpublic String id() { return ""; }\n}\n',
		);
		writeFile(
			"src/main/java/com/example/Item.java",
			"package com.example;\n\npublic class Item extends BaseEntity {\n}\n",
		);

		const extracted = mustGet(
			parseFiles([
				"src/main/java/com/example/Item.java",
				"src/main/java/com/example/BaseEntity.java",
				"src/main/java/com/example/Identifiable.java",
			]),
			"src/main/java/com/example/Item.java",
		);

		expect(extracted.imports).toStrictEqual([
			{
				specifier: "BaseEntity",
				viaReExport: false,
				resolvedTarget: {
					kind: "file",
					filePath: path.join(rootDir, "src/main/java/com/example/BaseEntity.java"),
				},
				locations: [{ startLine: 3, endLine: 3 }],
			},
		]);
	});
});

describe("JavaTreeSitterParser call resolution", () => {
	it("resolves a class-qualified call (Helper.assist()) only to that class's own methods", () => {
		writePom();
		writeFile(
			"src/main/java/com/example/Helper.java",
			"package com.example;\n\npublic class Helper {\n\tpublic static void assist() {}\n}\n",
		);
		writeFile(
			"src/main/java/com/example/Other.java",
			"package com.example;\n\npublic class Other {\n\tpublic static void assist() {}\n}\n",
		);
		writeFile(
			"src/main/java/com/example/Widget.java",
			"package com.example;\n\npublic class Widget {\n\tpublic void run() { Helper.assist(); }\n}\n",
		);

		const extracted = mustGet(
			parseFiles([
				"src/main/java/com/example/Widget.java",
				"src/main/java/com/example/Helper.java",
				"src/main/java/com/example/Other.java",
			]),
			"src/main/java/com/example/Widget.java",
		);
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([
			{
				filePath: path.join(rootDir, "src/main/java/com/example/Helper.java"),
				localId: "assist",
			},
		]);
	});

	it("resolves a class-qualified call through this file's own import, not a same-named class in another package", () => {
		writePom();
		writeFile(
			"src/main/java/com/a/Helper.java",
			"package com.a;\n\npublic class Helper {\n\tpublic static void assist() {}\n}\n",
		);
		writeFile(
			"src/main/java/com/b/Helper.java",
			"package com.b;\n\npublic class Helper {\n\tpublic static void assist() {}\n}\n",
		);
		writeFile(
			"src/main/java/com/example/Widget.java",
			[
				"package com.example;",
				"",
				"import com.a.Helper;",
				"",
				"public class Widget {",
				"\tpublic void run() { Helper.assist(); }",
				"}",
				"",
			].join("\n"),
		);

		const extracted = mustGet(
			parseFiles([
				"src/main/java/com/example/Widget.java",
				"src/main/java/com/a/Helper.java",
				"src/main/java/com/b/Helper.java",
			]),
			"src/main/java/com/example/Widget.java",
		);
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([
			{
				filePath: path.join(rootDir, "src/main/java/com/a/Helper.java"),
				localId: "assist",
			},
		]);
	});

	it("resolves a class-qualified call to a same-package class with no import needed", () => {
		writePom();
		writeFile(
			"src/main/java/com/example/Helper.java",
			"package com.example;\n\npublic class Helper {\n\tpublic static void assist() {}\n}\n",
		);
		writeFile(
			"src/main/java/com/example/Widget.java",
			"package com.example;\n\npublic class Widget {\n\tpublic void run() { Helper.assist(); }\n}\n",
		);

		const extracted = mustGet(
			parseFiles(["src/main/java/com/example/Widget.java", "src/main/java/com/example/Helper.java"]),
			"src/main/java/com/example/Widget.java",
		);
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates).toStrictEqual([
			{
				filePath: path.join(rootDir, "src/main/java/com/example/Helper.java"),
				localId: "assist",
			},
		]);
	});

	it("resolves an unqualified/unknown-receiver call against every same-named method in the repo", () => {
		writePom();
		writeFile(
			"src/main/java/com/example/Widget.java",
			"package com.example;\n\npublic class Widget {\n\tpublic void greet() {}\n\tpublic void run() { greet(); }\n}\n",
		);
		writeFile(
			"src/main/java/com/example/Gadget.java",
			"package com.example;\n\npublic class Gadget {\n\tpublic void greet() {}\n}\n",
		);

		const extracted = mustGet(
			parseFiles(["src/main/java/com/example/Widget.java", "src/main/java/com/example/Gadget.java"]),
			"src/main/java/com/example/Widget.java",
		);
		const call = extracted.calls.find((c) => c.callerLocalId === "run");

		expect(call?.candidates.map((c) => c.filePath).sort()).toStrictEqual(
			[
				path.join(rootDir, "src/main/java/com/example/Widget.java"),
				path.join(rootDir, "src/main/java/com/example/Gadget.java"),
			].sort(),
		);
	});
});
