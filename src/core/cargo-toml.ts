import { extractQuotedField, findTomlSection } from "src/core/toml-section";

export interface CargoManifest {
	// `undefined` name means the `[package]` table exists but its own `name` field couldn't be
	// read - still a real crate/Package root, just with no declared name (mirrors
	// `readPackageName`'s package.json fallback-to-directory-basename case).
	name: string | undefined;
}

// `undefined` (the whole result) means this Cargo.toml declares no `[package]` table at all - a
// pure virtual workspace manifest (`[workspace]` only), which owns no crate of its own and is
// never a Package root itself (each real
// workspace member has its own Cargo.toml with its own `[package]` table, found independently by
// the same walk).
export function readCargoManifest(content: string): CargoManifest | undefined {
	const packageSection = findTomlSection(content, "package");
	if (packageSection === undefined) return undefined;
	return { name: extractQuotedField(packageSection, "name") };
}
