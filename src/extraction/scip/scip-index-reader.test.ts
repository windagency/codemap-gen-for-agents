import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readScipIndex } from "src/extraction/scip/scip-index-reader";
import { describe, expect, it } from "vitest";

const FIXTURE_INDEX = path.resolve(import.meta.dirname, "..", "..", "..", "fixtures", "python-scip", "index.scip");

describe("readScipIndex", () => {
	it("decodes a real scip-python index into plain documents and occurrences", () => {
		const result = readScipIndex(FIXTURE_INDEX);
		if (!result.ok) throw new Error(result.reason);

		expect(result.index.projectRoot).toBe("file:///python-scip");
		expect(result.index.documents.map((document) => document.relativePath).sort()).toStrictEqual([
			"app/__init__.py",
			"app/legacy.py",
			"app/service.py",
			"app/storage.py",
		]);

		const service = result.index.documents.find((document) => document.relativePath === "app/service.py");
		expect(service?.positionEncoding).toBe("utf16");
		expect(service?.text).toBeUndefined();
		expect(service?.occurrences).toContainEqual({
			symbol: "scip-python python python-scip 0.1.0 `app.storage`/FileStore#save().",
			startLine: 5,
			startCharacter: 10,
			endLine: 5,
			endCharacter: 14,
			isDefinition: false,
		});
		expect(service?.occurrences).toContainEqual({
			symbol: "scip-python python python-scip 0.1.0 `app.service`/run().",
			startLine: 3,
			startCharacter: 4,
			endLine: 3,
			endCharacter: 7,
			isDefinition: true,
		});
	});

	it("reports a missing file instead of throwing", () => {
		const result = readScipIndex(path.join(os.tmpdir(), "codemap-no-such-index.scip"));

		expect(result).toMatchObject({ ok: false });
	});

	it("reports a file that is not a SCIP index instead of throwing", () => {
		const garbage = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codemap-scip-")), "index.scip");
		fs.writeFileSync(garbage, Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f]));

		expect(readScipIndex(garbage)).toMatchObject({ ok: false });
	});
});
