// Flow view's cycle-safe import-chain BFS:
// starting from a clicked File, walks only real `source -> target` import edges outward in BFS
// order, numbering each edge as it's first traversed. A visited set guards every enqueue, so a
// real import cycle terminates instead of looping and each node is visited/numbered exactly once.
// Self-contained (no calls to other project functions) so its compiled JS body can be embedded
// verbatim into the generated HTML via `computeImportChain.toString()`.
export interface ImportChainEdge {
	source: string;
	target: string;
	specifier: string;
}

export interface ImportChainResult {
	visitedOrder: string[]; // includes the start node first, each id exactly once
	edgeOrder: ImportChainEdge[]; // the traversed edges, in the order they were first followed
}

export function computeImportChain(startId: string, edges: ImportChainEdge[]): ImportChainResult {
	const visited = new Set<string>([startId]);
	const visitedOrder = [startId];
	const edgeOrder: ImportChainEdge[] = [];
	const queue = [startId];

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) continue;
		for (const edge of edges) {
			if (edge.source !== current || visited.has(edge.target)) continue;
			visited.add(edge.target);
			visitedOrder.push(edge.target);
			edgeOrder.push(edge);
			queue.push(edge.target);
		}
	}

	return { visitedOrder, edgeOrder };
}
