import path from "node:path";

// Shared by each tree-sitter Parser's own manifest lookup (Go's `go.mod`, Rust's `Cargo.toml`,
// Java's `pom.xml`/`build.gradle(.kts)`): walk upward from `startDir` looking for the nearest
// ancestor directory `readManifestAt` recognises, stopping once the walk goes above `rootDir`.
// Every source file Discovery ever hands `programFiles` already has such an ancestor - Discovery's
// own manifest-detection walk guarantees it - so this only ever returns `undefined` for a
// directly-unit-tested file with no such fixture.
export function findNearestManifest<T>(
	rootDir: string,
	startDir: string,
	readManifestAt: (dir: string) => T | undefined,
): T | undefined {
	let dir = startDir;
	while (true) {
		const found = readManifestAt(dir);
		if (found) return found;
		if (dir === rootDir) return undefined;
		const parent = path.dirname(dir);
		if (parent === dir) return undefined; // filesystem root
		dir = parent;
	}
}
