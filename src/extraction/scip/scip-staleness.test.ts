import type { ScipDocument, ScipOccurrence } from "src/extraction/scip/scip-index";
import { isDocumentCurrent } from "src/extraction/scip/scip-staleness";
import { describe, expect, it } from "vitest";

const SOURCE = ["def load(path):", "    return path", "", "load('x')", ""].join("\n");

function occurrence(
	symbol: string,
	line: number,
	startCharacter: number,
	endCharacter: number,
	isDefinition: boolean,
): ScipOccurrence {
	return { symbol, startLine: line, startCharacter, endLine: line, endCharacter, isDefinition };
}

function documentOf(occurrences: ScipOccurrence[], text?: string): ScipDocument {
	return { relativePath: "app/m.py", language: "", text, positionEncoding: "utf16", occurrences };
}

const LOAD = "scip-python python p 1 `app.m`/load().";

describe("isDocumentCurrent", () => {
	it("compares the stored text exactly when the index carries it", () => {
		expect(isDocumentCurrent(documentOf([], SOURCE), SOURCE)).toBe(true);
		expect(isDocumentCurrent(documentOf([], SOURCE), `${SOURCE}# edited\n`)).toBe(false);
	});

	it("accepts a document whose definitions and references still land on their names", () => {
		const document = documentOf([
			occurrence("scip-python python p 1 `app.m`/__init__:", 0, 0, 0, true),
			occurrence(LOAD, 0, 4, 8, true),
			occurrence(`${LOAD.slice(0, -1)}.(path)`, 0, 9, 13, true),
			occurrence(LOAD, 3, 0, 4, false),
			occurrence("local 0", 1, 11, 15, false),
		]);

		expect(isDocumentCurrent(document, SOURCE)).toBe(true);
	});

	it("rejects a document once an edit shifts a definition off its name", () => {
		const document = documentOf([occurrence(LOAD, 0, 4, 8, true), occurrence(LOAD, 3, 0, 4, false)]);
		const shifted = `# a new first line\n${SOURCE}`;

		expect(isDocumentCurrent(document, shifted)).toBe(false);
	});

	// rust-analyzer anchors an operator-trait method on its operator, and an impl's own type on `Self`.
	it("skips an occurrence that sits on an operator, whitespace, or Self instead of a name", () => {
		const source = [
			"impl Disk {",
			"    fn ready(&self) -> bool {",
			"        !self.empty() && Self::check()",
			"    }",
			"}",
		].join("\n");
		const ready = "rust-analyzer cargo p 0.1.0 impl#[Disk]ready().";
		const not = "rust-analyzer cargo core https://github.com/rust-lang/rust/library/core ops/bit/Not#not().";
		const document = {
			...documentOf([
				occurrence(ready, 1, 7, 12, true),
				occurrence(not, 2, 8, 9, false),
				occurrence(not, 2, 21, 22, false),
				occurrence("rust-analyzer cargo p 0.1.0 impl#[Disk]", 2, 25, 29, false),
			]),
			relativePath: "src/disk.rs",
		};

		expect(isDocumentCurrent(document, source)).toBe(true);
		expect(isDocumentCurrent(document, source.replace("fn ready", "fn steady"))).toBe(false);
	});

	it("rejects a document whose occurrence points past the end of the file", () => {
		expect(isDocumentCurrent(documentOf([occurrence(LOAD, 40, 0, 4, false)]), SOURCE)).toBe(false);
	});

	it("measures characters in the document's own position encoding", () => {
		const source = "x = 'é'; load('x')";
		const utf8 = { ...documentOf([occurrence(LOAD, 0, 10, 14, false)]), positionEncoding: "utf8" as const };
		const utf16 = documentOf([occurrence(LOAD, 0, 9, 13, false)]);

		expect(isDocumentCurrent(utf8, source)).toBe(true);
		expect(isDocumentCurrent(utf16, source)).toBe(true);
	});

	it("trusts a recorded content hash over the anchor check when the generator ran the indexer", () => {
		const anchored = documentOf([occurrence(LOAD, 0, 4, 8, true)]);
		const shifted = `# a new first line\n${SOURCE}`;

		expect(isDocumentCurrent(anchored, shifted, { recorded: "abc", current: "abc" })).toBe(true);
		expect(isDocumentCurrent(anchored, SOURCE, { recorded: "abc", current: "def" })).toBe(false);
	});

	it("still compares stored text first when a recorded hash is also present", () => {
		expect(isDocumentCurrent(documentOf([], SOURCE), `${SOURCE}# edited\n`, { recorded: "abc", current: "abc" })).toBe(
			false,
		);
	});
});
