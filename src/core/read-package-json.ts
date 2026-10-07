import fs from "node:fs";
import path from "node:path";

// Reads and JSON-parses `<dir>/package.json`, then hands the result to `parse` (one of
// `manifest-schema.ts`'s validators). A missing file, malformed JSON, or a shape `parse` rejects
// all come back `undefined`: a partial package.json is a real-world manifest to fall back past,
// not something worth throwing over.
export function readPackageJson<T>(dir: string, parse: (raw: unknown) => T | undefined): T | undefined {
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
		return parse(raw);
	} catch {
		return undefined;
	}
}
