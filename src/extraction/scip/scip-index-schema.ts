import type { PositionEncoding, ScipIndex, ScipOccurrence } from "src/extraction/scip/scip-index";
import { z } from "zod";

// A decoded SCIP index is external input (`CONTRIBUTING.md`): Protobuf decoding only proves the
// bytes were well-formed, not that ranges, paths, and encodings make sense.

// `SymbolRole.Definition` in `scip.proto`.
const DEFINITION_ROLE = 0x1;

// `PositionEncoding` in `scip.proto`: 0 unspecified, 1 UTF-8, 2 UTF-16, 3 UTF-32.
const POSITION_ENCODINGS: readonly PositionEncoding[] = ["utf16", "utf8", "utf16", "utf32"];

const lineOrCharacter = z.number().int().nonnegative();

// A range is `[line, startCharacter, endCharacter]` on one line, or
// `[startLine, startCharacter, endLine, endCharacter]` across lines.
const occurrenceSchema = z
	.object({
		range: z
			.array(lineOrCharacter)
			.refine((range) => range.length === 3 || range.length === 4, "a range has 3 or 4 elements"),
		symbol: z.string().min(1),
		symbolRoles: z.number().int(),
	})
	.transform(({ range, symbol, symbolRoles }): ScipOccurrence => {
		const [startLine = 0, startCharacter = 0, third = 0, fourth] = range;
		return {
			symbol,
			startLine,
			startCharacter,
			endLine: fourth === undefined ? startLine : third,
			endCharacter: fourth ?? third,
			isDefinition: (symbolRoles & DEFINITION_ROLE) !== 0,
		};
	});

const documentSchema = z.object({
	relativePath: z.string().min(1),
	language: z.string(),
	text: z.string(),
	positionEncoding: z.number().int().min(0).max(3),
	occurrences: z.array(occurrenceSchema),
});

const indexSchema = z.object({
	projectRoot: z.string(),
	documents: z.array(documentSchema),
});

export type UnvalidatedScipIndex = z.input<typeof indexSchema>;

export function parseScipIndex(
	raw: UnvalidatedScipIndex,
): { ok: true; index: ScipIndex } | { ok: false; reason: string } {
	const result = indexSchema.safeParse(raw);
	if (!result.success) {
		const issue = result.error.issues[0];
		return {
			ok: false,
			reason: `invalid SCIP index at ${issue?.path.join(".") ?? "<root>"}: ${issue?.message ?? "unknown"}`,
		};
	}
	return {
		ok: true,
		index: {
			projectRoot: result.data.projectRoot,
			documents: result.data.documents.map((document) => ({
				relativePath: document.relativePath,
				language: document.language,
				text: document.text.length > 0 ? document.text : undefined,
				positionEncoding: POSITION_ENCODINGS[document.positionEncoding] ?? "utf16",
				occurrences: document.occurrences,
			})),
		},
	};
}
