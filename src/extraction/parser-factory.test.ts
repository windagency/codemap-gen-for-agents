import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stands in for `tree-sitter-java`'s native binding failing to load, the Linux arm64 prebuild
// case from README.md's "Linux on arm64" note.
vi.mock("tree-sitter-java", () => {
	throw new Error("tree-sitter-java native binding failed to load");
});

let rootDir: string;

beforeEach(() => {
	rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-parser-factory-"));
});

afterEach(() => {
	fs.rmSync(rootDir, { recursive: true, force: true });
});

describe("createParserFactory", () => {
	it("parses a Go-only repository even when the Java grammar cannot load", async () => {
		const filePath = path.join(rootDir, "main.go");
		fs.writeFileSync(filePath, "package main\n\nfunc main() {}\n");

		const { createParserFactory } = await import("src/extraction/parser-factory");
		const results = createParserFactory().createParser("go").parse(rootDir, [filePath], [filePath]);

		expect(results.map((extracted) => extracted.filePath)).toStrictEqual([filePath]);
	});

	// `createCompositeParser` hands every registered Parser its partition, so a repository with no
	// Java still runs the Java Parser, on empty file lists.
	it("runs the Java parser on an empty partition without loading its grammar", async () => {
		const { createParserFactory } = await import("src/extraction/parser-factory");

		expect(createParserFactory().createParser("java").parse(rootDir, [], [])).toStrictEqual([]);
	});
});
