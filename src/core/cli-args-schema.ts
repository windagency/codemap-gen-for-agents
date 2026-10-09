import { SCIP_LANGUAGES, type ScipLanguage } from "src/core/languages";
import { SYMBOL_KINDS } from "src/core/types";
import { z } from "zod";

// argv is external input (`CONTRIBUTING.md`: validated with Zod before use). Each schema is
// `.strict()`, so a flag the command doesn't know is rejected rather than silently ignored.

function valueFlag(flag: string) {
	return z.string({ error: `${flag} needs a value` }).optional();
}

function booleanFlag(flag: string) {
	return z.literal(true, { error: `${flag} takes no value` }).optional();
}

function isScipLanguage(value: string): value is ScipLanguage {
	return (SCIP_LANGUAGES as readonly string[]).includes(value);
}

// `--scip-index <language>=<path>`, repeatable once per language (documentation/adr/0056). The
// path is everything after the first `=`.
const scipIndexFlag = z
	.array(z.string(), { error: "--scip-index needs a value" })
	.transform((values, context) => {
		const indexes: Partial<Record<ScipLanguage, string>> = {};
		for (const value of values) {
			const separator = value.indexOf("=");
			const language = value.slice(0, separator);
			if (separator <= 0 || separator === value.length - 1) {
				context.addIssue({
					code: "custom",
					message: `--scip-index expects <language>=<path>, got ${JSON.stringify(value)}`,
				});
			} else if (!isScipLanguage(language)) {
				context.addIssue({
					code: "custom",
					message: `--scip-index: unsupported language ${JSON.stringify(language)}, expected one of: ${SCIP_LANGUAGES.join(", ")}`,
				});
			} else if (indexes[language] !== undefined) {
				context.addIssue({ code: "custom", message: `--scip-index: ${language} given more than once` });
			} else {
				indexes[language] = value.slice(separator + 1);
			}
		}
		return indexes;
	})
	.optional();

const commonFlags = {
	"--root": valueFlag("--root"),
	"--out": valueFlag("--out"),
	"--config": valueFlag("--config"),
	"--include-tests": booleanFlag("--include-tests"),
	"--scip-index": scipIndexFlag,
};

// Flags that may be given more than once; `collectFlags` gathers their values into a list.
export const REPEATABLE_FLAGS: ReadonlySet<string> = new Set(["--scip-index"]);

// `--run-indexers` is generate-only: read never runs indexers (documentation/adr/0056 decision 1).
const generateFlagsSchema = z
	.object({ ...commonFlags, "--force": booleanFlag("--force"), "--run-indexers": booleanFlag("--run-indexers") })
	.strict();

const readFlagsSchema = z
	.object({
		...commonFlags,
		"--path": valueFlag("--path"),
		"--search": valueFlag("--search"),
		"--symbol-kind": z
			.enum(SYMBOL_KINDS, {
				error: (issue) =>
					`Invalid --symbol-kind value ${JSON.stringify(issue.input)}. Expected one of: ${SYMBOL_KINDS.join(", ")}.`,
			})
			.optional(),
	})
	.strict();

export type GenerateFlags = z.infer<typeof generateFlagsSchema>;
export type ReadFlags = z.infer<typeof readFlagsSchema>;

// A flag given with no value parses as `true`, so a value flag reports "needs a value" and a
// boolean flag given a value reports "takes no value", both from the schema itself.
export type RawFlags = Record<string, string | true | string[]>;

function parseFlags<T>(schema: z.ZodType<T, unknown>, flags: RawFlags): T {
	const result = schema.safeParse(flags);
	if (result.success) return result.data;
	throw new Error(
		result.error.issues
			.map((issue) => (issue.code === "unrecognized_keys" ? `Unknown flag ${issue.keys.join(", ")}` : issue.message))
			.join("; "),
	);
}

export function parseGenerateFlags(flags: RawFlags): GenerateFlags {
	return parseFlags(generateFlagsSchema, flags);
}

export function parseReadFlags(flags: RawFlags): ReadFlags {
	return parseFlags(readFlagsSchema, flags);
}
