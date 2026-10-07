import fs from "node:fs";
import path from "node:path";
import type { ExtractedSymbols } from "src/core/types";
import { FilesystemDiscovery } from "src/discovery/filesystem/filesystem-discovery";
import { TsCompilerApiParser } from "src/extraction/ts-compiler-api/ts-compiler-api-parser";
import { DefaultGraphBuilder } from "src/graph-building/default/default-graph-builder";
import { describe, expect, it } from "vitest";

// The real end-to-end chain:
// Discovery -> Parser -> GraphBuilder run directly against the checked-in multi-package-monorepo
// fixture, with its real installed node_modules (a workspace-protocol symlink to `packages/pkg-b`
// plus a scoped external stub `@scope/ext-dep`) - the first point in the project where "install
// dependencies, then generate" is a real precondition under test, rather than a synthesised
// in-memory/temp-dir shape.
const ROOT_DIR = fs.realpathSync(
	path.resolve(import.meta.dirname, "..", "..", "..", "fixtures", "multi-package-monorepo"),
);

function toPosixRelative(target: string): string {
	return path.relative(ROOT_DIR, target).split(path.sep).join("/");
}

// Mirrors `generate-map.ts`'s own absolute<->repo-relative reconciliation at the orchestrator
// boundary: `Parser` echoes back absolute paths, but `GraphBuilder`/the schema need repo-relative
// ones matching `structure.programFiles`.
function toRelativeExtractedSymbols(extracted: ExtractedSymbols): ExtractedSymbols {
	return {
		...extracted,
		filePath: toPosixRelative(extracted.filePath),
		imports: extracted.imports.map((rawImport) =>
			rawImport.resolvedTarget.kind === "file"
				? {
						...rawImport,
						resolvedTarget: {
							kind: "file" as const,
							filePath: toPosixRelative(rawImport.resolvedTarget.filePath),
						},
					}
				: rawImport,
		),
		calls: extracted.calls.map((rawCall) => ({
			...rawCall,
			candidates: rawCall.candidates.map((candidate) => ({
				...candidate,
				filePath: toPosixRelative(candidate.filePath),
			})),
		})),
	};
}

describe("Discovery -> Parser -> GraphBuilder, real fixture on disk", () => {
	it("assigns nearest-ancestor Packages, resolves the workspace symlink to a real File, and resolves the scoped External by its real installed version", () => {
		const structure = new FilesystemDiscovery().discover(ROOT_DIR, ["node_modules/**"]);

		expect(structure.packages.map((pkg) => pkg.id).sort()).toStrictEqual([".", "packages/pkg-a", "packages/pkg-b"]);
		expect(structure.fileOwners["packages/pkg-a/src/index.ts"]).toStrictEqual({
			packageId: "packages/pkg-a",
			directoryId: "packages/pkg-a/src",
		});
		expect(structure.fileOwners["packages/pkg-b/src/index.ts"]).toStrictEqual({
			packageId: "packages/pkg-b",
			directoryId: "packages/pkg-b/src",
		});

		const absoluteFiles = structure.programFiles.map((relativePath) => path.join(ROOT_DIR, relativePath));
		const extracted = new TsCompilerApiParser()
			.parse(ROOT_DIR, absoluteFiles, absoluteFiles)
			.map(toRelativeExtractedSymbols);

		const graph = new DefaultGraphBuilder().build(extracted, structure);

		expect(graph.edges).toStrictEqual(
			expect.arrayContaining([
				{
					source: "packages/pkg-a/src/index.ts",
					target: "packages/pkg-b/src/index.ts",
					kind: "static",
					type: "import",
					specifier: "@fixture/pkg-b",
					viaReExport: false,
					locations: [{ startLine: 1, endLine: 1 }],
				},
				{
					source: "packages/pkg-a/src/index.ts",
					target: "@scope/ext-dep",
					kind: "static",
					type: "import",
					specifier: "@scope/ext-dep",
					viaReExport: false,
					locations: [{ startLine: 2, endLine: 2 }],
				},
				{
					source: "packages/pkg-a/src/index.ts#run",
					target: "packages/pkg-b/src/index.ts#greet",
					kind: "static",
					type: "call",
					locations: [{ startLine: 5, endLine: 5 }],
				},
			]),
		);

		expect(graph.nodes).toStrictEqual(
			expect.arrayContaining([
				{
					id: "@scope/ext-dep",
					kind: "external",
					name: "@scope/ext-dep",
					version: "3.1.4",
					language: "typescript",
				},
			]),
		);
	});
});
