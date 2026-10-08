import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extensionOf, languageOfExtension, type ScipLanguage } from "src/core/languages";
import type { ExtractedSymbols } from "src/core/types";
import { buildDefinitionIndex, refineCalls } from "src/extraction/scip/scip-call-refinement";
import type { ScipDocument, ScipIndex } from "src/extraction/scip/scip-index";
import { readScipIndex } from "src/extraction/scip/scip-index-reader";
import { isDocumentCurrent } from "src/extraction/scip/scip-staleness";

// documentation/adr/0056: refines freshly extracted calls from a SCIP index, after `Parser` runs.
// A post-parse step rather than a `Parser` wrapper: `Parser.parse()` has no channel for per-run
// options (which index) or for warnings, and the ADR keeps its interface fixed.

export interface IndexSource {
	language: ScipLanguage;
	indexPath: string; // absolute
}

export interface UnreadableIndex {
	indexPath: string;
	reason: string;
}

export interface IndexResolution {
	symbols: ExtractedSymbols[];
	unreadableIndexes: UnreadableIndex[];
}

export interface IndexResolver {
	// `fresh` is what `Parser` just extracted; `symbolsByFile` is every file's extraction this run,
	// cached ones included, keyed by absolute path, so a call can resolve into an unchanged file.
	resolve(
		sources: IndexSource[],
		fresh: ExtractedSymbols[],
		symbolsByFile: ReadonlyMap<string, ExtractedSymbols>,
	): IndexResolution;
}

function realpathOrSelf(dir: string): string {
	try {
		return fs.realpathSync(dir);
	} catch {
		return dir;
	}
}

// Documents are relative to the index's own project root. An index built on another machine
// (CI, or a committed fixture) names a root that does not exist here; it is then read as
// relative to the directory holding the index file.
function documentRootOf(index: ScipIndex, indexPath: string): string {
	if (index.projectRoot.startsWith("file://")) {
		const projectRoot = fileURLToPath(index.projectRoot);
		if (fs.existsSync(projectRoot) && fs.statSync(projectRoot).isDirectory()) return realpathOrSelf(projectRoot);
	}
	return realpathOrSelf(path.dirname(indexPath));
}

// scip-python leaves `Document.language` empty, so an empty one falls back to the extension.
function isDocumentFor(document: ScipDocument, language: ScipLanguage): boolean {
	if (document.language !== "") return document.language.toLowerCase() === language;
	return languageOfExtension(extensionOf(document.relativePath)) === language;
}

function readSource(filePath: string): string | undefined {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}
}

interface LoadedDocuments {
	documentsByFile: Map<string, ScipDocument>;
	indexedLanguages: Set<ScipLanguage>;
	unreadableIndexes: UnreadableIndex[];
}

function loadDocuments(sources: IndexSource[]): LoadedDocuments {
	const loaded: LoadedDocuments = { documentsByFile: new Map(), indexedLanguages: new Set(), unreadableIndexes: [] };
	for (const source of sources) {
		const read = readScipIndex(source.indexPath);
		if (!read.ok) {
			loaded.unreadableIndexes.push({ indexPath: source.indexPath, reason: read.reason });
			continue;
		}
		loaded.indexedLanguages.add(source.language);
		const root = documentRootOf(read.index, source.indexPath);
		for (const document of read.index.documents) {
			if (isDocumentFor(document, source.language)) {
				loaded.documentsByFile.set(path.join(root, ...document.relativePath.split("/")), document);
			}
		}
	}
	return loaded;
}

// Every indexed file is checked, not just the freshly extracted ones: a call into an unchanged
// file still needs that file's definitions to be current.
function findStaleFiles(documentsByFile: ReadonlyMap<string, ScipDocument>): Set<string> {
	const staleFiles = new Set<string>();
	for (const [filePath, document] of documentsByFile) {
		const source = readSource(filePath);
		if (source === undefined || !isDocumentCurrent(document, source)) staleFiles.add(filePath);
	}
	return staleFiles;
}

function isIndexedLanguage(filePath: string, indexedLanguages: ReadonlySet<ScipLanguage>): boolean {
	const language = languageOfExtension(extensionOf(filePath));
	return (indexedLanguages as ReadonlySet<string>).has(language ?? "");
}

export function createScipIndexResolver(): IndexResolver {
	return {
		resolve(sources, fresh, symbolsByFile) {
			const { documentsByFile, indexedLanguages, unreadableIndexes } = loadDocuments(sources);
			if (indexedLanguages.size === 0) return { symbols: fresh, unreadableIndexes };

			const staleFiles = findStaleFiles(documentsByFile);
			const definitions = buildDefinitionIndex(documentsByFile, staleFiles);

			const symbols = fresh.map((extracted): ExtractedSymbols => {
				if (!isIndexedLanguage(extracted.filePath, indexedLanguages)) return extracted;

				const document = documentsByFile.get(extracted.filePath);
				if (!document) return { ...extracted, indexFallback: "index-uncovered" };
				if (staleFiles.has(extracted.filePath)) return { ...extracted, indexFallback: "index-stale" };
				return { ...extracted, calls: refineCalls(extracted, document, definitions, symbolsByFile) };
			});
			return { symbols, unreadableIndexes };
		},
	};
}
