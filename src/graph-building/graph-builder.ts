import type { DiscoveredStructure, ExtractedSymbols, RawGraph } from "src/core/types";

// A pure shape-assembler (documentation/adr/0003-generator-pipeline-seams.md): no filesystem or
// type-checker access of its own - `structure` already carries every Package/Directory/File
// boundary Discovery found, and `symbols` already carries already-resolved raw refs.
export interface GraphBuilder {
	build(symbols: ExtractedSymbols[], structure: DiscoveredStructure): RawGraph;
}
