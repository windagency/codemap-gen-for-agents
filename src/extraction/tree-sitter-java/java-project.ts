import fs from "node:fs";
import path from "node:path";
import { findNearestManifest } from "src/core/find-nearest-manifest";
import { validJavaDependencies } from "src/core/manifest-schema";

export interface JavaDependency {
	groupId: string;
	artifactId: string;
	version: string;
}

export interface JavaProject {
	// The directory containing the nearest ancestor pom.xml/build.gradle(.kts) - informational only
	// here (unlike Go/Rust, Java import resolution never needs a source-root-relative file path: it
	// resolves entirely through each file's own `package` declaration, see `java-import-resolution.ts`).
	projectRootDir: string;
	dependencies: JavaDependency[];
}

// A regex scan, not a real XML parse (no XML dependency added for one field, mirroring
// `manifest-detection.ts`'s own `readPomArtifactId`) - matches every `<dependency>...</dependency>`
// block's `groupId`/`artifactId`/`version` triple in document order.
function parsePomDependencies(content: string): JavaDependency[] {
	const dependencies: JavaDependency[] = [];
	const blockPattern = /<dependency>([\s\S]*?)<\/dependency>/g;
	for (const blockMatch of content.matchAll(blockPattern)) {
		const block = blockMatch[1] ?? "";
		const groupId = block.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1];
		const artifactId = block.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1];
		const version = block.match(/<version>\s*([^<\s]+)\s*<\/version>/)?.[1];
		if (groupId && artifactId && version) {
			dependencies.push({ groupId, artifactId, version });
		}
	}
	return dependencies;
}

// Gradle's dependency DSL varies (Groovy vs. Kotlin DSL, string-notation vs. map-notation), but
// the overwhelmingly common case - `implementation("group:artifact:version")` /
// `implementation 'group:artifact:version'` - is a single quoted `group:artifact:version` literal
// regardless of which configuration function wraps it, so this matches that literal directly
// rather than trying to parse the surrounding DSL.
function parseGradleDependencies(content: string): JavaDependency[] {
	const dependencies: JavaDependency[] = [];
	const literalPattern = /["']([\w.-]+):([\w.-]+):([\w.+-]+)["']/g;
	for (const match of content.matchAll(literalPattern)) {
		const [, groupId, artifactId, version] = match;
		if (groupId && artifactId && version) {
			dependencies.push({ groupId, artifactId, version });
		}
	}
	return dependencies;
}

function readProjectAt(dir: string): JavaProject | undefined {
	const pomPath = path.join(dir, "pom.xml");
	if (fs.existsSync(pomPath)) {
		return {
			projectRootDir: dir,
			dependencies: validJavaDependencies(parsePomDependencies(fs.readFileSync(pomPath, "utf8"))),
		};
	}
	for (const buildFile of ["build.gradle.kts", "build.gradle"]) {
		const buildPath = path.join(dir, buildFile);
		if (fs.existsSync(buildPath)) {
			return {
				projectRootDir: dir,
				dependencies: validJavaDependencies(parseGradleDependencies(fs.readFileSync(buildPath, "utf8"))),
			};
		}
	}
	return undefined;
}

export function findNearestJavaProject(rootDir: string, startDir: string): JavaProject | undefined {
	return findNearestManifest(rootDir, startDir, readProjectAt);
}
