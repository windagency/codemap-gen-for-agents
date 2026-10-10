// The plain, validated shape every SCIP consumer in this directory works with. Only
// `scip-index-reader.ts` ever sees the Protobuf message types it is decoded from
// (documentation/adr/0056).

// How an occurrence's character offsets count: UTF-8 bytes, UTF-16 code units, or code points.
// An index that leaves it unspecified is read as UTF-16, what scip-python writes.
export type PositionEncoding = "utf8" | "utf16" | "utf32";

// Lines and characters are 0-based, as SCIP stores them; the schema's own lines are 1-based.
export interface ScipOccurrence {
	symbol: string;
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
	isDefinition: boolean;
}

export interface ScipDocument {
	relativePath: string; // relative to the index's project root, `/`-separated
	language: string; // often empty: scip-python never sets it
	text: string | undefined; // the source as indexed, when the indexer stored it
	positionEncoding: PositionEncoding;
	occurrences: ScipOccurrence[];
}

export interface ScipIndex {
	projectRoot: string; // a URI, as written by the indexer
	documents: ScipDocument[];
}
