import type { ClusteredGraph, RawGraph } from "src/core/types";

export interface ModuleDetector {
	detect(graph: RawGraph): ClusteredGraph;
}
