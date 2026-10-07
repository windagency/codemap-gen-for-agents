import { extensionOf, familyOfExtension, PARSER_LANGUAGE_BY_FAMILY, type ParserLanguage } from "src/core/languages";
import type { ExtractedSymbols } from "src/core/types";
import type { Parser } from "src/extraction/parser";

// Wired at `compose.ts`'s `createDefaultPipeline()` in place of a single language's Parser:
// partitions the file lists Discovery hands
// it by extension, delegates each partition to that language's registered Parser - so, e.g., the
// TS/JS Parser only ever sees TS/JS files as its own "whole program", never a stray `.go` file -
// and merges the resulting `ExtractedSymbols[]` arrays before `GraphBuilder` ever sees them. The
// external `Parser` interface is otherwise unchanged: this is itself just another `Parser`.
export function createCompositeParser(parsersByLanguage: Record<ParserLanguage, Parser>): Parser {
	return {
		parse(rootDir: string, programFiles: string[], extractFiles: string[]): ExtractedSymbols[] {
			const isParsedBy = (language: ParserLanguage) => (filePath: string) => {
				const family = familyOfExtension(extensionOf(filePath));
				return family !== undefined && PARSER_LANGUAGE_BY_FAMILY[family] === language;
			};
			return (Object.entries(parsersByLanguage) as [ParserLanguage, Parser][]).flatMap(([language, parser]) => {
				const partitionedProgramFiles = programFiles.filter(isParsedBy(language));
				const partitionedExtractFiles = extractFiles.filter(isParsedBy(language));
				return parser.parse(rootDir, partitionedProgramFiles, partitionedExtractFiles);
			});
		},
	};
}
