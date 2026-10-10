import type { Language } from "src/core/types";

// The one registry of which file extensions belong to which language and which manifest family.
// Discovery, extraction, graph-building, filtering and the cache all read it from here, so adding
// a language is one edit to this file plus that language's own Parser.

// A manifest family is the unit Discovery reasons about for Package boundaries: npm's single
// `package.json` owns both TypeScript and JavaScript files.
export type ManifestFamily = "npm" | "go" | "rust" | "java" | "python";

// One Parser implementation per manifest family; npm's is the TS/JS one, named "typescript".
export type ParserLanguage = Exclude<Language, "javascript">;

export const MANIFEST_FAMILIES = ["npm", "go", "rust", "java", "python"] as const satisfies readonly ManifestFamily[];

// Languages whose calls a SCIP index can refine (documentation/adr/0056). Each one is added in its
// own slice, with its own fixture index; Go, Rust, and Java follow Python.
export const SCIP_LANGUAGES = ["python"] as const satisfies readonly ParserLanguage[];
export type ScipLanguage = (typeof SCIP_LANGUAGES)[number];

// A File's language comes from its own extension alone. `.js`/`.jsx`/`.mjs`/`.cjs` are
// "javascript" even though the "typescript" Parser extracts them.
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, Language>> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	go: "go",
	rs: "rust",
	java: "java",
	py: "python",
};

const FAMILY_BY_LANGUAGE: Readonly<Record<Language, ManifestFamily>> = {
	typescript: "npm",
	javascript: "npm",
	go: "go",
	rust: "rust",
	java: "java",
	python: "python",
};

// A Package node's `language`, and the Parser that extracts that family's files.
export const PARSER_LANGUAGE_BY_FAMILY: Readonly<Record<ManifestFamily, ParserLanguage>> = {
	npm: "typescript",
	go: "go",
	rust: "rust",
	java: "java",
	python: "python",
};

// Each family's manifest and lockfile names. External versions are read from these, so the
// cache epoch hashes their content (documentation/adr/0005-incremental-extraction-caching.md).
export const DEPENDENCY_FILE_NAMES: Readonly<Record<ManifestFamily, readonly string[]>> = {
	npm: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
	go: ["go.mod", "go.sum"],
	rust: ["Cargo.toml", "Cargo.lock"],
	java: ["pom.xml"],
	python: ["pyproject.toml"],
};

export const ELIGIBLE_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(LANGUAGE_BY_EXTENSION));

export function extensionOf(fileName: string): string {
	const lastDot = fileName.lastIndexOf(".");
	return lastDot === -1 ? "" : fileName.slice(lastDot + 1);
}

export function languageOfExtension(extension: string): Language | undefined {
	return LANGUAGE_BY_EXTENSION[extension];
}

export function familyOfLanguage(language: Language): ManifestFamily {
	return FAMILY_BY_LANGUAGE[language];
}

export function familyOfExtension(extension: string): ManifestFamily | undefined {
	const language = languageOfExtension(extension);
	return language === undefined ? undefined : familyOfLanguage(language);
}

export function isManifestFamily(value: string): value is ManifestFamily {
	return (MANIFEST_FAMILIES as readonly string[]).includes(value);
}

// A Package id is its repo-relative directory, suffixed `@<family>` only when two manifests
// share that directory (`filesystem-discovery.ts`'s `packageIdFor`), e.g. `.@go` beside `.@npm`.
export function parsePackageId(id: string): {
	dir: string;
	family: ManifestFamily | undefined;
} {
	const at = id.lastIndexOf("@");
	const suffix = id.slice(at + 1);
	return at > 0 && isManifestFamily(suffix) ? { dir: id.slice(0, at), family: suffix } : { dir: id, family: undefined };
}

export function parsePackageDir(id: string): string {
	return parsePackageId(id).dir;
}
