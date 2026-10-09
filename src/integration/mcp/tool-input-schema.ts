import { SCIP_LANGUAGES, SYMBOL_KINDS } from "src/core/compose";
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
	scipIndexes: z
		.partialRecord(z.enum(SCIP_LANGUAGES), z.string())
		.optional()
		.describe(
			"Language -> SCIP index path, relative to rootDir; overrides the config file's scipIndexes. Without one, <rootDir>/index.scip is read when present. Refines that language's call targets; files the index misses keep syntactic candidates.",
		),
	runIndexers: z
		.boolean()
		.optional()
		.describe(
			"Runs each language's SCIP indexer (python: scip-python, go: scip-go, rust: rust-analyzer) for every language with no supplied index, writing under outDir/scip/. This runs the target repo's own tooling, so only enable it for a repo you would build yourself. A missing or failing indexer becomes a warning. Off by default.",
		),
};

// `read` always self-heals via a full incremental `generate` run and hardcodes `force: false` and
// `runIndexers: false` (see `core/read-command.ts`'s `ReadCommandInput`/`runReadCommand`), so
// neither is part of `ReadInput` at all - strip both back out after spreading
// `generateInputShape` so they never show up on this tool's public schema.
const {
	force: _readToolOmitsForce,
	runIndexers: _readToolOmitsRunIndexers,
	...readOnlyInputShape
} = {
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
