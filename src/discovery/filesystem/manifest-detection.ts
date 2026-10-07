import fs from "node:fs";
import path from "node:path";
import { readCargoManifest } from "src/core/cargo-toml";
import type { ManifestFamily } from "src/core/languages";
import { parsePackageJsonName } from "src/core/manifest-schema";
import { readPyprojectManifest } from "src/core/pyproject-toml";
import { readPackageJson } from "src/core/read-package-json";

// Package-boundary detection, generalised from "one Package per package.json" to "one Package
// per recognised project manifest". Which
// extensions and Language each family owns lives in `src/core/languages.ts`.

export interface ManifestDetection {
	family: ManifestFamily;
	name: string;
}

function readPackageJsonName(dir: string): string {
	return readPackageJson(dir, parsePackageJsonName)?.name ?? path.basename(dir);
}

// go.mod's `module <path>` directive is the closest thing Go has to package.json's `name` - used
// verbatim (not just its last path segment) since, like an npm scoped name, the full path is the
// only genuinely unambiguous identifier.
function readGoModuleName(dir: string): string {
	try {
		const content = fs.readFileSync(path.join(dir, "go.mod"), "utf8");
		const match = content.match(/^\s*module\s+(\S+)/m);
		return match?.[1] ?? path.basename(dir);
	} catch {
		return path.basename(dir);
	}
}

function readCargoName(dir: string): string | undefined {
	let content: string;
	try {
		content = fs.readFileSync(path.join(dir, "Cargo.toml"), "utf8");
	} catch {
		return path.basename(dir); // unreadable manifest - still a real boundary, per readPackageJsonName's own precedent
	}
	const manifest = readCargoManifest(content);
	if (!manifest) return undefined; // a pure virtual workspace root: no [package] table, no crate, no Package node
	return manifest.name ?? path.basename(dir);
}

function readPyprojectName(dir: string): string | undefined {
	let content: string;
	try {
		content = fs.readFileSync(path.join(dir, "pyproject.toml"), "utf8");
	} catch {
		return path.basename(dir); // unreadable manifest - still a real boundary, per readPackageJsonName's own precedent
	}
	const manifest = readPyprojectManifest(content);
	if (!manifest) return undefined; // no PEP 621 [project] table: a Poetry-only or build-backend-only manifest (documentation/adr/0030)
	return manifest.name ?? path.basename(dir);
}

// A best-effort regex extraction, not a real XML parse (no XML dependency added for one field) -
// the first `<artifactId>` in a canonical pom.xml *outside of `<parent>`* is the project's own,
// appearing before any `<dependencies>` block's artifactIds. The `<parent>` block is stripped
// first: Maven's own recommended element order puts a child module's `<parent>` (carrying the
// parent POM's own groupId/artifactId/version) before the module's own `<artifactId>`, so without
// stripping it, every submodule of a multi-module build would be misidentified by its parent's
// artifactId instead of its own.
function readPomArtifactId(dir: string): string {
	try {
		const content = fs.readFileSync(path.join(dir, "pom.xml"), "utf8");
		const withoutParent = content.replace(/<parent>[\s\S]*?<\/parent>/, "");
		const match = withoutParent.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/);
		return match?.[1] ?? path.basename(dir);
	} catch {
		return path.basename(dir);
	}
}

function readGradleName(dir: string): string {
	// Gradle's own project name normally comes from settings.gradle's `rootProject.name`, not the
	// build file itself - reading that correctly (including a multi-module settings.gradle) is out
	// of scope here, so this falls back straight to the directory basename, exactly like an
	// unreadable/nameless manifest of any other kind does.
	return path.basename(dir);
}

// One entry per manifest kind, in detection order. A reader returning `undefined` means the file
// exists but declares no Package (a virtual Cargo workspace, a Poetry-only pyproject.toml).
// `pom.xml` wins over a Gradle build file in the same directory: both are Java, one per family.
const MANIFEST_READERS: readonly {
	family: ManifestFamily;
	fileNames: readonly string[];
	readName: (dir: string) => string | undefined;
}[] = [
	{ family: "npm", fileNames: ["package.json"], readName: readPackageJsonName },
	{ family: "go", fileNames: ["go.mod"], readName: readGoModuleName },
	{ family: "rust", fileNames: ["Cargo.toml"], readName: readCargoName },
	{ family: "java", fileNames: ["pom.xml"], readName: readPomArtifactId },
	{
		family: "java",
		fileNames: ["build.gradle", "build.gradle.kts"],
		readName: readGradleName,
	},
	{
		family: "python",
		fileNames: ["pyproject.toml"],
		readName: readPyprojectName,
	},
];

// Detects every manifest kind present directly in `dir` - never more than one Package root per
// family, but independently up to one per family, so a directory hosting both a `go.mod` and a
// `package.json` reports two detections - no first-match-wins exclusivity.
export function detectManifests(dir: string, fileNames: ReadonlySet<string>): ManifestDetection[] {
	const detected = new Set<ManifestFamily>();
	return MANIFEST_READERS.flatMap(({ family, fileNames: names, readName }) => {
		if (detected.has(family) || !names.some((name) => fileNames.has(name))) {
			return [];
		}
		detected.add(family);
		const name = readName(dir);
		return name === undefined ? [] : [{ family, name }];
	});
}
