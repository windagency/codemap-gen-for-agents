// Client-side AND-filter engine:
// same three-facet semantics as `src/core/filter-graph.ts`'s `matchesNode`, but exposed as a
// standalone, dependency-free predicate - no ancestor expansion, no edge restriction - since both
// screens only need a per-node "is this currently filter-matched" query to drive opacity, never a
// pruned graph. Deliberately self-contained (no calls to other project functions) so its compiled
// JS body can be embedded verbatim into the generated HTML's client-side `<script>` via
// `matchesFilterNode.toString()`, guaranteeing the unit-tested logic is exactly what ships.
export interface FilterableNode {
	id: string;
	kind: string;
	name: string;
	symbolKind?: string;
	language?: string;
}

export interface HtmlGraphFilters {
	path?: string;
	symbolKind?: string;
	search?: string;
	language?: string;
}

// A Symbol node carries no `language` of its own (resolved through its containing File, the same
// way `SymbolNode` never duplicates it in the JSON schema) - `nodesById` lets this facet resolve
// that lookup without every caller pre-denormalising it onto every Symbol datum. Optional (not a
// hard dependency of this otherwise-standalone predicate) so a caller with no language filter
// active, or no map handy, never has to supply one.
export function matchesFilterNode(
	node: FilterableNode,
	filters: HtmlGraphFilters,
	nodesById?: Map<string, FilterableNode>,
): boolean {
	// Nested function declarations (not module-level ones) deliberately: this file's own header
	// comment requires `matchesFilterNode` to call nothing outside itself, since only its own
	// `.toString()` output - not the rest of this module - ships into the generated HTML.
	function fileIdOf(n: FilterableNode): string {
		return n.kind === "symbol" ? (n.id.split("#")[0] ?? n.id) : n.id;
	}

	function languageOf(n: FilterableNode): string | undefined {
		return n.kind === "symbol" ? nodesById?.get(fileIdOf(n))?.language : n.language;
	}

	// npm's one package.json owns both TypeScript and JavaScript files.
	function familyOf(language: string | undefined): string | undefined {
		return language === "typescript" || language === "javascript" ? "npm" : language;
	}

	// A Package id is its directory, suffixed `@<family>` when two manifests share it (`.@go`).
	function splitFamily(id: string): { dir: string; family?: string } {
		const at = id.lastIndexOf("@");
		const family = id.slice(at + 1);
		return at > 0 && /^(npm|go|rust|java|python)$/.test(family) ? { dir: id.slice(0, at), family } : { dir: id };
	}

	function matchesPath(pathFilter: string): boolean {
		const scope = splitFamily(pathFilter);
		const location = splitFamily(fileIdOf(node)).dir;
		const isUnder = scope.dir === "." || location === scope.dir || location.startsWith(`${scope.dir}/`);
		return isUnder && (scope.family === undefined || familyOf(languageOf(node)) === scope.family);
	}

	const facets = [
		() => !filters.path || matchesPath(filters.path),
		() => !filters.symbolKind || (node.kind === "symbol" && node.symbolKind === filters.symbolKind),
		() => !filters.language || languageOf(node) === filters.language,
		() => !filters.search || node.name.toLowerCase().includes(filters.search.toLowerCase()),
	];
	return facets.every((facet) => facet());
}
