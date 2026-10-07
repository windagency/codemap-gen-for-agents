import fs from "node:fs";
import path from "node:path";
import type { ExtractedSymbols } from "src/core/types";
import type { Parser } from "src/extraction/parser";
import { getFileSymbolTable, toRawCalls } from "src/extraction/ts-compiler-api/call-resolution";
import type { ExtractionContext, ManifestCache, TableCache } from "src/extraction/ts-compiler-api/extraction-context";
import { toRawImports } from "src/extraction/ts-compiler-api/import-resolution";
import { buildNominalIndex } from "src/extraction/ts-compiler-api/nominal-dispatch";
import { API, type Project } from "typescript/unstable/sync";

// typescript@7 ships no classic in-process `ts.createProgram`/`ts.TypeChecker` API at all - its
// root export is just a version stub, with the real compiler exposed only under `unstable/*`
// subpaths, backed by a spawned native (Go) process talking over a sync IPC channel. `ast` is the
// pure-syntax half (no process, no type info) used for the syntactic classification this ticket
// needs; `sync`'s `API`/`Snapshot`/`Project` is the process-backed half that yields a real
// `Program` per file (needed so a later ticket's checker-dependent resolution has one to reuse).
//
// The extraction pipeline itself is split by concern across this directory: symbol classification
// (`symbol-classification.ts`), import/external resolution (`import-resolution.ts`), call
// resolution including union-typed dispatch (`call-resolution.ts`), and nominal (interface/
// abstract-class) dispatch (`nominal-dispatch.ts`), sharing pure-syntax and checker-dependent node
// helpers (`ast-utils.ts`, `checker-utils.ts`) and the per-`parse()`-call cache/index shapes
// (`extraction-context.ts`). This file is the orchestration layer alone: per-run setup/teardown of
// the compiler API and wiring those pieces together into `Parser`'s one exported method.

// A file with a non-empty `getSyntacticDiagnostics()` result - a genuine parse error, or a
// non-TS/JS file that slipped through the extraction glob under a matching extension - is
// "unparseable", scoped deliberately to *syntactic* diagnostics only: a file with type errors
// but valid syntax
// still resolves `false` here and extracts normally. A missing project/source file (which
// shouldn't happen for a file `Discovery` found, but leaves no sourceFile to check) degrades to
// the same outcome rather than throwing.
function hasSyntaxErrors(project: Project | undefined, filePath: string): boolean {
	const sourceFile = project?.program.getSourceFile(filePath);
	if (!project || !sourceFile) return true;
	return project.program.getSyntacticDiagnostics(filePath).length > 0;
}

// The full skip-set, determined once per `parse()` call across every file it's about to extract
// - before any of those files' import resolution is finalised - so a still-valid file importing
// one of these sees it as unresolved rather than a dangling edge target (ticket 13's ordering
// requirement). A file outside this run's `extractFiles` can never be newly skipped: it's
// content-hash-unchanged since its last successful (cached) extraction, per ADR-0005.
function collectSkippedFiles(
	extractFiles: string[],
	resolveProject: (filePath: string) => Project | undefined,
): Set<string> {
	const skipped = new Set<string>();
	for (const filePath of extractFiles) {
		if (hasSyntaxErrors(resolveProject(filePath), filePath)) skipped.add(filePath);
	}
	return skipped;
}

function extractFile(project: Project | undefined, filePath: string, context: ExtractionContext): ExtractedSymbols {
	const sourceFile = project?.program.getSourceFile(filePath);
	// Only ever reached for a file `collectSkippedFiles` already confirmed has no syntax errors,
	// which itself requires a resolvable project and source file - this narrows the type back for
	// the checker rather than reflecting a real, reachable case.
	if (!sourceFile || !project) {
		return { filePath, symbols: [], imports: [], calls: [] };
	}

	const table = getFileSymbolTable(sourceFile, context.tableCache);
	const imports = toRawImports(sourceFile, project, context);
	const calls = toRawCalls(sourceFile, table.bySymbolNode, project.checker, context);

	return { filePath, symbols: table.rawSymbols, imports, calls };
}

export class TsCompilerApiParser implements Parser {
	parse(rootDir: string, programFiles: string[], extractFiles: string[]): ExtractedSymbols[] {
		if (extractFiles.length === 0) return [];

		const api = new API();
		try {
			const rootTsconfigPath = path.join(rootDir, "tsconfig.json");
			const hasRootConfig = fs.existsSync(rootTsconfigPath);
			const snapshot = api.updateSnapshot({
				openProjects: hasRootConfig ? [rootTsconfigPath] : undefined,
				openFiles: programFiles,
			});
			try {
				// One `ts.Program` for the whole repo (documentation/adr/0003): when a root tsconfig.json exists,
				// every file resolves through that single explicitly-opened project, deliberately
				// bypassing `getDefaultProjectForFile`'s nearest-ancestor-tsconfig search - which would
				// otherwise pick up a workspace member's own (nearer) tsconfig.json instead of the root's,
				// exactly what the "one tsconfig for the whole repo" decision rules out. With no root
				// tsconfig at all (a plain-JS repo), each file falls back to its own inferred project.
				// That inferred project's actual default `CompilerOptions` were probed directly
				// (`project.program.getCompilerOptions()`) rather than assumed: `allowJs: true` and
				// `moduleResolution: Bundler` match the spec's (03-import-reexport-resolution.md) fixed
				// defaults literally; `target` is `ES2025` rather than `ESNext`, and `esModuleInterop` is
				// simply absent (falsy) rather than `true` - neither of which matters in practice, because
				// `import-resolution.ts`'s `resolveImportTarget` resolves a specifier via
				// `checker.getSymbolAtLocation` on the specifier string-literal itself (the module's own
				// symbol), never on a default-import binding, so CJS/ESM default-interop semantics never
				// come into play; and no downlevel emit ever happens here, so `target` only selects
				// syntax/lib support, not resolution behaviour. `ts-compiler-api-parser.test.ts`'s
				// "plain-JS fallback (no tsconfig.json anywhere)" suite exercises this directly end to
				// end: a CommonJS `module.exports` default import resolves to its file, and a bare
				// npm-dependency specifier published only via a package.json `exports` map (no `main`,
				// non-`index`-named entry - resolvable only by actually reading `exports`) resolves to
				// that real installed dependency.
				const rootProject = hasRootConfig ? snapshot.getProject(rootTsconfigPath) : undefined;
				const manifestCache: ManifestCache = new Map();
				const tableCache: TableCache = new Map();
				// Built once per `parse()` call and reused across every extracted file's call sites
				// (ticket 12's decision), rather than rescanned per call site.
				const nominalIndex = buildNominalIndex(rootProject);
				// A file the root tsconfig's `include` doesn't cover (a `vitest.config.ts`, a
				// `scripts/` file) falls back to its own default project instead of being dropped as
				// unparseable. It extracts less precisely, as documentation/USER_GUIDE.md's limitations state.
				const resolveProject = (filePath: string) =>
					rootProject?.program.getSourceFile(filePath) ? rootProject : snapshot.getDefaultProjectForFile(filePath);
				const skippedFiles = collectSkippedFiles(extractFiles, resolveProject);
				const context: ExtractionContext = {
					rootDir,
					manifestCache,
					declaredDependenciesCache: new Map(),
					tableCache,
					nominalIndex,
					skippedFiles,
				};

				// A skipped file produces no entry at all - the same "silently absent" pattern a
				// config-excluded file already gets - rather than an entry with empty
				// symbols/imports/calls (ticket 13's policy).
				return extractFiles.flatMap((filePath): ExtractedSymbols[] => {
					if (skippedFiles.has(filePath)) return [];
					return [extractFile(resolveProject(filePath), filePath, context)];
				});
			} finally {
				snapshot.dispose();
			}
		} finally {
			api.close();
		}
	}
}
