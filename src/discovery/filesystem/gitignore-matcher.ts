import fs from "node:fs";
import path from "node:path";
import ignore from "ignore";
import type { GlobMatcher } from "src/discovery/filesystem/glob-matcher";

// Wraps the `ignore` package behind this codebase's own `GlobMatcher` interface - the same
// Adapter pattern `PicomatchGlobMatcher` already uses for picomatch (CODING_RULES/04-architecture.md).
// Reads `<rootDir>/.gitignore` once at construction: a flat, non-walking lookup, the same
// convention `config.ts`'s `loadConfig` already uses for `codemap.config.json` (documentation/adr/0004) -
// only the root `.gitignore`, no per-directory nested ones, no upward search from some deeper
// directory. A missing file degrades to "nothing additionally excluded," the same way a missing
// `codemap.config.json` degrades to built-in defaults, rather than throwing.
export class GitignoreMatcher implements GlobMatcher {
	private readonly rules: ReturnType<typeof ignore> | null;

	constructor(rootDir: string) {
		const gitignorePath = path.join(rootDir, ".gitignore");
		this.rules = fs.existsSync(gitignorePath) ? ignore().add(fs.readFileSync(gitignorePath, "utf8")) : null;
	}

	// `ignore`'s own directory-only patterns (a trailing `/`, e.g. `dist/`) only match a pathname
	// that itself ends in `/` - it has no way to tell a directory entry from a file one otherwise,
	// since both arrive here as the same plain relative-path string. Checking both the bare path and
	// the path with a trailing `/` appended covers a directory entry correctly (matching real git
	// semantics for `dist/`-style patterns) without requiring the caller to thread "is this a
	// directory" through the shared `GlobMatcher` interface - the same tolerance
	// `PicomatchGlobMatcher`'s own bare-directory workaround already accepts (it checks every
	// pattern against every entry regardless of actual file-vs-directory type too).
	isMatch(relativePath: string): boolean {
		if (this.rules === null || relativePath === "") return false;
		return this.rules.ignores(relativePath) || this.rules.ignores(`${relativePath}/`);
	}
}
