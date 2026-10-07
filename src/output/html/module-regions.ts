// Force-directed view's Module-region assignment:
// named "region" (never "cluster") to avoid colliding with `CONTEXT.md`'s Cluster. A Symbol's
// region follows its owning File's Module; unassigned Files and External nodes each land in their
// own distinct region rather than sharing one. Self-contained (no calls to other project
// functions) so its compiled JS body can be embedded verbatim into the generated HTML via
// `computeRegionId.toString()`.
export interface RegionableNode {
	id: string;
	kind: string;
	moduleId?: number | null;
}

// `computeRegionId`'s body inlines its "region:unassigned"/"region:external" literals rather than
// referencing the constants below: this function's compiled source is embedded verbatim into the
// generated HTML via `.toString()`, which captures the function body only, never the closed-over
// module-level bindings it might otherwise reference.
export const UNASSIGNED_REGION_ID = "region:unassigned";
export const EXTERNAL_REGION_ID = "region:external";

export function computeRegionId(node: RegionableNode, fileModuleById: Map<string, number | null>): string {
	// Per-kind lookup rather than a cascading if/else chain on `node.kind` (CODING_RULES/03-
	// typescript.md's "object literal lookup over switch/if-else"). Declared inside the function
	// body, closing only over this call's own `node`/`fileModuleById` parameters, so it stays
	// self-contained (see the module comment above on why this function's compiled source is
	// embedded verbatim via `.toString()` and can't reference outside module-level bindings).
	const regionIdForModuleId = (moduleId: number | null | undefined): string =>
		moduleId === null || moduleId === undefined ? "region:unassigned" : `region:module-${moduleId}`;

	const regionIdByKind: Record<string, () => string> = {
		external: () => "region:external",
		file: () => regionIdForModuleId(node.moduleId),
		symbol: () => regionIdForModuleId(fileModuleById.get(node.id.split("#")[0] ?? "")),
	};

	const resolve = regionIdByKind[node.kind];
	return resolve ? resolve() : "region:unassigned";
}
