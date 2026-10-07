import { SYMBOL_KINDS } from "src/core/compose";
import { z } from "zod";

// `SYMBOL_KINDS` is `core/types.ts`'s single source of truth for `SymbolKind`'s member list
// (its own `satisfies` check lives there) - imported rather than hand-duplicated here, since
// `z.enum` needs a literal tuple, not the union type itself.

export const generateInputShape = {
	rootDir: z
		.string()
		.optional()
		.describe("The repo to analyse; defaults to the server process's current working directory."),
	configPath: z
		.string()
		.optional()
		.describe("An explicit codemap.config.json path; defaults to <rootDir>/codemap.config.json."),
	outDir: z
		.string()
		.optional()
		.describe(
			"Where to write codemap.json/codemap.html; defaults to .codemap/ under rootDir, or the config file's outDir.",
		),
	force: z.boolean().optional().describe("Bypasses the incremental extraction cache."),
	includeTests: z
		.boolean()
		.optional()
		.describe(
			"Includes test files (by filename or test-directory convention, per language) in the codemap; excluded by default.",
		),
};

// `read` always self-heals via a full incremental `generate` run and hardcodes `force: false`
// (see `core/read-command.ts`'s `ReadCommandInput`/`runReadCommand`), so `force` isn't part of
// `ReadInput` at all - strip it back out after spreading `generateInputShape` so it never shows
// up on this tool's public schema.
const { force: _readToolOmitsForce, ...readOnlyInputShape } = {
	...generateInputShape,
	path: z
		.string()
		.optional()
		.describe(
			'Matches by prefix/subtree: a Directory or Package path matches every descendant File/Symbol under it; "." matches the whole repo, and a `<dir>@<family>` Package id (e.g. ".@go") matches only that family\'s files.',
		),
	symbolKind: z.enum(SYMBOL_KINDS).optional().describe("Matches only Symbol nodes of this kind."),
	search: z.string().optional().describe("Case-insensitive substring match over node names."),
};

export const readInputShape = readOnlyInputShape;
