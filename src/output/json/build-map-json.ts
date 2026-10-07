import { deriveModuleNames, type ModuleSummary } from "src/clustering/module-naming";
import { orderModulesByExecutionFlow } from "src/clustering/module-ordering";
import type { ClusteredGraph, GraphEdge, GraphNode, Language } from "src/core/types";

// SemVer for the shapes below: a breaking change bumps
// the major, an added field the minor.
// 1.2.0: top-level `languages` field lists every language actually detected in this run,
// mirroring ADR-0019's `modules` field.
// 1.3.0: top-level `warnings` field surfaces the run's skipped files (`GeneratedMap.skippedFiles`,
// formatted), now also inside the envelope itself (documentation/HLD.md's former milestone non-goal).
export const SCHEMA_VERSION = "1.3.0";

export interface MapJson {
	schemaVersion: string;
	nodes: GraphNode[];
	edges: GraphEdge[];
	modules: ModuleSummary[];
	languages: Language[];
	warnings: string[];
}

// Every language actually present in the final node set - File/Package/External are the only
// node kinds carrying a `language` (`SymbolNode`'s is resolved through its containing File, never
// duplicated onto the Symbol itself), sorted so this list, like every other array here, never
// depends on node insertion order.
function collectLanguages(nodes: GraphNode[]): Language[] {
	const languages = new Set<Language>();
	for (const node of nodes) {
		if (node.kind === "file" || node.kind === "package" || node.kind === "external") {
			languages.add(node.language);
		}
	}
	return [...languages].sort();
}

// Ordinal (not locale-aware) comparison so sort order never depends on the host's ICU locale -
// required for the byte-identical-repeatability guarantee (`map.md`'s Notes).
function compareStrings(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

// `DynamicEdgeStub` carries no `type` field; treated as the empty
// string for sort purposes so every edge shape has a comparable key.
function edgeTypeKey(edge: GraphEdge): string {
	return edge.kind === "dynamic" ? "" : edge.type;
}

function compareEdges(a: GraphEdge, b: GraphEdge): number {
	return (
		compareStrings(a.source, b.source) ||
		compareStrings(a.target, b.target) ||
		compareStrings(a.kind, b.kind) ||
		compareStrings(edgeTypeKey(a), edgeTypeKey(b))
	);
}

// Pure schema-shaping function:
// wraps an already-built `ClusteredGraph` in the versioned envelope and canonically sorts both
// arrays. Node/edge dedup and ambiguous-call fan-out already happened upstream in `GraphBuilder`
// (`DefaultGraphBuilder`'s own merge-by-natural-key logic) - this function never re-derives them.
// `modules` is ordered by dependency ("execution flow"), not by id or name directly - a Module it
// imports from is listed before it (`orderModulesByExecutionFlow`, documentation/adr/0039). `warnings` is
// already in deterministic order by the time it reaches here (`generateMap`'s own ordering, itself
// sourced from Discovery's order-independent walk) - never re-sorted here, so this function stays
// a pure pass-through for it, matching every other already-resolved field.
export function buildMapJson(graph: ClusteredGraph, warnings: string[] = []): MapJson {
	return {
		schemaVersion: SCHEMA_VERSION,
		nodes: [...graph.nodes].sort((a, b) => compareStrings(a.id, b.id)),
		edges: [...graph.edges].sort(compareEdges),
		modules: orderModulesByExecutionFlow(deriveModuleNames(graph.nodes), graph.nodes, graph.edges),
		languages: collectLanguages(graph.nodes),
		warnings,
	};
}
