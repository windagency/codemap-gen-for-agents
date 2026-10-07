import fs from "node:fs";
import path from "node:path";
import { findNearestManifest } from "src/core/find-nearest-manifest";
import { validGoRequires } from "src/core/manifest-schema";

export interface RequiredModule {
	modulePath: string;
	version: string;
}

export interface GoModule {
	modulePath: string;
	// The directory containing this go.mod - every internal import path is resolved relative to
	// this, never to `rootDir` (a nested/vendored go.mod, however rare, still owns its own subtree).
	rootDir: string;
	requires: RequiredModule[];
}

const REQUIRE_BLOCK_START = /^require\s*\(\s*$/;
const REQUIRE_LINE = /^([^\s]+)\s+(v\S+)/;
const SINGLE_REQUIRE_LINE = /^require\s+([^\s]+)\s+(v\S+)/;

function toRequiredModule(match: RegExpMatchArray | null): RequiredModule[] {
	return match?.[1] && match[2] ? [{ modulePath: match[1], version: match[2] }] : [];
}

// A `require ( ... )` block's lines, and every single-line `require x v1`.
function parseRequires(content: string): RequiredModule[] {
	let insideBlock = false;
	return content.split("\n").flatMap((rawLine): RequiredModule[] => {
		const line = rawLine.trim();
		if (!insideBlock) {
			insideBlock = REQUIRE_BLOCK_START.test(line);
			return insideBlock ? [] : toRequiredModule(line.match(SINGLE_REQUIRE_LINE));
		}
		insideBlock = line !== ")";
		return insideBlock ? toRequiredModule(line.match(REQUIRE_LINE)) : [];
	});
}

function readGoMod(dir: string): GoModule | undefined {
	let content: string;
	try {
		content = fs.readFileSync(path.join(dir, "go.mod"), "utf8");
	} catch {
		return undefined;
	}
	const moduleMatch = content.match(/^\s*module\s+(\S+)/m);
	if (!moduleMatch?.[1]) return undefined;
	return {
		modulePath: moduleMatch[1],
		rootDir: dir,
		requires: validGoRequires(parseRequires(content)),
	};
}

export function findNearestGoModule(rootDir: string, startDir: string): GoModule | undefined {
	return findNearestManifest(rootDir, startDir, readGoMod);
}
