import { deriveModuleNames } from "src/clustering/module-naming";
import type { ExternalNode, FileNode, GraphNode, PackageNode } from "src/core/types";
import { describe, expect, it } from "vitest";

function fileNode(id: string, moduleId: number | null): FileNode {
	return {
		id,
		kind: "file",
		name: id.split("/").pop() ?? id,
		extension: "ts",
		language: "typescript",
		moduleId,
		unassignedReason: moduleId === null ? "isolated" : null,
	};
}

function packageNode(id: string, name: string): PackageNode {
	return { id, kind: "package", name, language: "typescript" };
}

describe("deriveModuleNames", () => {
	it("ignores unassigned files when finding the universal root, so a stray root-level config file doesn't stop `src` being stripped", () => {
		const nodes: GraphNode[] = [
			fileNode("vitest.config.ts", null),
			fileNode("src/clustering/a.ts", 0),
			fileNode("src/core/b.ts", 0),
			fileNode("src/discovery/c.ts", 1),
			fileNode("src/core/d.ts", 1),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([
			{ id: 0, name: "clustering+core" },
			{ id: 1, name: "core+discovery" },
		]);
	});

	it("names a module after the top-level directory of its files' shared ancestor, not the deepest one", () => {
		const nodes: GraphNode[] = [
			fileNode("src/clustering/louvain/detector.ts", 0),
			fileNode("src/clustering/louvain/naming.ts", 0),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([{ id: 0, name: "clustering" }]);
	});

	it("names a module after the nearest common ancestor when files span multiple subdirectories", () => {
		const nodes: GraphNode[] = [
			fileNode("src/clustering/louvain/detector.ts", 0),
			fileNode("src/clustering/regions/region.ts", 0),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([{ id: 0, name: "clustering" }]);
	});

	it("names a single-file module after that file's immediate parent directory", () => {
		const nodes: GraphNode[] = [fileNode("src/core/types.ts", 2)];

		expect(deriveModuleNames(nodes)).toStrictEqual([{ id: 2, name: "core" }]);
	});

	it("falls back to an ordinal label when the module's files share no directory at all", () => {
		const nodes: GraphNode[] = [fileNode("a.ts", 5), fileNode("b.ts", 5)];

		expect(deriveModuleNames(nodes)).toStrictEqual([{ id: 5, name: "Module 5" }]);
	});

	it("excludes unassigned files and external nodes", () => {
		const externalNode: ExternalNode = {
			id: "react",
			kind: "external",
			name: "react",
			version: "18.2.0",
			language: "typescript",
		};
		const nodes: GraphNode[] = [fileNode("src/a.ts", null), externalNode, fileNode("src/output/b.ts", 1)];

		expect(deriveModuleNames(nodes)).toStrictEqual([{ id: 1, name: "output" }]);
	});

	it("falls back to an ordinal label when a module's files sit directly under the codebase's sole top-level directory", () => {
		// Every file here lives under "src" - true of the whole codebase, not just this module -
		// so it carries no more information than sharing no directory at all (documentation/adr/0008).
		const nodes: GraphNode[] = [
			fileNode("src/a.ts", 1),
			fileNode("src/b.ts", 1),
			// A sibling module nested one level deeper still gets a real, differentiating name.
			fileNode("src/core/c.ts", 2),
			fileNode("src/core/d.ts", 2),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([
			{ id: 1, name: "Module 1" },
			{ id: 2, name: "core" },
		]);
	});

	it("sorts modules by id ascending", () => {
		const nodes: GraphNode[] = [fileNode("src/b/x.ts", 3), fileNode("src/a/x.ts", 1)];

		expect(deriveModuleNames(nodes).map((m) => m.id)).toStrictEqual([1, 3]);
	});

	it("returns an empty array when no file has a module assigned", () => {
		const nodes: GraphNode[] = [fileNode("src/a.ts", null)];

		expect(deriveModuleNames(nodes)).toStrictEqual([]);
	});

	it("falls back to ordinal labels for every module whose derived name collides with another module's", () => {
		const nodes: GraphNode[] = [
			// Module 0's files span core/ and discovery/ - interpolates to "core+discovery".
			fileNode("src/core/a.ts", 0),
			fileNode("src/discovery/b.ts", 0),
			// Module 1's files span discovery/ and core/ too - same interpolated name, so it collides.
			fileNode("src/discovery/c.ts", 1),
			fileNode("src/core/d.ts", 1),
			// Module 2 has a genuinely specific, non-colliding name.
			fileNode("src/output/html/e.ts", 2),
			fileNode("src/output/html/f.ts", 2),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([
			{ id: 0, name: "Module 0" },
			{ id: 1, name: "Module 1" },
			{ id: 2, name: "output" },
		]);
	});

	it("names a module after the top-level directory even when its common ancestor is several levels deep", () => {
		const nodes: GraphNode[] = [fileNode("src/output/html/e.ts", 2), fileNode("src/output/html/f.ts", 2)];

		expect(deriveModuleNames(nodes)).toStrictEqual([{ id: 2, name: "output" }]);
	});

	it("names a monorepo module after its package, the top-level directory below the shared workspace root", () => {
		const nodes: GraphNode[] = [
			fileNode("packages/billing/src/invoices/create.ts", 0),
			fileNode("packages/billing/src/invoices/void.ts", 0),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([{ id: 0, name: "billing" }]);
	});

	it("falls back to the deeper common-ancestor segment to disambiguate when two modules' top-level names collide", () => {
		const nodes: GraphNode[] = [
			// Both cohesive under src/output/, so both would land on the top-level name "output".
			fileNode("src/output/html/a.ts", 7),
			fileNode("src/output/html/b.ts", 7),
			fileNode("src/output/json/c.ts", 8),
			fileNode("src/output/json/d.ts", 8),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([
			{ id: 7, name: "html" },
			{ id: 8, name: "json" },
		]);
	});

	it("falls back to a third, still-deeper interpolated name when the deeper disambiguating name collides too", () => {
		const nodes: GraphNode[] = [
			// Both modules bottom out at the same single meaningful segment ("foo"), since neither has a
			// closer common ancestor - so topName === deepName for both, and deepName can't disambiguate
			// against itself. Their child directories one level past "foo" still differ, though.
			fileNode("src/foo/x/a.ts", 0),
			fileNode("src/foo/y/a2.ts", 0),
			fileNode("src/foo/z/b.ts", 1),
			fileNode("src/foo/w/b2.ts", 1),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([
			{ id: 0, name: "x+y" },
			{ id: 1, name: "w+z" },
		]);
	});

	it("numbers both Modules by their shared real directory when even the third interpolated tier collides and there's no Package data to fall back on (documentation/adr/0054)", () => {
		const nodes: GraphNode[] = [
			// Both modules bottom out at "foo" with no shared subdirectory below it either - every file
			// sits directly in "foo", so there's no deeper directory segment left to interpolate from, and
			// no Package node here to fall back on either. "foo" - the one real fact both Modules share -
			// is still more honest than an unrelated ordinal (documentation/adr/0052's numbering, reached here via
			// documentation/adr/0054's deepName-based filler rather than a prematurely-unique `Module ${id}` one).
			fileNode("src/foo/a.ts", 0),
			fileNode("src/foo/a2.ts", 0),
			fileNode("src/foo/b.ts", 1),
			fileNode("src/foo/b2.ts", 1),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([
			{ id: 0, name: "foo-1" },
			{ id: 1, name: "foo-2" },
		]);
	});

	it("interpolates a name from a module's distinct child directories when they share no closer common ancestor", () => {
		const nodes: GraphNode[] = [fileNode("src/core/a.ts", 0), fileNode("src/discovery/b.ts", 0)];

		expect(deriveModuleNames(nodes)).toStrictEqual([{ id: 0, name: "core+discovery" }]);
	});

	it("orders interpolated child directories by file count, not alphabetically", () => {
		const nodes: GraphNode[] = [
			fileNode("src/discovery/a.ts", 0),
			fileNode("src/discovery/b.ts", 0),
			fileNode("src/core/c.ts", 0),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([{ id: 0, name: "discovery+core" }]);
	});

	it("names a Module made entirely of test files 'tests', bypassing folder-derived naming", () => {
		// Scattered across unrelated folders - would otherwise interpolate to something like
		// "core+discovery" - but every file is a test file, so it's the dedicated tests bucket
		// LouvainModuleDetector assigns (documentation/adr/0010), not a folder-shaped domain.
		const nodes: GraphNode[] = [fileNode("src/core/a.test.ts", 0), fileNode("src/discovery/b.spec.ts", 0)];

		expect(deriveModuleNames(nodes)).toStrictEqual([{ id: 0, name: "tests" }]);
	});

	it("falls back to its owning Package's name when nothing is left to interpolate (documentation/adr/0041)", () => {
		// "other/thing.ts" is a sibling top-level file outside "packages/" - without it, "packages"
		// would be stripped as the universal root (documentation/adr/0008) and each Module would already
		// settle cleanly on its package-relative top name, never reaching this fallback at all. With
		// it, "packages" stays unstripped and collides across both Modules, both fall through to
		// "src" (their package's own entrypoint files sit directly there, no further subdirectory),
		// which collides too - and only then does each fall back to its own Package's name.
		const nodes: GraphNode[] = [
			packageNode("packages/cli-tool", "cli-tool"),
			packageNode("packages/hook-runner", "hook-runner"),
			fileNode("packages/cli-tool/src/args.ts", 0),
			fileNode("packages/cli-tool/src/run.ts", 0),
			fileNode("packages/hook-runner/src/install.ts", 1),
			fileNode("packages/hook-runner/src/shim.ts", 1),
			fileNode("other/thing.ts", 2),
		];

		const names = deriveModuleNames(nodes);
		expect(names.find((m) => m.id === 0)?.name).toBe("cli-tool");
		expect(names.find((m) => m.id === 1)?.name).toBe("hook-runner");
	});

	it("reserves an earlier tier's unique name so a later-arriving Module can't reopen it, and only the latecomer falls to its Package name (documentation/adr/0042)", () => {
		// Module 0 is cleanly "packages/app/src/core/" and settles there at the deepName tier, with
		// no same-tier rival - so "core" is reserved immediately. Module 1 is scattered across a
		// different package ("widget") and only *reaches* the identical string "core" one tier later,
		// via interpolation (one of its two files happens to sit under its own package's "src/core/").
		// Module 0 keeps its already-reserved "core" rather than being needlessly bumped just because
		// Module 1's unrelated fallback chain landed on the same word later; Module 1 keeps falling,
		// past the now-taken "core", to its own Package's name ("widget"), which is free. Module 2
		// ("packages/other-pkg/src/") exists purely to force "src" to collide for Module 1 in the
		// first place (deepName alone can't disambiguate a single-segment common ancestor from itself,
		// documentation/adr/0035) - without a second "src"-bottoming Module, Module 1 would settle on "src"
		// directly and never reach interpolation at all. "other/thing.ts" keeps "packages" from being
		// stripped as the universal root, matching the real monorepo shape this fix targets.
		const nodes: GraphNode[] = [
			packageNode("packages/app", "app"),
			packageNode("packages/widget", "widget"),
			packageNode("packages/other-pkg", "other-pkg"),
			fileNode("packages/app/src/core/engine.ts", 0),
			fileNode("packages/app/src/core/types.ts", 0),
			fileNode("packages/widget/src/main.ts", 1),
			fileNode("packages/widget/src/core/helper.ts", 1),
			fileNode("packages/other-pkg/src/index.ts", 2),
			fileNode("packages/other-pkg/src/run.ts", 2),
			fileNode("other/thing.ts", 3),
		];

		const names = deriveModuleNames(nodes);
		expect(names.find((m) => m.id === 0)?.name).toBe("core");
		expect(names.find((m) => m.id === 1)?.name).toBe("widget");
		expect(names.find((m) => m.id === 2)?.name).toBe("other-pkg");
	});

	it("numbers two Modules against each other by their shared deepName when the owning Package's name collides too (both Modules share one Package) (documentation/adr/0052)", () => {
		const nodes: GraphNode[] = [
			packageNode("packages/app", "app"),
			fileNode("packages/app/src/a.ts", 0),
			fileNode("packages/app/src/b.ts", 1),
		];

		expect(deriveModuleNames(nodes)).toStrictEqual([
			{ id: 0, name: "src-1" },
			{ id: 1, name: "src-2" },
		]);
	});

	it("falls back to the true ordinal label, not a numbered name, when the shared deepName is already reserved by a different, earlier-settled Module", () => {
		// "src/x.ts" settles cleanly on "src" at the very first tier (its own meaningfulDir is just
		// ["src"], unique among every Module here) - reserving "src" before Modules 0 and 1 ever reach
		// it as their own, later, colliding deepName. "src-1"/"src-2" would misleadingly suggest a
		// relationship to the Module that already, genuinely owns the bare name "src".
		const nodes: GraphNode[] = [
			packageNode("packages/app", "app"),
			fileNode("packages/app/src/a.ts", 0),
			fileNode("packages/app/src/b.ts", 1),
			fileNode("src/x.ts", 2),
		];

		const names = deriveModuleNames(nodes);
		expect(names.find((m) => m.id === 2)?.name).toBe("src");
		expect(names.find((m) => m.id === 0)?.name).toBe("Module 0");
		expect(names.find((m) => m.id === 1)?.name).toBe("Module 1");
	});

	it("falls back to the owning Package's name instead of an unreadably long composite, when a Module scatters across more than a handful of child directories (documentation/adr/0046)", () => {
		// Mirrors a monorepo root package whose application code splits across many top-level folders
		// directly under its own "src/" - "src" bottoms out as the only common ancestor, with 5
		// distinct children (aaa, bbb, ccc, ddd, eee), which would otherwise interpolate into an
		// unreadably long "aaa+bbb+ccc+ddd+eee" composite (documentation/adr/0009's own flagged-but-uncapped
		// case). "packages/sibling/" forces "src" to collide at the deepName tier in the first place
		// (otherwise the scattered Module would settle on "src" directly and never reach interpolation
		// at all); "other/thing.ts" keeps "packages" from being stripped as the universal root, so
		// both Modules' topName is "packages" too, matching the real monorepo shape this targets.
		const nodes: GraphNode[] = [
			packageNode("packages/app", "app"),
			packageNode("packages/sibling", "sibling-pkg"),
			fileNode("packages/app/src/aaa/a.ts", 0),
			fileNode("packages/app/src/bbb/b.ts", 0),
			fileNode("packages/app/src/ccc/c.ts", 0),
			fileNode("packages/app/src/ddd/d.ts", 0),
			fileNode("packages/app/src/eee/e.ts", 0),
			fileNode("packages/sibling/src/only.ts", 1),
			fileNode("other/thing.ts", 2),
		];

		const names = deriveModuleNames(nodes);
		expect(names.find((m) => m.id === 0)?.name).toBe("app");
		expect(names.find((m) => m.id === 1)?.name).toBe("sibling-pkg");
	});

	it("falls back to its own real directory segment, not the owning Package's name, when an overflowing Module's Package already owns another, cleanly-named Module (documentation/adr/0050, documentation/adr/0054)", () => {
		// Mirrors `valora`'s own root package: "app" owns both this scattered, overflowing Module (0)
		// and a second, cleanly-named one ("security", Module 3, settling normally at the deepName
		// tier). Naming Module 0 "app" here would misrepresent one of two Modules as if it stood for
		// the whole Package - unlike the documentation/adr/0046 test above, where "app" owns only the one
		// Module and the same fallback is still honest. Module 0 instead falls to its own deepest real
		// directory segment ("src") as the dishonest-Package-fallback filler (documentation/adr/0054) - which
		// happens to be unique here once Module 1 ("sibling-pkg") settles on its own Package name
		// instead, so no documentation/adr/0052 numbering is even needed in this particular shape.
		const nodes: GraphNode[] = [
			packageNode("packages/app", "app"),
			packageNode("packages/sibling", "sibling-pkg"),
			fileNode("packages/app/src/aaa/a.ts", 0),
			fileNode("packages/app/src/bbb/b.ts", 0),
			fileNode("packages/app/src/ccc/c.ts", 0),
			fileNode("packages/app/src/ddd/d.ts", 0),
			fileNode("packages/app/src/eee/e.ts", 0),
			fileNode("packages/app/src/security/x.ts", 3),
			fileNode("packages/app/src/security/y.ts", 3),
			fileNode("packages/sibling/src/only.ts", 1),
			fileNode("other/thing.ts", 2),
		];

		const names = deriveModuleNames(nodes);
		expect(names.find((m) => m.id === 0)?.name).toBe("src");
		expect(names.find((m) => m.id === 3)?.name).toBe("security");
		// Unaffected: "sibling-pkg" owns only the one Module, so its zero-children fallback is
		// untouched by this decision.
		expect(names.find((m) => m.id === 1)?.name).toBe("sibling-pkg");
	});

	it("still uses the owning Package's name for a genuine root Module, even though the Package also owns other Modules nested beneath it (documentation/adr/0055)", () => {
		// Mirrors `valora-plugin-memory-vault`: Module 0 is the Package's own entrypoint files, directly
		// in its `src/`, with every other Module the Package owns ("migration", "embeddings") nested in a
		// subdirectory below that same `src/`. Unlike the `src/cli/`-shaped case (documentation/adr/0054), where a
		// Module merely *peers* with its Package's other Modules at the same depth, Module 0 here is
		// genuinely the Package's root - every other Module is beneath it, not beside it - so naming it
		// after the Package is the most accurate name available, not a misrepresentation.
		// A second, unrelated package ("other-plugin") whose own entrypoint files also sit directly in
		// its "src/" gives Module 3 the identical deepName ("src") - without a real collision partner,
		// Module 0's "src" would trivially settle as unique at the deepName tier itself, one tier before
		// the Package-root check this test is actually for ever runs. "other/thing.ts" keeps "packages"
		// from being stripped as the universal root (documentation/adr/0008), so both Packages' topName is
		// "packages" too, forcing the collision down to deepName in the first place. Matches the real
		// shape this mirrors: `valora`'s own root package and several of its plugins each have their own
		// "src/" entrypoint files, with "packages/" and "src/" and "scripts/" all siblings at the repo's
		// own top level, so no root segment is ever stripped there either.
		const nodes: GraphNode[] = [
			packageNode("packages/vault-plugin", "vault-plugin"),
			packageNode("packages/other-plugin", "other-plugin"),
			fileNode("packages/vault-plugin/src/manager.ts", 0),
			fileNode("packages/vault-plugin/src/store.ts", 0),
			fileNode("packages/vault-plugin/src/migration/auto-migrate.ts", 1),
			fileNode("packages/vault-plugin/src/migration/json-to-vault.ts", 1),
			fileNode("packages/vault-plugin/src/embeddings/embedder.ts", 2),
			fileNode("packages/vault-plugin/src/embeddings/resolver.ts", 2),
			fileNode("packages/other-plugin/src/a.ts", 3),
			fileNode("packages/other-plugin/src/b.ts", 3),
			fileNode("other/thing.ts", 4),
		];

		const names = deriveModuleNames(nodes);
		expect(names.find((m) => m.id === 0)?.name).toBe("vault-plugin");
		expect(names.find((m) => m.id === 1)?.name).toBe("migration");
		expect(names.find((m) => m.id === 2)?.name).toBe("embeddings");
		// Module 3 is equally a genuine root for its own Package (its only Module), so it keeps its own
		// real Package name too, rather than colliding with Module 0's.
		expect(names.find((m) => m.id === 3)?.name).toBe("other-plugin");
	});

	it("numbers two zero-children Modules by their shared real directory when their common Package already owns other, cleanly-named Modules (documentation/adr/0054)", () => {
		// Mirrors `valora`'s own `src/cli/` shape after documentation/adr/0053's tie-break: two genuinely separate
		// communities (2 files, 2 files) both sitting directly in the same leaf directory with nothing
		// further to distinguish them, both owned by a Package ("app") that already has a third,
		// cleanly-named Module ("security") of its own. Neither has anything left to interpolate (zero
		// children each), and the Package name would misrepresent either one as the Package itself - so
		// both fall to their shared real directory ("cli") as documentation/adr/0054's filler, collide there, and
		// get numbered against each other (documentation/adr/0052) rather than each privately landing on
		// its own unrelated ordinal.
		const nodes: GraphNode[] = [
			packageNode("packages/app", "app"),
			fileNode("packages/app/src/cli/a1.ts", 0),
			fileNode("packages/app/src/cli/a2.ts", 0),
			fileNode("packages/app/src/cli/b1.ts", 1),
			fileNode("packages/app/src/cli/b2.ts", 1),
			fileNode("packages/app/src/security/x.ts", 2),
			fileNode("packages/app/src/security/y.ts", 2),
		];

		const names = deriveModuleNames(nodes);
		expect(names.find((m) => m.id === 2)?.name).toBe("security");
		const cliNames = [names.find((m) => m.id === 0)?.name, names.find((m) => m.id === 1)?.name];
		expect(new Set(cliNames)).toStrictEqual(new Set(["cli-1", "cli-2"]));
	});

	it("still interpolates a composite name when a Module's children stay within the readable cap", () => {
		const nodes: GraphNode[] = [
			packageNode("packages/app", "app"),
			packageNode("packages/sibling", "sibling-pkg"),
			fileNode("packages/app/src/aaa/a.ts", 0),
			fileNode("packages/app/src/bbb/b.ts", 0),
			fileNode("packages/app/src/ccc/c.ts", 0),
			fileNode("packages/sibling/src/only.ts", 1),
			fileNode("other/thing.ts", 2),
		];

		const names = deriveModuleNames(nodes);
		expect(names.find((m) => m.id === 0)?.name).toBe("aaa+bbb+ccc");
	});
});
