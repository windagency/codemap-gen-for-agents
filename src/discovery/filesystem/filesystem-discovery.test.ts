import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FilesystemDiscovery } from "src/discovery/filesystem/filesystem-discovery";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let rootDir: string;

beforeEach(() => {
	rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemap-discovery-"));
});

afterEach(() => {
	fs.rmSync(rootDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content = ""): void {
	const fullPath = path.join(rootDir, relativePath);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content);
}

function sortStrings(values: string[]): string[] {
	return [...values].sort();
}

describe("FilesystemDiscovery", () => {
	it("discovers the root package, its files, and lazily materialised directories", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "export const a = 1;");
		writeFile("src/deep/b.ts", "export const b = 1;");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(sortStrings(structure.programFiles)).toStrictEqual(["src/a.ts", "src/deep/b.ts"]);
		expect(structure.packages).toStrictEqual([{ id: ".", name: "root-pkg", language: "typescript" }]);
		expect(sortStrings(structure.directories.map((directory) => directory.id))).toStrictEqual(["src", "src/deep"]);
		expect(structure.directories.every((d) => d.packageId === ".")).toBe(true);
		expect(structure.fileOwners).toStrictEqual({
			"src/a.ts": { packageId: ".", directoryId: "src" },
			"src/deep/b.ts": { packageId: ".", directoryId: "src/deep" },
		});
	});

	it("falls back to the directory basename when package.json has no name", () => {
		writeFile("package.json", JSON.stringify({}));
		writeFile("index.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.packages).toStrictEqual([{ id: ".", name: path.basename(rootDir), language: "typescript" }]);
		// a file directly at the package root has no intermediate Directory
		expect(structure.fileOwners["index.ts"]).toStrictEqual({
			packageId: ".",
			directoryId: null,
		});
		expect(structure.directories).toStrictEqual([]);
	});

	it("treats a nested, undeclared package.json as its own separate Package", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("vendor/outer.ts", "");
		writeFile("vendor/nested-pkg/package.json", JSON.stringify({ name: "nested-pkg" }));
		writeFile("vendor/nested-pkg/inner.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(sortStrings(structure.packages.map((p) => p.id))).toStrictEqual([".", "vendor/nested-pkg"]);

		// vendor is a Directory of the ROOT package (owns outer.ts directly) - it never extends
		// into the nested package's own subtree.
		expect(structure.directories).toStrictEqual([{ id: "vendor", packageId: "." }]);

		expect(structure.fileOwners).toStrictEqual({
			"vendor/outer.ts": { packageId: ".", directoryId: "vendor" },
			"vendor/nested-pkg/inner.ts": {
				packageId: "vendor/nested-pkg",
				directoryId: null,
			},
		});
	});

	it("prunes descent into an excluded directory entirely", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "");
		writeFile("node_modules/some-dep/package.json", JSON.stringify({ name: "some-dep" }));
		writeFile("node_modules/some-dep/index.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, ["node_modules/**"]);

		expect(structure.programFiles).toStrictEqual(["src/a.ts"]);
		expect(structure.packages).toStrictEqual([{ id: ".", name: "root-pkg", language: "typescript" }]);
	});

	it("excludes a directory even when a dot-prefixed directory sits above it (e.g. a mutation-testing sandbox, or a pnpm content-addressable store)", () => {
		// picomatch's default `dot: false` stops "*"/"**" from crossing into a dot-prefixed segment at
		// all, so "**/node_modules/**" would otherwise silently fail to match anything nested under a
		// hidden ancestor directory - exactly the shape a tool like Stryker's `.stryker-tmp/sandbox-*/`
		// (a full copy of the project, dist/ and all) or pnpm's `.pnpm-store/` produces in practice.
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "");
		writeFile(".stryker-tmp/sandbox-abc123/dist/compiled.ts", "");
		writeFile(".stryker-tmp/sandbox-abc123/node_modules/some-dep/index.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, ["**/dist/**", "**/node_modules/**"]);

		expect(structure.programFiles).toStrictEqual(["src/a.ts"]);
	});

	it("excludes whatever the project's own root .gitignore ignores, with no exclude config at all", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "");
		writeFile(".gitignore", "generated/\n*.local.ts\n");
		writeFile("generated/codegen.ts", "");
		writeFile("src/secrets.local.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.programFiles).toStrictEqual(["src/a.ts"]);
	});

	it("combines .gitignore with the configured exclude patterns - either excludes, never one replacing the other", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "");
		writeFile(".gitignore", "generated/\n");
		writeFile("generated/codegen.ts", "");
		writeFile("vendor/lib.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, ["vendor/**"]);

		expect(structure.programFiles).toStrictEqual(["src/a.ts"]);
	});

	it("prunes descent into a .gitignore-excluded directory entirely, not just its files one by one", () => {
		// `ignore`'s own directory-only patterns (a trailing "/", e.g. "node_modules/") only match a
		// pathname that itself ends in "/" - it can't otherwise tell a directory entry from a file
		// one. A package.json placed one level inside the ignored directory proves the walk never
		// descended into it at all, rather than merely excluding files it happened to find there.
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "");
		writeFile(".gitignore", "node_modules/\n");
		writeFile("node_modules/some-dep/package.json", JSON.stringify({ name: "some-dep" }));
		writeFile("node_modules/some-dep/index.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.programFiles).toStrictEqual(["src/a.ts"]);
		expect(structure.packages).toStrictEqual([{ id: ".", name: "root-pkg", language: "typescript" }]);
	});

	it("degrades to no additional exclusions when the project has no .gitignore at all", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.programFiles).toStrictEqual(["src/a.ts"]);
	});

	it("only materialises a directory that has at least one descendant File", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "");
		writeFile("empty-dir/readme.md", "not a source file");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(sortStrings(structure.directories.map((d) => d.id))).toStrictEqual(["src"]);
	});

	it("only walks ts/tsx/js/jsx/mjs/cjs files, ignoring every other extension", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("a.ts", "");
		writeFile("b.tsx", "");
		writeFile("c.js", "");
		writeFile("d.jsx", "");
		writeFile("e.mjs", "");
		writeFile("f.cjs", "");
		writeFile("g.json", "{}");
		writeFile("h.md", "");
		writeFile("i.d.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(sortStrings(structure.programFiles)).toStrictEqual(
			sortStrings(["a.ts", "b.tsx", "c.js", "d.jsx", "e.mjs", "f.cjs", "i.d.ts"]),
		);
	});

	it("never follows a symlinked directory or file", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "");
		fs.mkdirSync(path.join(rootDir, "real-target"));
		fs.writeFileSync(path.join(rootDir, "real-target", "b.ts"), "");
		fs.symlinkSync(path.join(rootDir, "real-target"), path.join(rootDir, "linked-dir"));
		fs.symlinkSync(path.join(rootDir, "src", "a.ts"), path.join(rootDir, "linked-file.ts"));

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(sortStrings(structure.programFiles)).toStrictEqual(["real-target/b.ts", "src/a.ts"]);
	});

	it("excludes test files by default, and prunes a directory left with no other file", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "");
		writeFile("src/a.test.ts", "");
		writeFile("src/only-tests/b.spec.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.programFiles).toStrictEqual(["src/a.ts"]);
		expect(sortStrings(structure.directories.map((d) => d.id))).toStrictEqual(["src"]);
	});

	it("includes test files when includeTests is true", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("src/a.ts", "");
		writeFile("src/a.test.ts", "");
		writeFile("src/only-tests/b.spec.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, [], true);

		expect(sortStrings(structure.programFiles)).toStrictEqual([
			"src/a.test.ts",
			"src/a.ts",
			"src/only-tests/b.spec.ts",
		]);
		expect(sortStrings(structure.directories.map((d) => d.id))).toStrictEqual(["src", "src/only-tests"]);
	});

	it("is independent of readdir ordering: shuffled input directories produce the same result", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("b/file.ts", "");
		writeFile("a/file.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(sortStrings(structure.programFiles)).toStrictEqual(["a/file.ts", "b/file.ts"]);
		expect(sortStrings(structure.directories.map((d) => d.id))).toStrictEqual(["a", "b"]);
	});

	it("stays absent from programFiles/fileOwners but surfaces in manifestlessFiles when no ancestor package.json exists", () => {
		// No package.json anywhere in rootDir - an unmanaged root.
		writeFile("unmanaged/orphan.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.programFiles).toStrictEqual([]);
		expect(structure.fileOwners).toStrictEqual({});
		expect(structure.manifestlessFiles).toStrictEqual(["unmanaged/orphan.ts"]);
	});

	it("excludes an ineligible-extension or test file from manifestlessFiles the same way it always has", () => {
		writeFile("unmanaged/notes.md", "");
		writeFile("unmanaged/orphan.test.ts", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.manifestlessFiles).toStrictEqual([]);
	});

	it("recognizes go.mod as a Package root and owns .go files by it", () => {
		writeFile("go.mod", "module example.com/widget\n\ngo 1.22\n");
		writeFile("main.go", "package main\n\nfunc main() {}\n");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.packages).toStrictEqual([{ id: ".", name: "example.com/widget", language: "go" }]);
		expect(structure.programFiles).toStrictEqual(["main.go"]);
		expect(structure.fileOwners["main.go"]).toStrictEqual({
			packageId: ".",
			directoryId: null,
		});
	});

	it("recognizes a Cargo.toml with a [package] table as a Package root and owns .rs files by it", () => {
		writeFile("Cargo.toml", '[package]\nname = "widget-core"\nversion = "0.1.0"\n');
		writeFile("src/lib.rs", "pub fn run() {}\n");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.packages).toStrictEqual([{ id: ".", name: "widget-core", language: "rust" }]);
		expect(structure.programFiles).toStrictEqual(["src/lib.rs"]);
	});

	it("never treats a pure virtual workspace Cargo.toml (no [package] table) as a Package root", () => {
		writeFile("Cargo.toml", '[workspace]\nmembers = ["crates/widget"]\n');
		writeFile("crates/widget/Cargo.toml", '[package]\nname = "widget"\nversion = "0.1.0"\n');
		writeFile("crates/widget/src/lib.rs", "pub fn run() {}\n");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.packages).toStrictEqual([{ id: "crates/widget", name: "widget", language: "rust" }]);
		expect(structure.programFiles).toStrictEqual(["crates/widget/src/lib.rs"]);
	});

	it("recognizes a pyproject.toml with a [project] table as a Package root and owns .py files by it", () => {
		writeFile("pyproject.toml", '[project]\nname = "widget-core"\nversion = "0.1.0"\n');
		writeFile("widget.py", "def run():\n    pass\n");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.packages).toStrictEqual([{ id: ".", name: "widget-core", language: "python" }]);
		expect(structure.programFiles).toStrictEqual(["widget.py"]);
	});

	it("never treats a Poetry-only pyproject.toml (no [project] table) as a Package root", () => {
		writeFile("pyproject.toml", '[tool.poetry]\nname = "widget"\n');
		writeFile("widget.py", "def run():\n    pass\n");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.packages).toStrictEqual([]);
		expect(structure.programFiles).toStrictEqual([]);
		expect(structure.manifestlessFiles).toStrictEqual(["widget.py"]);
	});

	it("recognizes a pom.xml as a Package root, named from its artifactId", () => {
		writeFile("pom.xml", "<project><artifactId>widget-service</artifactId></project>");
		writeFile("src/main/java/com/example/Widget.java", "class Widget {}");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.packages).toStrictEqual([{ id: ".", name: "widget-service", language: "java" }]);
		expect(structure.programFiles).toStrictEqual(["src/main/java/com/example/Widget.java"]);
	});

	it("names a Maven child module from its own artifactId, not its <parent>'s", () => {
		writeFile(
			"pom.xml",
			[
				"<project>",
				"  <parent>",
				"    <groupId>com.example</groupId>",
				"    <artifactId>widget-parent</artifactId>",
				"    <version>1.0.0</version>",
				"  </parent>",
				"  <artifactId>widget-service</artifactId>",
				"</project>",
			].join("\n"),
		);
		writeFile("src/main/java/com/example/Widget.java", "class Widget {}");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.packages).toStrictEqual([{ id: ".", name: "widget-service", language: "java" }]);
	});

	it("recognizes a build.gradle.kts as a Package root, named from the directory basename", () => {
		writeFile("build.gradle.kts", "plugins { java }\n");
		writeFile("src/main/java/com/example/Widget.java", "class Widget {}");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.packages).toStrictEqual([{ id: ".", name: path.basename(rootDir), language: "java" }]);
	});

	it("recognizes a plain build.gradle (Groovy DSL) as a Package root, named from the directory basename", () => {
		writeFile("build.gradle", "plugins { id 'java' }\n");
		writeFile("src/main/java/com/example/Widget.java", "class Widget {}");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(structure.packages).toStrictEqual([{ id: ".", name: path.basename(rootDir), language: "java" }]);
	});

	it("recognizes two manifests co-located in the same directory as two separate, disambiguated Package nodes", () => {
		writeFile("package.json", JSON.stringify({ name: "web-tool" }));
		writeFile("go.mod", "module example.com/service\n");
		writeFile("index.ts", "export const index = 1;");
		writeFile("main.go", "package main\n\nfunc main() {}\n");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(sortStrings(structure.packages.map((p) => `${p.id}:${p.name}`))).toStrictEqual([
			".@go:example.com/service",
			".@npm:web-tool",
		]);
		expect(structure.fileOwners["index.ts"]?.packageId).toBe(".@npm");
		expect(structure.fileOwners["main.go"]?.packageId).toBe(".@go");
	});

	it("owns each co-located manifest's own files by extension, never letting one manifest claim the other's files", () => {
		writeFile("package.json", JSON.stringify({ name: "web-tool" }));
		writeFile("go.mod", "module example.com/service\n");
		writeFile("index.ts", "export const index = 1;");
		writeFile("main.go", "package main\n\nfunc main() {}\n");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(sortStrings(structure.programFiles)).toStrictEqual(["index.ts", "main.go"]);
	});

	it("walks go/rs/java/py files alongside ts/js ones once their own manifest is present", () => {
		writeFile("package.json", JSON.stringify({ name: "root-pkg" }));
		writeFile("go.mod", "module example.com/service\n");
		writeFile("Cargo.toml", '[package]\nname = "widget"\nversion = "0.1.0"\n');
		writeFile("pom.xml", "<project><artifactId>svc</artifactId></project>");
		writeFile("pyproject.toml", '[project]\nname = "widget-py"\n');
		writeFile("a.ts", "");
		writeFile("b.go", "package main\n");
		writeFile("c.rs", "");
		writeFile("d.java", "class D {}");
		writeFile("e.py", "");

		const structure = new FilesystemDiscovery().discover(rootDir, []);

		expect(sortStrings(structure.programFiles)).toStrictEqual(["a.ts", "b.go", "c.rs", "d.java", "e.py"]);
	});
});
