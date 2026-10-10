import type { PositionEncoding, ScipDocument, ScipOccurrence } from "src/extraction/scip/scip-index";
import { type DescriptorSuffix, lastDescriptor, parseScipSymbol } from "src/extraction/scip/scip-symbol";

// documentation/adr/0056 decision 4: whether a document still describes the file on disk, judged by
// content, never by modification time. Stored text is compared exactly. Without it, an index the
// generator ran itself compares the file's content hash with the one recorded at index time.
// Without either, every occurrence naming a declaration must still sit on that declaration's name
// (the anchor check).

// Suffixes whose occurrence range covers exactly the descriptor's own name. A namespace or meta
// occurrence covers a module path instead (`app.storage` for `app.storage/__init__:`).
const ANCHORED_SUFFIXES: ReadonlySet<DescriptorSuffix> = new Set([
	"type",
	"term",
	"method",
	"parameter",
	"typeParameter",
	"macro",
]);

function sliceCharacters(line: string, start: number, end: number, encoding: PositionEncoding): string {
	switch (encoding) {
		case "utf8":
			return Buffer.from(line, "utf8").subarray(start, end).toString("utf8");
		case "utf32":
			return Array.from(line).slice(start, end).join("");
		case "utf16":
			return line.slice(start, end);
	}
}

// Whether one occurrence still matches the file. A local symbol, a module-path occurrence, a
// zero-width one, and one spanning lines carry no checkable name, so only their line must exist.
function isOccurrenceCurrent(occurrence: ScipOccurrence, lines: string[], encoding: PositionEncoding): boolean {
	const parsed = parseScipSymbol(occurrence.symbol);
	if (parsed?.kind === "local") return true;
	if (occurrence.endLine >= lines.length) return false;

	const descriptor = lastDescriptor(parsed);
	const isSingleLine = occurrence.startLine === occurrence.endLine;
	const isZeroWidth = isSingleLine && occurrence.startCharacter === occurrence.endCharacter;
	if (!descriptor || !ANCHORED_SUFFIXES.has(descriptor.suffix) || isZeroWidth || !isSingleLine) return true;

	const line = lines[occurrence.startLine] ?? "";
	return sliceCharacters(line, occurrence.startCharacter, occurrence.endCharacter, encoding) === descriptor.name;
}

export interface ContentHashes {
	recorded: string; // when the generator indexed the file
	current: string;
}

export function isDocumentCurrent(document: ScipDocument, sourceText: string, hashes?: ContentHashes): boolean {
	if (document.text !== undefined) return document.text === sourceText;
	if (hashes !== undefined) return hashes.recorded === hashes.current;

	const lines = sourceText.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
	return document.occurrences.every((occurrence) => isOccurrenceCurrent(occurrence, lines, document.positionEncoding));
}
