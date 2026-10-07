import { z } from "zod";

// Manifests in the analysed repo (package.json, go.mod, Cargo.toml, pom.xml, build.gradle,
// pyproject.toml) are external input (`CONTRIBUTING.md`: validated with Zod before use). A
// manifest that fails validation is treated as absent, never thrown over: a partial or odd
// real-world manifest is something to fall back past.

function parseOrUndefined<T>(schema: z.ZodType<T>, raw: unknown): T | undefined {
	const result = schema.safeParse(raw);
	return result.success ? result.data : undefined;
}

const nonEmpty = z.string().trim().min(1);

const packageJsonNameSchema = z.object({ name: nonEmpty });

const installedPackageJsonSchema = z.object({
	name: nonEmpty,
	version: nonEmpty,
});

const packageJsonVersionSchema = z.object({ version: nonEmpty });

// A malformed dependency map is dropped on its own, so one bad field doesn't hide the others.
const dependencyMapSchema = z.record(z.string(), z.string()).optional().catch(undefined);

const declaredDependenciesSchema = z.object({
	dependencies: dependencyMapSchema,
	devDependencies: dependencyMapSchema,
	peerDependencies: dependencyMapSchema,
	optionalDependencies: dependencyMapSchema,
});

export function parsePackageJsonName(raw: unknown): { name: string } | undefined {
	return parseOrUndefined(packageJsonNameSchema, raw);
}

export function parseInstalledPackageJson(raw: unknown): { name: string; version: string } | undefined {
	return parseOrUndefined(installedPackageJsonSchema, raw);
}

export function parsePackageJsonVersion(raw: unknown): { version: string } | undefined {
	return parseOrUndefined(packageJsonVersionSchema, raw);
}

// Every dependency name -> declared spec, across all four dependency fields. The first field to
// declare a name wins, in npm's own precedence order.
export function parseDeclaredDependencies(raw: unknown): Record<string, string> | undefined {
	const fields = parseOrUndefined(declaredDependenciesSchema, raw);
	if (!fields) return undefined;
	return {
		...fields.optionalDependencies,
		...fields.peerDependencies,
		...fields.devDependencies,
		...fields.dependencies,
	};
}

// The regex-read manifests (go.mod, Cargo.toml, pom.xml, build.gradle, pyproject.toml) produce
// candidate records; each is checked here before it can become an External node.
const coordinateSchema = z.string().regex(/^[^\s"'<>]+$/);

const goRequireSchema = z.object({
	modulePath: coordinateSchema,
	version: z.string().regex(/^v\S+$/),
});

const rustDependencySchema = z.object({
	name: z.string().regex(/^[A-Za-z0-9_-]+$/),
	externCrateName: z.string().regex(/^[A-Za-z0-9_]+$/),
	version: coordinateSchema,
});

const javaDependencySchema = z.object({
	groupId: coordinateSchema,
	artifactId: coordinateSchema,
	version: coordinateSchema,
});

const pythonDependencySchema = z.object({
	name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
	version: nonEmpty,
});

function keepValid<T>(schema: z.ZodType<T>, candidates: unknown[]): T[] {
	return candidates.flatMap((candidate) => {
		const parsed = parseOrUndefined(schema, candidate);
		return parsed === undefined ? [] : [parsed];
	});
}

export function validGoRequires(candidates: unknown[]): z.infer<typeof goRequireSchema>[] {
	return keepValid(goRequireSchema, candidates);
}

export function validRustDependencies(candidates: unknown[]): z.infer<typeof rustDependencySchema>[] {
	return keepValid(rustDependencySchema, candidates);
}

export function validJavaDependencies(candidates: unknown[]): z.infer<typeof javaDependencySchema>[] {
	return keepValid(javaDependencySchema, candidates);
}

export function validPythonDependencies(candidates: unknown[]): z.infer<typeof pythonDependencySchema>[] {
	return keepValid(pythonDependencySchema, candidates);
}
