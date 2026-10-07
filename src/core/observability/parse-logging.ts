import type { ParserLanguage } from "src/core/languages";
import type { Logger } from "src/core/observability/logger";
import type { Parser } from "src/extraction/parser";

// Wraps one language's Parser so each run logs how many of that language's files it extracted,
// how many it skipped as unparseable, and how long it took. A language with no files this run
// logs nothing.
export function withParseLogging(language: ParserLanguage, parser: Parser, logger: Logger): Parser {
	return {
		parse(rootDir, programFiles, extractFiles) {
			if (extractFiles.length === 0) {
				return parser.parse(rootDir, programFiles, extractFiles);
			}
			const startedAt = performance.now();
			const extracted = parser.parse(rootDir, programFiles, extractFiles);
			logger.info("parse complete", {
				language,
				files: extractFiles.length,
				extracted: extracted.length,
				skipped: extractFiles.length - extracted.length,
				durationMs: Math.round(performance.now() - startedAt),
			});
			return extracted;
		},
	};
}
