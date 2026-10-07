import fs from "node:fs";
import path from "node:path";
import { readCargoManifest } from "src/core/cargo-toml";
import { findNearestManifest } from "src/core/find-nearest-manifest";
import { validRustDependencies } from "src/core/manifest-schema";
import { findTomlSection } from "src/core/toml-section";

export interface RustDependency {
	name: string; // Cargo.toml's own key, hyphens and all - `externCrateName` is the code-facing form
	externCrateName: string; // Rust always replaces "-" with "_" when a dependency name is referenced in source
	version: string;
}

export interface RustCrate {
	// The directory containing the crate's own Cargo.toml - every module path (`crate::...`)
	// resolves relative to `${crateRootDir}/src`, never to the overall repo `rootDir`.
	crateRootDir: string;
	dependencies: RustDependency[];
}

// Matches both the plain-string (`serde = "1.0"`) and inline-table (`serde = { version = "1.0",
// features = [...] }`) forms `[dependencies]` entries commonly take. A dependency declared with
// neither shape (a git/path dependency with no `version` key) is intentionally left out - it has
// no semver coordinate to report.
function parseDependencyLine(rawLine: string): RustDependency[] {
	const line = rawLine.trim();
	const nameMatch = line.startsWith("#") ? null : line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
	const name = nameMatch?.[1];
	const rest = nameMatch?.[2];
	if (!name || !rest) return [];
	// Plain-string form (`serde = "1.0"`) or inline-table form (`serde = { version = "1.0", ... }`)
	// - either way, the first quoted `version`-shaped value on the line is the one we want.
	const version = rest.startsWith('"') ? rest.match(/^"([^"]+)"/)?.[1] : rest.match(/version\s*=\s*"([^"]+)"/)?.[1];
	return version ? [{ name, externCrateName: name.replace(/-/g, "_"), version }] : [];
}

function parseDependencies(sectionText: string): RustDependency[] {
	return sectionText.split("\n").flatMap(parseDependencyLine);
}

function readCargoToml(dir: string): RustCrate | undefined {
	let content: string;
	try {
		content = fs.readFileSync(path.join(dir, "Cargo.toml"), "utf8");
	} catch {
		return undefined;
	}
	if (readCargoManifest(content) === undefined) return undefined; // a virtual workspace root - not a crate of its own

	const dependenciesSection = findTomlSection(content, "dependencies");
	return {
		crateRootDir: dir,
		dependencies: dependenciesSection ? validRustDependencies(parseDependencies(dependenciesSection)) : [],
	};
}

// Skips over a pure virtual-workspace-root Cargo.toml on the way up, if any - `readCargoToml`
// only returns for one that actually declares a `[package]`.
export function findNearestRustCrate(rootDir: string, startDir: string): RustCrate | undefined {
	return findNearestManifest(rootDir, startDir, readCargoToml);
}
