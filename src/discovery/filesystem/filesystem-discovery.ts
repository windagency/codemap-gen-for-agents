import fs from "node:fs";
import path from "node:path";
import {
	ELIGIBLE_EXTENSIONS,
	familyOfExtension,
	MANIFEST_FAMILIES,
	type ManifestFamily,
	PARSER_LANGUAGE_BY_FAMILY,
} from "src/core/languages";
import { isTestFile } from "src/core/test-file";
import type { DiscoveredStructure } from "src/core/types";
import type { Discovery } from "src/discovery/discovery";
import { GitignoreMatcher } from "src/discovery/filesystem/gitignore-matcher";
import { createGlobMatcher } from "src/discovery/filesystem/glob-matcher";
import { detectManifests } from "src/discovery/filesystem/manifest-detection";

function toPosixRelative(rootDir: string, target: string): string {
	return path.relative(rootDir, target).split(path.sep).join("/");
}

// exclude entries of the form "prefix/**" also prune the bare directory "prefix" itself, not
// just its children - matching "never descend into an excluded directory" rather than only
// hiding files one by one once already inside it. The project's own `.gitignore` (root-level
// only, documentation/adr/0004's flat-lookup convention - see `GitignoreMatcher`) is always consulted
// alongside `exclude`, never instead of it: a file excluded by either is excluded.
function buildExcludeMatcher(rootDir: string, exclude: string[]): (relPath: string) => boolean {
	const gitignoreMatcher = new GitignoreMatcher(rootDir);
	if (exclude.length === 0) return (relPath) => gitignoreMatcher.isMatch(relPath);

	const entryMatcher = createGlobMatcher(exclude);
	const directoryPrefixes = exclude.filter((pattern) => pattern.endsWith("/**")).map((pattern) => pattern.slice(0, -3));
	const directoryMatcher = createGlobMatcher(directoryPrefixes);

	return (relPath: string) =>
		entryMatcher.isMatch(relPath) || directoryMatcher.isMatch(relPath) || gitignoreMatcher.isMatch(relPath);
}

// Per-family Package-root state threaded down the walk - `null` until some ancestor directory's
// own manifest of that family is found. A directory hosting two manifests (e.g. `go.mod` and
// `package.json`, "a directory isn't forced to be single-language just because one manifest
// happened to be detected first") updates only the families it actually detected; every other
// family's inherited state passes through unchanged. `ids` and `roots` always travel together
// (every read/write touches both for the same family), so they're bundled into one type rather
// than threaded as a pair of parallel records.
type PackageIdByFamily = Record<ManifestFamily, string | null>;
type PackageRootRelPathByFamily = Record<ManifestFamily, string>;
interface FamilyPackageState {
	ids: PackageIdByFamily;
	roots: PackageRootRelPathByFamily;
}

const NO_INHERITED_STATE: FamilyPackageState = {
	ids: { npm: null, go: null, rust: null, java: null, python: null },
	roots: { npm: "", go: "", rust: "", java: "", python: "" },
};

interface WalkResult {
	hasFile: boolean;
	isPackageRoot: boolean; // true iff this directory is itself a Package root for at least one family
}

// Bundles the walk's fixed inputs and its accumulator state (mutated in place via `.push`/
// property assignment as the walk descends) into a single object, so the recursive `walkDirectory`
// below can be a plain module-level function instead of a closure nested inside `discover`.
interface WalkContext {
	rootDir: string;
	isExcluded: (relPath: string) => boolean;
	includeTests: boolean;
	programFiles: string[];
	packages: DiscoveredStructure["packages"];
	directories: DiscoveredStructure["directories"];
	fileOwners: DiscoveredStructure["fileOwners"];
	manifestlessFiles: DiscoveredStructure["manifestlessFiles"];
}

// A directory that hosts more than one manifest needs its Package ids disambiguated (they'd
// otherwise all collide on the same directory path) - mirrors ADR-0021's "only disambiguate on an
// actual collision" idiom for External nodes: a directory with exactly one manifest keeps the
// plain directory-path id every existing single-language fixture already expects.
function packageIdFor(dirRelPath: string, family: ManifestFamily, detectionCount: number): string {
	const basePackageId = dirRelPath === "" ? "." : dirRelPath;
	return detectionCount > 1 ? `${basePackageId}@${family}` : basePackageId;
}

// Records this directory's own manifests as Packages and returns the family state its children
// inherit.
function registerPackages(
	context: WalkContext,
	dir: string,
	dirRelPath: string,
	fileNames: ReadonlySet<string>,
	inherited: FamilyPackageState,
): { state: FamilyPackageState; isPackageRoot: boolean } {
	const detections = detectManifests(dir, fileNames);
	const state: FamilyPackageState = {
		ids: { ...inherited.ids },
		roots: { ...inherited.roots },
	};
	for (const { family, name } of detections) {
		const packageId = packageIdFor(dirRelPath, family, detections.length);
		state.ids[family] = packageId;
		state.roots[family] = dirRelPath;
		context.packages.push({
			id: packageId,
			name,
			language: PARSER_LANGUAGE_BY_FAMILY[family],
		});
	}
	return { state, isPackageRoot: detections.length > 0 };
}

// Returns whether the subdirectory contributed any file.
function visitSubdirectory(
	context: WalkContext,
	entryPath: string,
	entryRelPath: string,
	state: FamilyPackageState,
): boolean {
	const child = walkDirectory(context, entryPath, state);
	if (child.isPackageRoot || !child.hasFile) return false;
	// `DirectoryNode` carries no packageId of its own (a File's actual owning Package is always
	// resolved through `fileOwners`, never through this field) - this is informational only. A
	// directory holding descendant files from two co-located families has no single right answer
	// here; `firstNonNullPackageId`'s fixed family order just picks deterministically rather than
	// depending on manifest-detection order.
	context.directories.push({
		id: entryRelPath,
		packageId: firstNonNullPackageId(state.ids) ?? entryRelPath,
	});
	return true;
}

// Returns whether the file joined the program.
function visitFile(
	context: WalkContext,
	entryName: string,
	entryRelPath: string,
	dirRelPath: string,
	state: FamilyPackageState,
): boolean {
	const extension = path.extname(entryName).slice(1);
	// Test files (documentation/adr/0010's convention, `src/core/test-file.ts`) are invisible to the
	// structural tree by default, the same way an ineligible extension is - a directory containing
	// only test files never materialises either, exactly as if it had been listed in `exclude`
	// (documentation/adr/0011-exclude-test-files-by-default.md).
	const isEligible = ELIGIBLE_EXTENSIONS.has(extension) && (context.includeTests || !isTestFile(entryRelPath));
	if (!isEligible) return false;

	const family = familyOfExtension(extension);
	const packageId = family ? state.ids[family] : null;

	// A file with no ancestor manifest of its own family anywhere above it (an unmanaged rootDir,
	// or a manifest-less subtree) is excluded from `programFiles`/`fileOwners` (no fallback owner is
	// invented) and recorded as manifest-less so the orchestrator can surface it as a warning
	// (documentation/adr/0002's "Update" section).
	if (!family || packageId === null) {
		context.manifestlessFiles.push(entryRelPath);
		return false;
	}

	context.programFiles.push(entryRelPath);
	context.fileOwners[entryRelPath] = {
		packageId,
		directoryId: dirRelPath === state.roots[family] ? null : dirRelPath,
	};
	return true;
}

function walkDirectory(context: WalkContext, dir: string, inherited: FamilyPackageState): WalkResult {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const dirRelPath = toPosixRelative(context.rootDir, dir);
	const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
	const { state, isPackageRoot } = registerPackages(context, dir, dirRelPath, fileNames, inherited);

	let hasFile = false;
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		const entryRelPath = toPosixRelative(context.rootDir, entryPath);
		if (entry.isSymbolicLink() || context.isExcluded(entryRelPath)) continue;

		const contributed = entry.isDirectory()
			? visitSubdirectory(context, entryPath, entryRelPath, state)
			: entry.isFile() && visitFile(context, entry.name, entryRelPath, dirRelPath, state);
		hasFile = hasFile || contributed;
	}

	return { hasFile, isPackageRoot };
}

function firstNonNullPackageId(packageIds: PackageIdByFamily): string | null {
	for (const family of MANIFEST_FAMILIES) {
		const id = packageIds[family];
		if (id !== null) return id;
	}
	return null;
}

export class FilesystemDiscovery implements Discovery {
	discover(rootDir: string, exclude: string[], includeTests = false): DiscoveredStructure {
		const context: WalkContext = {
			rootDir,
			isExcluded: buildExcludeMatcher(rootDir, exclude),
			includeTests,
			programFiles: [],
			packages: [],
			directories: [],
			fileOwners: {},
			manifestlessFiles: [],
		};

		walkDirectory(context, rootDir, NO_INHERITED_STATE);

		const { programFiles, packages, directories, fileOwners, manifestlessFiles } = context;
		return {
			programFiles,
			packages,
			directories,
			fileOwners,
			manifestlessFiles,
		};
	}
}
