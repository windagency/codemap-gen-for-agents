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

const commonFlags = {
	"--root": valueFlag("--root"),
	"--out": valueFlag("--out"),
	"--config": valueFlag("--config"),
	"--include-tests": booleanFlag("--include-tests"),
};

const generateFlagsSchema = z.object({ ...commonFlags, "--force": booleanFlag("--force") }).strict();

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
export type RawFlags = Record<string, string | true>;

function parseFlags<T>(schema: z.ZodType<T>, flags: RawFlags): T {
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
