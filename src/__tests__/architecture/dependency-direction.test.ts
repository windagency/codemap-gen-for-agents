import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// arch-unit-ts coverage (CODING_RULES/04-architecture.md), locking
// documentation/adr/0003-generator-pipeline-seams.md's dependency-direction rule: core/ only ever depends
// on each slice's top-level interface/factory file, never an implementation subfolder;
// integration/* only ever depends on core/, never on a pipeline stage directly.
//
// Extracts import specifiers with a regex over the raw source rather than through
// dependency-cruiser or the `typescript` package's Compiler API: dependency-cruiser 18.3.1
// (latest as of writing) only supports typescript <7, and typescript@7 (pinned in this repo)
// no longer ships that classic API at all - its package.json root export now points at a
// version stub, with the new native compiler's API exposed only under "unstable/*" subpaths.
// A full parser is unnecessary here anyway: this rule only needs the literal import specifier.
// Also matches a bare `require(...)`/`require.resolve(...)` call - `html-transformer.ts` vendors
// `d3` via `require.resolve` (a generation-time filesystem read, not a static `import`), which a
// static-`import`-only pattern would miss entirely.
const IMPORT_SPECIFIER_PATTERN =
	/\b(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']|\brequire(?:\.resolve)?\(\s*["']([^"']+)["']/g;

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SRC_DIR = path.join(REPO_ROOT, "src");

function listSourceFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) return listSourceFiles(fullPath);
		return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [fullPath] : [];
	});
}

function importSpecifiers(filePath: string): string[] {
	const text = fs.readFileSync(filePath, "utf8");
	return [...text.matchAll(IMPORT_SPECIFIER_PATTERN)].map((match) => match[1] ?? match[2] ?? "");
}

function toRepoRelativePath(filePath: string): string {
	return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}

function findBoundaryViolations(fromPattern: RegExp, toPattern: RegExp): string[] {
	return listSourceFiles(SRC_DIR).flatMap((filePath) => {
		const fromPath = toRepoRelativePath(filePath);
		if (!fromPattern.test(fromPath)) return [];

		return importSpecifiers(filePath)
			.filter((specifier) => toPattern.test(specifier))
			.map((specifier) => `${fromPath} -> ${specifier}`);
	});
}

describe("pipeline dependency direction", () => {
	it("core/ never imports an extraction/graph-building/clustering/output/discovery implementation subfolder", () => {
		const violations = findBoundaryViolations(
			/^src\/core\//,
			/^src\/(extraction\/(ts-compiler-api|tree-sitter-go|tree-sitter-rust|tree-sitter-java|tree-sitter-python|scip)|graph-building\/default|clustering\/louvain|output\/json|output\/html|discovery\/filesystem)\//,
		);

		expect(violations).toStrictEqual([]);
	});

	it("extraction/ never imports discovery/ - each pipeline stage owns its own view of the filesystem, never reaches into a sibling stage's", () => {
		const violations = findBoundaryViolations(/^src\/extraction\//, /^src\/discovery\//);

		expect(violations).toStrictEqual([]);
	});

	it("integration/ never imports extraction/, graph-building/, clustering/, output/, or discovery/ directly", () => {
		const violations = findBoundaryViolations(
			/^src\/integration\//,
			/^src\/(extraction|graph-building|clustering|output|discovery)\//,
		);

		expect(violations).toStrictEqual([]);
	});

	it("integration/ depends only on core/compose.ts, never another core/ file directly (documentation/adr/0003-generator-pipeline-seams.md)", () => {
		const violations = findBoundaryViolations(/^src\/integration\//, /^src\/core\/(?!compose$)/);

		expect(violations).toStrictEqual([]);
	});

	it("core/ never imports integration/ - the composition root is depended on, never the reverse", () => {
		const violations = findBoundaryViolations(/^src\/core\//, /^src\/integration\//);

		expect(violations).toStrictEqual([]);
	});

	it("CliAdapter/McpAdapter/SkillAdapter are peers: none of the three imports another (documentation/adr/0004-public-interface-contract.md)", () => {
		const violations = findBoundaryViolations(/^src\/integration\/cli\//, /^src\/integration\/(mcp|skill)\//)
			.concat(findBoundaryViolations(/^src\/integration\/mcp\//, /^src\/integration\/(cli|skill)\//))
			.concat(findBoundaryViolations(/^src\/integration\/skill\//, /^src\/integration\/(cli|mcp)\//));

		expect(violations).toStrictEqual([]);
	});

	it("DefaultGraphBuilder never imports typescript or Node's fs/path modules directly", () => {
		const violations = findBoundaryViolations(
			/^src\/graph-building\/default\//,
			/^(typescript|node:fs|node:path|fs|path)$/,
		);

		expect(violations).toStrictEqual([]);
	});

	it("picomatch is only ever imported through its own owned adapter (CODING_RULES/04-architecture.md)", () => {
		const violations = findBoundaryViolations(
			/^src\/(?!discovery\/filesystem\/picomatch-glob-matcher\.ts$)/,
			/^picomatch$/,
		);

		expect(violations).toStrictEqual([]);
	});

	it("typescript is only ever imported through its own owned adapter (CODING_RULES/04-architecture.md)", () => {
		// The adapter is the whole `ts-compiler-api/` directory, not one file: the concern is split
		// across symbol classification, import resolution, call resolution, and nominal dispatch,
		// each touching `typescript` directly, but none of it leaks outside the directory - everything
		// else in the codebase still only ever sees `TsCompilerApiParser` (`Parser`'s own interface).
		const violations = findBoundaryViolations(
			/^src\/(?!extraction\/ts-compiler-api\/)/,
			/^typescript(\/unstable\/.+)?$/,
		);

		expect(violations).toStrictEqual([]);
	});

	it("graphology/graphology-communities-louvain are only ever imported through their own owned adapter (CODING_RULES/04-architecture.md)", () => {
		const violations = findBoundaryViolations(
			/^src\/(?!clustering\/louvain\/louvain-module-detector\.ts$)/,
			/^graphology(-communities-louvain)?$/,
		);

		expect(violations).toStrictEqual([]);
	});

	it("@modelcontextprotocol/sdk is only ever imported inside integration/mcp/ (CODING_RULES/04-architecture.md)", () => {
		const violations = findBoundaryViolations(/^src\/(?!integration\/mcp\/)/, /^@modelcontextprotocol\/sdk(\/.+)?$/);

		expect(violations).toStrictEqual([]);
	});

	it("d3 is only ever resolved through its own owned adapter (CODING_RULES/04-architecture.md)", () => {
		const violations = findBoundaryViolations(/^src\/(?!output\/html\/html-transformer\.ts$)/, /^d3$/);

		expect(violations).toStrictEqual([]);
	});

	it("zod is only ever imported by a `*-schema.ts` module (CODING_RULES/04-architecture.md, documentation/adr/0031)", () => {
		const violations = findBoundaryViolations(/^src\/(?!.*-schema\.ts$)/, /^zod$/);

		expect(violations).toStrictEqual([]);
	});

	it("tree-sitter and its grammar packages are only ever imported through their own owned adapter directories (CODING_RULES/04-architecture.md)", () => {
		// The adapter is every `tree-sitter-{common,go,rust,java,python}/` directory plus the one
		// shared ambient `.d.ts` declaring the grammar packages' own types (none of which ship their
		// own) - the shared location/symbol-dedup helpers in `tree-sitter-common/` need the bare
		// `tree-sitter` package's own types too, the same way `ts-compiler-api/`'s multi-file adapter
		// shares `typescript` across its own directory above.
		const violations = findBoundaryViolations(
			/^src\/(?!extraction\/tree-sitter-(common|go|rust|java|python)\/|extraction\/tree-sitter-grammars\.d\.ts$)/,
			/^tree-sitter(-go|-rust|-java|-python)?$/,
		);

		expect(violations).toStrictEqual([]);
	});

	it("@scip-code/scip and @bufbuild/protobuf are only ever imported through their own owned adapter (CODING_RULES/04-architecture.md, documentation/adr/0056)", () => {
		const violations = findBoundaryViolations(
			/^src\/(?!extraction\/scip\/scip-index-reader\.ts$)/,
			/^(@scip-code\/scip|@bufbuild\/protobuf)(\/.*)?$/,
		);

		expect(violations).toStrictEqual([]);
	});

	it("node:child_process is only ever imported through the indexer process adapter (documentation/adr/0056)", () => {
		const violations = findBoundaryViolations(
			/^src\/(?!extraction\/scip\/indexer-process\.ts$)/,
			/^(node:)?child_process$/,
		);

		expect(violations).toStrictEqual([]);
	});
});
