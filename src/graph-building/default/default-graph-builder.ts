import { extensionOf, languageOfExtension } from "src/core/languages";
import type {
	CallEdge,
	DiscoveredStructure,
	EdgeLocation,
	ExternalNode,
	ExtractedSymbols,
	FileNode,
	GraphNode,
	ImportEdge,
	Language,
	RawGraph,
	SymbolNode,
} from "src/core/types";
import type { GraphBuilder } from "src/graph-building/graph-builder";

// Every id Discovery hands GraphBuilder is already a "/"-separated repo-relative path
// (never a raw filesystem path), so basename/extension are plain string ops - no `fs`/`path`
// import, keeping GraphBuilder's own arch-unit-ts rule (never touches the filesystem) literal.
function basenameOf(posixRelativePath: string): string {
	return posixRelativePath.split("/").at(-1) ?? posixRelativePath;
}

// Discovery only ever hands GraphBuilder eligible extensions, so a miss here is a bug upstream.
function languageOf(extension: string): Language {
	const language = languageOfExtension(extension);
	if (!language) {
		throw new Error(
			`No language mapping for file extension ".${extension}" - Discovery should never hand GraphBuilder a file with an ineligible extension.`,
		);
	}
	return language;
}

// Shared by `buildImportGraph` and `buildCallGraph`: both merge raw entries into a `Map<string,
// Map<string, V>>` keyed by (source, target), then flatten it back into a flat edge array.
function getOrCreateNested<V>(outer: Map<string, Map<string, V>>, outerKey: string): Map<string, V> {
	let inner = outer.get(outerKey);
	if (!inner) {
		inner = new Map();
		outer.set(outerKey, inner);
	}
	return inner;
}

function flattenNested<V, R>(
	outer: Map<string, Map<string, V>>,
	toResult: (outerKey: string, innerKey: string, value: V) => R,
): R[] {
	return [...outer.entries()].flatMap(([outerKey, inner]) =>
		[...inner.entries()].map(([innerKey, value]) => toResult(outerKey, innerKey, value)),
	);
}

interface MergedImportEdge {
	source: string;
	target: string;
	specifier: string;
	viaReExport: boolean;
	locations: EdgeLocation[];
}

type ResolvedTarget = ExtractedSymbols["imports"][number]["resolvedTarget"];
type ExternalTarget = Extract<ResolvedTarget, { kind: "external" }>;
type FileTarget = Extract<ResolvedTarget, { kind: "file" }>;

function externalTargetsOf(symbols: ExtractedSymbols[]): ExternalTarget[] {
	return symbols.flatMap((extracted) =>
		extracted.imports.flatMap(({ resolvedTarget }) => (resolvedTarget.kind === "external" ? [resolvedTarget] : [])),
	);
}

// `packageName` alone when every import agrees on one version; `${packageName}@${version}` for a
// package resolved at more than one version (documentation/adr/0021).
function createExternalIdFor(symbols: ExtractedSymbols[]): (target: ExternalTarget) => string {
	const versionsByPackageName = new Map<string, Set<string>>();
	for (const { packageName, version } of externalTargetsOf(symbols)) {
		const versions = versionsByPackageName.get(packageName) ?? new Set();
		versionsByPackageName.set(packageName, versions.add(version));
	}
	return ({ packageName, version }) =>
		(versionsByPackageName.get(packageName)?.size ?? 0) > 1 ? `${packageName}@${version}` : packageName;
}

function mergeImportEdge(
	edgesByTarget: Map<string, MergedImportEdge>,
	source: string,
	target: string,
	rawImport: ExtractedSymbols["imports"][number],
): void {
	const existing = edgesByTarget.get(target);
	if (existing) {
		existing.viaReExport ||= rawImport.viaReExport;
		existing.locations.push(...rawImport.locations);
		return;
	}
	edgesByTarget.set(target, {
		source,
		target,
		specifier: rawImport.specifier,
		viaReExport: rawImport.viaReExport,
		locations: [...rawImport.locations],
	});
}

// Merges raw import entries sharing a `(source, target)` natural key into one edge with
// concatenated `locations` (`kind`/`type` are constant for every `RawImport`-derived edge, so the
// spec's full `(source, target, kind, type)` key reduces to this). An "unresolved" target produces
// no edge at all - silently, per the extraction-algorithm map's decision.
//
// Externals are deduplicated by package name in the common case, where `id` is exactly the
// package name per the schema. When a monorepo resolves the same package name to genuinely
// divergent versions - the case `documentation/adr/0021-external-node-version-disambiguation.md` fixes -
// `id` is instead `${packageName}@${version}`, one ExternalNode per distinct version, so no
// version is silently dropped. This only changes shape for a package name that actually has more
// than one resolved version; every other External node's `id` is unaffected (schemaVersion 1.1.0).
//
// Keyed by source then target (a nested Map) rather than a single concatenated string key, so no
// delimiter choice has to worry about colliding with a real path or package name.
function buildImportGraph(symbols: ExtractedSymbols[]): {
	edges: ImportEdge[];
	externals: ExternalNode[];
} {
	const externalIdFor = createExternalIdFor(symbols);
	const edgesBySource = new Map<string, Map<string, MergedImportEdge>>();
	const externalsById = new Map<string, ExternalNode>();

	// The edge target for a resolved import, registering its External node on first sight.
	function targetOf(resolvedTarget: FileTarget | ExternalTarget): string {
		if (resolvedTarget.kind === "file") return resolvedTarget.filePath;
		const id = externalIdFor(resolvedTarget);
		if (!externalsById.has(id)) {
			externalsById.set(id, {
				id,
				kind: "external",
				name: resolvedTarget.packageName,
				version: resolvedTarget.version,
				language: resolvedTarget.language,
			});
		}
		return id;
	}

	for (const extracted of symbols) {
		const edgesByTarget = getOrCreateNested(edgesBySource, extracted.filePath);
		for (const rawImport of extracted.imports) {
			const { resolvedTarget } = rawImport;
			if (resolvedTarget.kind === "unresolved") continue;
			const target = targetOf(resolvedTarget);
			mergeImportEdge(edgesByTarget, extracted.filePath, target, rawImport);
		}
	}

	const edges: ImportEdge[] = flattenNested(edgesBySource, (_source, _target, entry) => ({
		source: entry.source,
		target: entry.target,
		kind: "static" as const,
		type: "import" as const,
		specifier: entry.specifier,
		viaReExport: entry.viaReExport,
		locations: entry.locations,
	}));

	return { edges, externals: [...externalsById.values()] };
}

// Fans a multi-candidate `RawCall` out into one `CallEdge` per candidate (ticket 12's decision),
// merging entries sharing a `(source, target)` natural key - `kind`/`type` are constant for every
// `RawCall`-derived edge, same reduction as `buildImportGraph`'s own merge key - with concatenated
// `locations`. `callerLocalId`/`candidates[].localId` are already resolved (but not yet
// schema-id-formatted) by `Parser`; formatting them into `${filePath}#${localId}` here is the
// same id scheme every other node/edge in this file uses.
function buildCallGraph(symbols: ExtractedSymbols[]): CallEdge[] {
	const edgesBySource = new Map<string, Map<string, EdgeLocation[]>>();

	for (const extracted of symbols) {
		for (const rawCall of extracted.calls) {
			const edgesByTarget = getOrCreateNested(edgesBySource, `${extracted.filePath}#${rawCall.callerLocalId}`);
			for (const candidate of rawCall.candidates) {
				const target = `${candidate.filePath}#${candidate.localId}`;
				edgesByTarget.set(target, [...(edgesByTarget.get(target) ?? []), ...rawCall.locations]);
			}
		}
	}

	return flattenNested(edgesBySource, (edgeSource, target, locations) => ({
		source: edgeSource,
		target,
		kind: "static" as const,
		type: "call" as const,
		locations,
	}));
}

// Package/Directory/File nodes are assembled from `structure`; Symbol nodes are assembled from
// `symbols` alone (`ExtractedSymbols.filePath` matches a `structure.programFiles` entry, and each
// `RawSymbol.localId` becomes the Symbol id's fragment after `${filePath}#`). Import edges and
// External nodes are assembled from `symbols[].imports` alone; call edges from `symbols[].calls`
// alone.
export class DefaultGraphBuilder implements GraphBuilder {
	build(symbols: ExtractedSymbols[], structure: DiscoveredStructure): RawGraph {
		const { edges: importEdges, externals } = buildImportGraph(symbols);
		const edges = [...importEdges, ...buildCallGraph(symbols)];

		const nodes: GraphNode[] = [
			...structure.packages.map((pkg) => ({
				id: pkg.id,
				kind: "package" as const,
				name: pkg.name,
				language: pkg.language,
			})),
			...structure.directories.map((directory) => ({
				id: directory.id,
				kind: "directory" as const,
				name: basenameOf(directory.id),
			})),
			...structure.programFiles.map((filePath): FileNode => {
				const name = basenameOf(filePath);
				const extension = extensionOf(name);
				return {
					id: filePath,
					kind: "file",
					name,
					extension,
					language: languageOf(extension),
					moduleId: null,
					unassignedReason: null,
				};
			}),
			...symbols.flatMap((extracted): SymbolNode[] =>
				extracted.symbols.map((symbol) => ({
					id: `${extracted.filePath}#${symbol.localId}`,
					kind: "symbol" as const,
					name: symbol.name,
					symbolKind: symbol.symbolKind,
					startLine: symbol.startLine,
					endLine: symbol.endLine,
					exported: symbol.exported,
				})),
			),
			...externals,
		];

		return { nodes, edges };
	}
}
