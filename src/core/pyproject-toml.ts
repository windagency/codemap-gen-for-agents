import { extractQuotedField, findTomlSection } from "src/core/toml-section";

export interface PyprojectManifest {
	// `undefined` name means the `[project]` table exists but its own `name` field couldn't be
	// read - still a real Package root, just with no declared name (mirrors `readCargoManifest`'s
	// same fallback-to-directory-basename case).
	name: string | undefined;
}

// `undefined` (the whole result) means this pyproject.toml declares no PEP 621 `[project]` table
// - only the legacy Poetry-only shape (`[tool.poetry]`) or a build-backend-only manifest, neither
// of which this slice's fidelity bar recognises as a Package root (documentation/adr/0030). Mirrors
// `readCargoManifest`'s own "no [package] table -> not a real crate" precedent.
export function readPyprojectManifest(content: string): PyprojectManifest | undefined {
	const projectSection = findTomlSection(content, "project");
	if (projectSection === undefined) return undefined;
	return { name: extractQuotedField(projectSection, "name") };
}
