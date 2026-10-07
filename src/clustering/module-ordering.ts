import { isFileNode } from "src/clustering/graph-node-utils";
import type { ModuleSummary } from "src/clustering/module-naming";
import type { GraphEdge, GraphNode, ImportEdge } from "src/core/types";

function isImportEdge(edge: GraphEdge): edge is ImportEdge {
	return edge.kind === "static" && edge.type === "import";
}

// Ordinal (not locale-aware) comparison, matching `build-map-json.ts`'s own - required for the
// byte-identical-repeatability guarantee, so tie-breaking here never depends on the host's ICU
// locale either.
function compareStrings(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

function moduleIdByFileIdOf(nodes: GraphNode[]): Map<string, number> {
	const moduleIdByFileId = new Map<string, number>();
	for (const node of nodes) {
		if (isFileNode(node) && node.moduleId !== null) {
			moduleIdByFileId.set(node.id, node.moduleId);
		}
	}
	return moduleIdByFileId;
}

// Every distinct Module a given Module imports from (its prerequisites), derived from file-level
// import edges whose two endpoints belong to different Modules. An edge inside one Module, or
// touching an unassigned file, carries no ordering information between Modules and is excluded.
function dependenciesByModuleId(nodes: GraphNode[], edges: GraphEdge[]): Map<number, Set<number>> {
	const moduleIdByFileId = moduleIdByFileIdOf(nodes);

	const dependencies = new Map<number, Set<number>>();
	for (const edge of edges) {
		if (!isImportEdge(edge)) continue;
		const sourceModuleId = moduleIdByFileId.get(edge.source);
		const targetModuleId = moduleIdByFileId.get(edge.target);
		if (sourceModuleId === undefined || targetModuleId === undefined || sourceModuleId === targetModuleId) {
			continue;
		}
		const deps = dependencies.get(sourceModuleId) ?? new Set<number>();
		deps.add(targetModuleId);
		dependencies.set(sourceModuleId, deps);
	}
	return dependencies;
}

// Tarjan's algorithm: every maximal set of Modules that mutually depend on each other, directly or
// through a longer cycle, as one component. A composition root (e.g. this codebase's own `core/`,
// which both supplies shared types to its satellite Modules and wires their concrete
// implementations back in) routinely forms a real, multi-Module cycle this way - collapsing it to
// one component is what makes a strict "dependency before dependent" order possible at all, since
// a true cycle has no such order among its own members.
interface TarjanState {
	nextIndex: number;
	indexOf: Map<number, number>;
	lowlinkOf: Map<number, number>;
	onStack: Set<number>;
	stack: number[];
	components: number[][];
}

// Pops `v`'s own strongly connected component off the stack once `visit` below finds `v` is its
// component's root (its lowlink never reached further back than its own index).
function popComponent(state: TarjanState, v: number): void {
	const component: number[] = [];
	let popped: number | undefined;
	do {
		popped = state.stack.pop();
		if (popped === undefined) break;
		state.onStack.delete(popped);
		component.push(popped);
	} while (popped !== v);
	state.components.push(component);
}

function visitNeighbor(state: TarjanState, v: number, w: number, dependsOn: Map<number, Set<number>>): void {
	if (!state.indexOf.has(w)) {
		visit(state, w, dependsOn);
		state.lowlinkOf.set(v, Math.min(state.lowlinkOf.get(v) ?? 0, state.lowlinkOf.get(w) ?? 0));
	} else if (state.onStack.has(w)) {
		state.lowlinkOf.set(v, Math.min(state.lowlinkOf.get(v) ?? 0, state.indexOf.get(w) ?? 0));
	}
}

function visit(state: TarjanState, v: number, dependsOn: Map<number, Set<number>>): void {
	state.indexOf.set(v, state.nextIndex);
	state.lowlinkOf.set(v, state.nextIndex);
	state.nextIndex++;
	state.stack.push(v);
	state.onStack.add(v);

	for (const w of dependsOn.get(v) ?? []) {
		visitNeighbor(state, v, w, dependsOn);
	}

	if (state.lowlinkOf.get(v) === state.indexOf.get(v)) {
		popComponent(state, v);
	}
}

function stronglyConnectedComponents(moduleIds: number[], dependsOn: Map<number, Set<number>>): number[][] {
	const state: TarjanState = {
		nextIndex: 0,
		indexOf: new Map(),
		lowlinkOf: new Map(),
		onStack: new Set(),
		stack: [],
		components: [],
	};

	for (const id of moduleIds) {
		if (!state.indexOf.has(id)) visit(state, id, dependsOn);
	}

	return state.components;
}

// A component is ready to place once every *other* still-unplaced component any of its members
// depends on has already been placed. Ties among several ready components are broken by the
// alphabetically-earliest name among each component's own members, so the order never depends on
// Module id or input order, only on names and the dependency edges themselves. The condensation of
// a directed graph's strongly connected components is always itself acyclic, so - unlike ordering
// Modules directly - no cycle-breaking fallback is needed here; one is kept anyway as a defensive
// floor, the same way this codebase keeps `MIN_COMMUNITY_SIZE`'s floor even though its own library
// is never observed to need it (documentation/adr/0015).
// Whether any member of `componentId` depends on a Module belonging to a still-unplaced *other*
// component - i.e. whether this component has an unresolved prerequisite left.
function hasUnresolvedDependency(
	componentId: number,
	remaining: Set<number>,
	componentOf: Map<number, number>,
	dependsOn: Map<number, Set<number>>,
	components: Map<number, number[]>,
): boolean {
	for (const moduleId of components.get(componentId) ?? []) {
		for (const dep of dependsOn.get(moduleId) ?? []) {
			const depComponentId = componentOf.get(dep);
			if (depComponentId !== undefined && remaining.has(depComponentId)) {
				return true;
			}
		}
	}
	return false;
}

function pickNextComponent(
	remaining: Set<number>,
	componentOf: Map<number, number>,
	dependsOn: Map<number, Set<number>>,
	components: Map<number, number[]>,
	earliestNameOf: (componentId: number) => string,
): number | undefined {
	const ready = [...remaining].filter(
		(componentId) => !hasUnresolvedDependency(componentId, remaining, componentOf, dependsOn, components),
	);

	const pool = ready.length > 0 ? ready : [...remaining];
	pool.sort((a, b) => compareStrings(earliestNameOf(a), earliestNameOf(b)) || a - b);
	return pool[0];
}

// Orders Modules so a Module it depends on (imports from) is listed before it - mirroring how an
// agent would actually want to read a codemap: foundational pieces first, the things built on them
// after (documentation/adr/0039). Modules that mutually depend on each other (a composition root and its
// satellites, most often) are collapsed into one block via Tarjan's strongly-connected-components
// algorithm and ordered as a unit, since there's no meaningful "before" among them; within that
// block, and for any other tie between independently-ready Modules, order falls back to
// alphabetical by name. The result is fully deterministic: it depends only on the dependency edges
// and Module names, never on Module id or input order.
export function orderModulesByExecutionFlow(
	modules: ModuleSummary[],
	nodes: GraphNode[],
	edges: GraphEdge[],
): ModuleSummary[] {
	const byId = new Map(modules.map((module) => [module.id, module]));
	const moduleIds = modules.map((module) => module.id);
	const dependsOn = dependenciesByModuleId(nodes, edges);

	const sccs = stronglyConnectedComponents(moduleIds, dependsOn);
	const components = new Map<number, number[]>();
	const componentOf = new Map<number, number>();
	sccs.forEach((memberIds, componentId) => {
		components.set(componentId, memberIds);
		for (const moduleId of memberIds) componentOf.set(moduleId, componentId);
	});

	const nameOf = (id: number): string => byId.get(id)?.name ?? "";
	const earliestNameOf = (componentId: number): string =>
		(components.get(componentId) ?? []).map(nameOf).sort(compareStrings)[0] ?? "";

	const remaining = new Set(components.keys());
	const orderedComponentIds: number[] = [];
	while (remaining.size > 0) {
		const next = pickNextComponent(remaining, componentOf, dependsOn, components, earliestNameOf);
		if (next === undefined) break;
		orderedComponentIds.push(next);
		remaining.delete(next);
	}

	return orderedComponentIds.flatMap((componentId) => {
		const memberIds = (components.get(componentId) ?? [])
			.slice()
			.sort((a, b) => compareStrings(nameOf(a), nameOf(b)) || a - b);
		return memberIds.flatMap((id) => {
			const module = byId.get(id);
			return module === undefined ? [] : [module];
		});
	});
}
