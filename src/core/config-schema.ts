import { SCIP_LANGUAGES } from "src/core/languages";
import { z } from "zod";

// The public-interface spec: JSON only (no YAML/`.js`/`.ts`), no `rootDir`
// field - `rootDir` is the CLI/MCP caller's own concept, never a second competing source of truth.
const codemapConfigSchema = z
	.object({
		outDir: z.string().optional(),
		exclude: z.array(z.string()).optional(),
		// Language -> SCIP index path, relative to the repo root (documentation/adr/0056).
		scipIndexes: z.partialRecord(z.enum(SCIP_LANGUAGES), z.string()).optional(),
	})
	.strict();

export type CodemapConfig = z.infer<typeof codemapConfigSchema>;

// Throws a readable error naming every offending field, rather than silently misapplying a
// wrong shape.
export function parseCodemapConfig(raw: unknown, configPath: string): CodemapConfig {
	const result = codemapConfigSchema.safeParse(raw);
	if (!result.success) {
		throw new Error(
			`Invalid ${configPath}: ${result.error.issues
				.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
				.join("; ")}`,
		);
	}
	return result.data;
}
