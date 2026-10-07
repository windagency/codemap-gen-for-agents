import picomatch from "picomatch";
import type { GlobMatcher } from "src/discovery/filesystem/glob-matcher";

export class PicomatchGlobMatcher implements GlobMatcher {
	private readonly matches: (relativePath: string) => boolean;

	constructor(patterns: string[]) {
		// picomatch's default `dot: false` stops `*`/`**` from crossing into a dot-prefixed path
		// segment at all - so `**/node_modules/**` silently fails to match anything nested under a
		// hidden ancestor directory (a `.stryker-tmp/` mutation-testing sandbox, a `.pnpm-store/`
		// content-addressable store, a `.cache/`, ...), even though this repo-relative path has
		// nothing to do with a dotfile/dotdir glob convention in the first place - every pattern here
		// is matched against a path Discovery already walked, not typed by a human expecting shell
		// dot-hiding semantics. `dot: true` makes every default and user-supplied exclude apply
		// uniformly regardless of what happens to sit above the matched directory.
		this.matches = patterns.length > 0 ? picomatch(patterns, { dot: true }) : () => false;
	}

	isMatch(relativePath: string): boolean {
		return this.matches(relativePath);
	}
}
