import fs from "node:fs";
import { fromBinary } from "@bufbuild/protobuf";
import { IndexSchema } from "@scip-code/scip";
import type { ScipIndex } from "src/extraction/scip/scip-index";
import { parseScipIndex } from "src/extraction/scip/scip-index-schema";

// The one module that imports the SCIP Protobuf binding (documentation/adr/0056, enforced by the
// dependency-direction test). Decodes the whole file at once: the schema recommends streaming
// for large indexes, deferred until a real repo needs it.
export type ScipIndexRead = { ok: true; index: ScipIndex } | { ok: false; reason: string };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function readScipIndex(indexPath: string): ScipIndexRead {
	let bytes: Buffer;
	try {
		bytes = fs.readFileSync(indexPath);
	} catch (error) {
		return { ok: false, reason: `cannot read: ${errorMessage(error)}` };
	}

	let decoded: ReturnType<typeof fromBinary<typeof IndexSchema>>;
	try {
		decoded = fromBinary(IndexSchema, bytes);
	} catch (error) {
		return { ok: false, reason: `not a SCIP index: ${errorMessage(error)}` };
	}

	return parseScipIndex({
		projectRoot: decoded.metadata?.projectRoot ?? "",
		documents: decoded.documents.map((document) => ({
			relativePath: document.relativePath,
			language: document.language,
			text: document.text,
			positionEncoding: document.positionEncoding,
			occurrences: document.occurrences.map((occurrence) => ({
				range: occurrence.range,
				symbol: occurrence.symbol,
				symbolRoles: occurrence.symbolRoles,
			})),
		})),
	});
}
