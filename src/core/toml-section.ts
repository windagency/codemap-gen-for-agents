// Deliberately not a general TOML parser (no dependency added for it, mirroring
// `read-package-json-field.ts`'s own narrow-purpose-reader precedent): both Cargo.toml readers
// this repo needs - Discovery's package-boundary detection and the Rust Parser's `[dependencies]`
// lookup - only ever need "does this named top-level table exist, and what's inside it", so a
// crude section-by-header-line scan is adequate and shared here rather than duplicated.
export function findTomlSection(content: string, sectionName: string): string | undefined {
	const lines = content.split("\n");
	const header = `[${sectionName}]`;
	const startIndex = lines.findIndex((line) => line.trim() === header);
	if (startIndex === -1) return undefined;

	const sectionLines: string[] = [];
	for (let i = startIndex + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (/^\s*\[/.test(line)) break;
		sectionLines.push(line);
	}
	return sectionLines.join("\n");
}

export function extractQuotedField(sectionText: string, field: string): string | undefined {
	const match = sectionText.match(new RegExp(`^\\s*${field}\\s*=\\s*"([^"]*)"`, "m"));
	return match?.[1];
}

// Reads a TOML array-of-strings field (e.g. pyproject.toml's PEP 621 `dependencies = [...]`),
// however many lines the array itself spans - added alongside `extractQuotedField` rather than
// reaching for a general TOML parser, same rationale as this file's own header comment. Only the
// quoted string entries are collected; a non-string element (never valid for a dependency list)
// is silently skipped rather than rejected outright.
export function extractStringArrayField(sectionText: string, field: string): string[] {
	const match = sectionText.match(new RegExp(`^\\s*${field}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m"));
	if (!match?.[1]) return [];
	return [...match[1].matchAll(/"([^"]*)"/g)].map((entry) => entry[1] ?? "");
}
