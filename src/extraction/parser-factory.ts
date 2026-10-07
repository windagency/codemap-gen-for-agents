import type { ParserLanguage } from "src/core/languages";
import type { Parser } from "src/extraction/parser";
import { GoTreeSitterParser } from "src/extraction/tree-sitter-go/go-parser";
import { JavaTreeSitterParser } from "src/extraction/tree-sitter-java/java-parser";
import { PythonTreeSitterParser } from "src/extraction/tree-sitter-python/python-parser";
import { RustTreeSitterParser } from "src/extraction/tree-sitter-rust/rust-parser";
import { TsCompilerApiParser } from "src/extraction/ts-compiler-api/ts-compiler-api-parser";

export interface ParserFactory {
	createParser(language: ParserLanguage): Parser;
}

const parsersByParserLanguage: Record<ParserLanguage, () => Parser> = {
	typescript: () => new TsCompilerApiParser(),
	go: () => new GoTreeSitterParser(),
	rust: () => new RustTreeSitterParser(),
	java: () => new JavaTreeSitterParser(),
	python: () => new PythonTreeSitterParser(),
};

export function createParserFactory(): ParserFactory {
	return {
		createParser(language: ParserLanguage): Parser {
			return parsersByParserLanguage[language]();
		},
	};
}
