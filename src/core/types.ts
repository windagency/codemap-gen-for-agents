// Pipeline stage types shared across every slice: extraction -> graph-building -> clustering -> output.
// GraphNode/GraphEdge mirror the map JSON schema; the
// schema-shaping module that wraps them into the versioned envelope is
// `src/output/json/build-map-json.ts`. These shapes live here so RawGraph/ClusteredGraph have
// something concrete to carry between seams.

// File/Package/External nodes' `language` tag:
// "typescript"/"javascript" split at the File level even though one Parser handles both, since an
// agent filtering to just `.js` files needs that distinction - Package/External stay one value per
// node (an npm Package's own `.ts`/`.js` file mix is a File-level distinction, not a Package one).
export type Language = "typescript" | "javascript" | "go" | "rust" | "java" | "python";

// `Language`'s member list as a runtime value, for the same reason `SYMBOL_KINDS` exists below:
// a `z.enum` validator has to enumerate the values, and `satisfies` fails to compile on drift.
export const LANGUAGES = [
	"typescript",
	"javascript",
	"go",
	"rust",
	"java",
	"python",
] as const satisfies readonly Language[];

// Shape fixed upstream:
// all checker-dependent resolution happens inside `Parser`, so `imports`/`calls` already carry
// resolved (but not yet schema-id-formatted) targets by the time they reach `GraphBuilder`.
export interface ExtractedSymbols {
	filePath: string; // repo-relative, matches the File node id
	symbols: RawSymbol[];
	imports: RawImport[];
	calls: RawCall[];
	// Set when a SCIP index was supplied for this file's language but could not be used for this
	// file, so its calls kept tree-sitter's candidates (documentation/adr/0056). Stored here, not
	// recomputed, so a cached file keeps reporting its fallback. Never read by `GraphBuilder`.
	indexFallback?: IndexFallbackReason;
}

// "index-stale": the file changed since it was indexed. "index-uncovered": the index has no
// document for the file.
export type IndexFallbackReason = "index-stale" | "index-uncovered";

export interface RawSymbol {
	localId: string; // name with a #2/#3 suffix already applied - becomes the Symbol id's fragment after `${filePath}#`
	name: string; // original declared name, no suffix
	symbolKind: SymbolKind;
	startLine: number;
	endLine: number;
	exported: boolean;
	// Rust-only, item-granularity test marker (`#[cfg(test)]` modules / `#[test]`-attributed
	// functions) - never read by `GraphBuilder`/`SymbolNode` (Module stays per-File, not
	// per-Symbol, per the multi-language-support spec's resolved domain-model question).
	// `generate-map.ts` strips a tagged symbol (and any call naming it) post-extraction when
	// `--include-tests` is off, mirroring the file-granularity exclusion Go/Java/TS already get
	// from Discovery - the one seam that lets a fixed 3-argument `Parser.parse` stay fixed while
	// still supporting Rust's item-granularity convention.
	isTestItem?: boolean;
}

// `language` on the "external" branch names the *dependency's* ecosystem (Go/Rust/Java/npm),
// always set by whichever Parser resolved the import - never inferred from `packageName`'s shape,
// since e.g. a bare Rust crate name and an npm package name look identical.
export type ResolvedImportTarget =
	| { kind: "file"; filePath: string }
	| {
			kind: "external";
			packageName: string;
			version: string;
			language: Language;
	  }
	| { kind: "unresolved" };

export interface RawImport {
	specifier: string; // raw, as written
	viaReExport: boolean; // true iff this is a named re-export statement (`export { x } from './y'`)
	resolvedTarget: ResolvedImportTarget;
	locations: EdgeLocation[];
}

export interface RawCallCandidate {
	filePath: string;
	localId: string;
}

export interface RawCall {
	callerLocalId: string; // which RawSymbol in this file's `symbols` the call site occurs inside
	candidates: RawCallCandidate[]; // one or more resolved callee declarations; >1 means ambiguous dispatch
	locations: EdgeLocation[];
}

// Discovery's output:
// computed purely from the filesystem, independently of any file's content, so it doesn't
// originate from Parser/ExtractedSymbols at all.
export interface DiscoveredPackage {
	id: string; // repo-relative path to the manifest's directory ("." for the repo root)
	name: string; // the manifest's own declared name, falls back to the directory's basename if absent
	language: Language; // the manifest kind's ecosystem - package.json is always "typescript" (never "javascript"), matching parserFactory's own npm-family conflation
}

export interface DiscoveredDirectory {
	id: string; // repo-relative directory path
	packageId: string; // owning Package's id
}

export interface DiscoveredStructure {
	programFiles: string[]; // every matched source file, repo-relative paths
	packages: DiscoveredPackage[];
	directories: DiscoveredDirectory[]; // lazily materialised - only ones with a descendant File
	fileOwners: Record<string, { packageId: string; directoryId: string | null }>; // keyed by a programFiles entry
	// Otherwise-eligible files dropped because they had no ancestor `package.json` anywhere above
	// them (documentation/adr/0002's "Update" section) - never in `programFiles`/`fileOwners`, surfaced here
	// purely for the orchestrator to report as a warning.
	manifestlessFiles: string[];
}

export type UnassignedReason =
	| "isolated"
	| "undersized"
	| "low-embeddedness"
	| "degenerate-partition"
	// A known build-tooling config file (`src/core/config-file.ts`'s `isConfigFile`,
	// documentation/adr/0048) - excluded from clustering by category before `classify()` ever runs, so
	// it needs its own reason distinct from the four above, which are only ever produced by
	// `classify()` or the reconciliation passes that follow it.
	| "config";

export type SymbolKind = "function" | "method" | "class" | "const" | "type" | "interface" | "enum";

// Single source of truth for `SymbolKind`'s member list as a runtime value (a literal tuple,
// not just the union type) - needed anywhere a `z.enum`/CLI flag validator has to enumerate the
// values rather than just type-check against them. `satisfies` fails to compile if this ever
// drifts from the `SymbolKind` union above. Both `core/cli-args.ts` and
// `integration/mcp/server.ts` import this instead of hand-duplicating the tuple.
export const SYMBOL_KINDS = [
	"function",
	"method",
	"class",
	"const",
	"type",
	"interface",
	"enum",
] as const satisfies readonly SymbolKind[];

export interface PackageNode {
	id: string;
	kind: "package";
	name: string;
	language: Language;
}

export interface DirectoryNode {
	id: string;
	kind: "directory";
	name: string;
}

export interface FileNode {
	id: string;
	kind: "file";
	name: string;
	extension: string;
	language: Language;
	moduleId: number | null;
	unassignedReason: UnassignedReason | null;
}

export interface SymbolNode {
	id: string;
	kind: "symbol";
	name: string;
	symbolKind: SymbolKind;
	startLine: number;
	endLine: number;
	exported: boolean;
}

export interface ExternalNode {
	id: string;
	kind: "external";
	// Language-native coordinate, not always npm-shaped: Java's is the compound `group:artifact`
	// (load-bearing - two different groups can legitimately publish the same bare artifact name).
	name: string;
	version: string;
	language: Language;
}

export type GraphNode = PackageNode | DirectoryNode | FileNode | SymbolNode | ExternalNode;

export interface EdgeLocation {
	startLine: number;
	endLine: number;
}

export interface ImportEdge {
	source: string;
	target: string;
	kind: "static";
	type: "import";
	specifier: string;
	viaReExport: boolean;
	locations: EdgeLocation[];
}

export interface CallEdge {
	source: string;
	target: string;
	kind: "static";
	type: "call";
	locations: EdgeLocation[];
}

export interface DynamicEdgeStub {
	source: string;
	target: string;
	kind: "dynamic";
}

export type GraphEdge = ImportEdge | CallEdge | DynamicEdgeStub;

export interface RawGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export interface ClusteredGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}
