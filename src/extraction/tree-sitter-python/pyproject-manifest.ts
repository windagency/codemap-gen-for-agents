import fs from "node:fs";
import path from "node:path";
import { findNearestManifest } from "src/core/find-nearest-manifest";
import { validPythonDependencies } from "src/core/manifest-schema";
import { readPyprojectManifest } from "src/core/pyproject-toml";
import { extractStringArrayField, findTomlSection } from "src/core/toml-section";

export interface PythonDependency {
	name: string; // PEP 508 requirement's own distribution name, as declared
	version: string; // the requirement's version specifier, verbatim (e.g. ">=2.28.0", "==8.1.3")
}

export interface PythonProject {
	// The directory containing this pyproject.toml - every absolute import tries resolving relative
	// to this directory itself (a flat layout) and to `${projectRootDir}/src` (a src layout), never
	// to the overall repo `rootDir`.
	projectRootDir: string;
	dependencies: PythonDependency[];
}

// A PEP 508 requirement string (`"requests>=2.28.0"`, `"django[bcrypt]>=4.0"`,
// `"requests ; python_version >= '3.8'"`) reduced to a name + version specifier. A requirement
// with no version specifier at all (`"click"`) is intentionally left out - same as Rust's
// git/path dependencies with no `version` key - it has no semver-ish coordinate to report, and
// `ExternalNode.version` is never optional (`CONTEXT.md`'s External section).
function parseRequirement(raw: string): PythonDependency | undefined {
	const withoutMarker = (raw.split(";")[0] ?? "").trim();
	const nameMatch = withoutMarker.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
	if (!nameMatch?.[1]) return undefined;
	const name = nameMatch[1];
	const versionSpecifier = withoutMarker
		.slice(name.length)
		.replace(/^\s*\[[^\]]*\]/, "") // drop an extras marker, e.g. "[bcrypt]"
		.trim();
	if (!versionSpecifier) return undefined;
	return { name, version: versionSpecifier };
}

function readPyprojectToml(dir: string): PythonProject | undefined {
	let content: string;
	try {
		content = fs.readFileSync(path.join(dir, "pyproject.toml"), "utf8");
	} catch {
		return undefined;
	}
	if (readPyprojectManifest(content) === undefined) return undefined; // Poetry-only/build-backend-only manifest - no [project] table (documentation/adr/0030)
	const projectSection = findTomlSection(content, "project") ?? "";

	const dependencies = validPythonDependencies(
		extractStringArrayField(projectSection, "dependencies").map(parseRequirement),
	);

	return { projectRootDir: dir, dependencies };
}

export function findNearestPythonProject(rootDir: string, startDir: string): PythonProject | undefined {
	return findNearestManifest(rootDir, startDir, readPyprojectToml);
}
