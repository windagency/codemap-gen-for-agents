import type { ParserLanguage } from "src/core/languages";
import { createCompositeParser } from "src/extraction/composite-parser";
import type { Parser } from "src/extraction/parser";
import { describe, expect, it } from "vitest";

function fakeParser(language: ParserLanguage): Parser & {
	received: { programFiles: string[]; extractFiles: string[] }[];
} {
	const received: { programFiles: string[]; extractFiles: string[] }[] = [];
	return {
		received,
		parse: (_rootDir, programFiles, extractFiles) => {
			received.push({ programFiles, extractFiles });
			return extractFiles.map((filePath) => ({
				filePath: `${language}:${filePath}`,
				symbols: [],
				imports: [],
				calls: [],
			}));
		},
	};
}

describe("createCompositeParser", () => {
	it("partitions programFiles/extractFiles by extension, delegating each partition to its own language's Parser", () => {
		const typescript = fakeParser("typescript");
		const go = fakeParser("go");
		const rust = fakeParser("rust");
		const java = fakeParser("java");
		const python = fakeParser("python");
		const parser = createCompositeParser({
			typescript,
			go,
			rust,
			java,
			python,
		});

		parser.parse(
			"/repo",
			["a.ts", "b.go", "c.rs", "d.java", "e.tsx", "f.jsx", "g.mjs", "h.cjs", "i.py"],
			["a.ts", "b.go"],
		);

		expect(typescript.received).toStrictEqual([
			{
				programFiles: ["a.ts", "e.tsx", "f.jsx", "g.mjs", "h.cjs"],
				extractFiles: ["a.ts"],
			},
		]);
		expect(go.received).toStrictEqual([{ programFiles: ["b.go"], extractFiles: ["b.go"] }]);
		expect(rust.received).toStrictEqual([{ programFiles: ["c.rs"], extractFiles: [] }]);
		expect(java.received).toStrictEqual([{ programFiles: ["d.java"], extractFiles: [] }]);
		expect(python.received).toStrictEqual([{ programFiles: ["i.py"], extractFiles: [] }]);
	});

	it("merges every language's ExtractedSymbols[] into one flat array", () => {
		const typescript = fakeParser("typescript");
		const go = fakeParser("go");
		const rust = fakeParser("rust");
		const java = fakeParser("java");
		const python = fakeParser("python");
		const parser = createCompositeParser({
			typescript,
			go,
			rust,
			java,
			python,
		});

		const result = parser.parse("/repo", ["a.ts", "b.go"], ["a.ts", "b.go"]);

		expect(result.map((r) => r.filePath).sort()).toStrictEqual(["go:b.go", "typescript:a.ts"]);
	});
});
