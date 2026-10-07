import { PicomatchGlobMatcher } from "src/discovery/filesystem/picomatch-glob-matcher";

// CODING_RULES/04-architecture.md's Adapter pattern: a third-party library with real footprint
// (picomatch) sits behind an interface this codebase owns - Discovery depends on this, never
// on picomatch directly.
export interface GlobMatcher {
	isMatch(relativePath: string): boolean;
}

export function createGlobMatcher(patterns: string[]): GlobMatcher {
	return new PicomatchGlobMatcher(patterns);
}
