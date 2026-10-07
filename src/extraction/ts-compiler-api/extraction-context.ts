import type { RawSymbol } from "src/core/types";
import type { Node } from "typescript/unstable/ast";

// The cache/index shapes threaded through nearly every extraction helper in this directory,
// pulled out here so each concern's own module (import resolution, call resolution, nominal
// dispatch) can depend on just the shape it owns without importing back from a module that in
// turn depends on it.

export interface PackageManifest {
	name: string;
	version: string;
}

// Memoised per resolved package directory, shared across every file `Parser.parse` extracts
// in one call.
export type ManifestCache = Map<string, PackageManifest | undefined>;

// Directory -> every dependency its package.json declares, memoised because each unresolved
// bare import walks the same ancestors.
export type DeclaredDependenciesCache = Map<string, Record<string, string> | undefined>;

// Per-file table of already-classified Symbols, keyed by each RawSymbol's own declaration `Node`
// (module-top-level function/const-function/class declaration, or a direct class-member method -
// the exact same set symbol classification produces). Built once per file and memoised in
// `TableCache` across the whole `parse()` call, since a call's target file is frequently *not*
// the same file being extracted (a cross-file call) and may not even be in `extractFiles` this
// run - but its `SourceFile` is always reachable through the shared whole-program `ts.Program`
// (documentation/adr/0003), so its Symbol table can always be computed on demand regardless.
export interface FileSymbolTable {
	filePath: string;
	rawSymbols: RawSymbol[];
	bySymbolNode: Map<Node, RawSymbol>;
}

export type TableCache = Map<string, FileSymbolTable>;

// `symbolId -> methodName -> concrete implementing declarations`, built once per `parse()` call
// by walking every class's heritage clauses, and reused across every call site in this run
// rather than rescanned per site.
export type NominalIndex = Map<number, Map<string, Node[]>>;

// Bundles the state threaded through nearly every extraction helper in this directory into a
// single object,
// rather than four separate positional parameters repeated at every call site - a data-clump
// cleanup, purely internal to this directory. `Parser.parse` itself (this directory's only
// exported surface) is unaffected - this context never crosses that seam.
export interface ExtractionContext {
	rootDir: string;
	manifestCache: ManifestCache;
	declaredDependenciesCache: DeclaredDependenciesCache;
	tableCache: TableCache;
	nominalIndex: NominalIndex;
	skippedFiles: ReadonlySet<string>;
}
