// Returns whether `fileId` (a repo-relative path) is a known JS/TS build-tooling config file, by
// filename convention - the same "identify a non-domain category by filename, not by the import
// graph" approach `isTestFile` already uses (documentation/adr/0010), applied to a second category
// (documentation/adr/0048).
//
// A closed, explicit list of recognised tool names immediately before `.config.<ext>` (or, for the
// handful of tools that still default to it, the `.<tool>rc.<ext>` dotfile convention) - never a
// bare `*.config.*`/`*rc.*` match. "config" is also an ordinary domain word: this codebase's own
// `src/core/config.ts` and a real target repo's `src/config/providers.config.ts` or
// `src/mcp/mcp-server-config.schema.ts` are product code, not build tooling, despite the shared
// word. Matching on the word alone would silently pull real domain files out of clustering; the
// closed tool-name list is what keeps this specific to recognised tooling, the same discipline
// `TEST_FILE_PATTERNS` already applies (specific conventions, never a loose substring).
//
// Scoped to JS/TS extensions only, like `isTestFile`'s own JS/TS-specific patterns - this is a
// JS/TS build-tooling convention, not a cross-language one.
const CONFIG_FILE_PATTERNS = [
	// `<tool>.config.<ext>`, e.g. `eslint.config.js`, `vitest.config.ts`, `packages/foo/jest.config.cjs`.
	/(^|\/)(?:eslint|vite|vitest|jest|babel|webpack|rollup|rolldown|rspack|esbuild|tsup|postcss|tailwind|commitlint|stylelint|prettier|playwright|cypress|next|nuxt|stryker|lint-staged|husky|release|knip|biome)\.config\.[cm]?[jt]sx?$/,
	// `.<tool>rc.<ext>`, the older dotfile convention a few of the same tools still support/default to.
	/(^|\/)\.(?:eslintrc|babelrc|prettierrc|stylelintrc)\.[cm]?[jt]sx?$/,
];

export function isConfigFile(fileId: string): boolean {
	return CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(fileId));
}
