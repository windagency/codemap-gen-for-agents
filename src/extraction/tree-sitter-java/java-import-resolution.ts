import type { RawImport, ResolvedImportTarget } from "src/core/types";
import { locationOf } from "src/extraction/tree-sitter-common/location";
import type { JavaProject } from "src/extraction/tree-sitter-java/java-project";
import type Parser from "tree-sitter";

export interface JavaImportSpec {
	isStatic: boolean;
	isWildcard: boolean;
	path: string; // dotted, e.g. "com.example.other.Helper" or "com.example.other.Utils.doThing"
	node: Parser.SyntaxNode;
}

function isStaticImport(importDeclaration: Parser.SyntaxNode): boolean {
	for (let i = 0; i < importDeclaration.childCount; i++) {
		if (importDeclaration.child(i)?.type === "static") return true;
	}
	return false;
}

export function collectImportSpecs(sourceFile: Parser.SyntaxNode): JavaImportSpec[] {
	const specs: JavaImportSpec[] = [];
	for (const declaration of sourceFile.namedChildren) {
		if (declaration?.type !== "import_declaration") continue;
		const pathNode = declaration.namedChild(0);
		if (!pathNode) continue;
		const isWildcard = declaration.namedChild(1)?.type === "asterisk";
		specs.push({
			isStatic: isStaticImport(declaration),
			isWildcard,
			path: pathNode.text,
			node: declaration,
		});
	}
	return specs;
}

export function packageNameOf(sourceFile: Parser.SyntaxNode): string | undefined {
	const packageDeclaration = sourceFile.namedChildren.find((child) => child?.type === "package_declaration");
	return packageDeclaration?.namedChild(0)?.text;
}

function fqcnOf(packageName: string | undefined, typeName: string): string {
	return packageName ? `${packageName}.${typeName}` : typeName;
}

export function topLevelTypeNames(sourceFile: Parser.SyntaxNode): string[] {
	return sourceFile.namedChildren.flatMap((declaration) => {
		if (!declaration) return [];
		if (
			declaration.type !== "class_declaration" &&
			declaration.type !== "interface_declaration" &&
			declaration.type !== "enum_declaration"
		) {
			return [];
		}
		const nameNode = declaration.childForFieldName("name");
		return nameNode ? [nameNode.text] : [];
	});
}

// `fqcn -> declaring file`, built once per `parse()` call from every `.java` file's own `package`
// declaration plus its top-level type names - independent of any Maven/Gradle directory
// convention, since it's derived purely from each file's own declared identity rather than
// assumed from its filesystem path.
export function buildFqcnIndex(
	filesWithRoots: { filePath: string; sourceFile: Parser.SyntaxNode }[],
): Map<string, string> {
	const index = new Map<string, string>();
	for (const { filePath, sourceFile } of filesWithRoots) {
		const packageName = packageNameOf(sourceFile);
		for (const typeName of topLevelTypeNames(sourceFile)) {
			index.set(fqcnOf(packageName, typeName), filePath);
		}
	}
	return index;
}

// `simple type name -> declaring file`, scoped to what's actually visible *in this one file*:
// same-package classes (visible with no import at all) plus this file's own explicit imports
// (single-class or wildcard), imports overriding same-package on a name clash - the same
// precedence real Java resolution gives. Consulted before the repo-wide, genuinely-ambiguous
// `typeNameIndex` fallback in call resolution, so `Helper.assist()` resolves to *this file's*
// imported `Helper`, not every same-named `Helper` in the repo.
// Every class declared directly in `packageName` (not in a subpackage), as
// `[simpleName, filePath]`. The default package is `""`.
function packageMembers(fqcnIndex: Map<string, string>, packageName: string): [string, string][] {
	const prefix = packageName ? `${packageName}.` : "";
	return [...fqcnIndex].flatMap(([fqcn, filePath]): [string, string][] => {
		if (!fqcn.startsWith(prefix)) return [];
		const simpleName = fqcn.slice(prefix.length);
		return simpleName.includes(".") ? [] : [[simpleName, filePath]];
	});
}

// The `[simpleName, filePath]` pairs one import makes visible. A static import names a member,
// not a type, so it makes none.
function typesImportedBy(spec: JavaImportSpec, fqcnIndex: Map<string, string>): [string, string][] {
	if (spec.isStatic) return [];
	if (spec.isWildcard) return packageMembers(fqcnIndex, spec.path);
	const simpleName = spec.path.split(".").at(-1);
	const filePath = fqcnIndex.get(spec.path);
	return simpleName && filePath ? [[simpleName, filePath]] : [];
}

export function buildVisibleTypeIndex(
	sourceFile: Parser.SyntaxNode,
	specs: JavaImportSpec[],
	fqcnIndex: Map<string, string>,
): Map<string, string> {
	// Imports come after same-package types, so an import wins a name clash.
	return new Map([
		...packageMembers(fqcnIndex, packageNameOf(sourceFile) ?? ""),
		...specs.flatMap((spec) => typesImportedBy(spec, fqcnIndex)),
	]);
}

export interface JavaSupertypeReference {
	typeName: string; // simple name only, e.g. "BaseEntity" - never dotted/generic
	node: Parser.SyntaxNode;
}

// A `generic_type` (`AbstractRepository<Item>`) names its base type as its own first named
// child; a plain `type_identifier` names itself. A qualified supertype (`extends com.example.Foo`,
// a `scoped_type_identifier`) is rare enough, and ambiguous enough without a real symbol table, to
// leave unresolved here - same "no traceable declaration -> drop" outcome as everywhere else.
function baseTypeNameOf(node: Parser.SyntaxNode | null): JavaSupertypeReference | undefined {
	if (!node) return undefined;
	if (node.type === "type_identifier") return { typeName: node.text, node };
	if (node.type === "generic_type") {
		const base = node.namedChild(0);
		return base?.type === "type_identifier" ? { typeName: base.text, node: base } : undefined;
	}
	return undefined;
}

function collectFromTypeList(typeListHolder: Parser.SyntaxNode | null): JavaSupertypeReference[] {
	const typeList = typeListHolder?.namedChild(0);
	if (!typeList) return [];
	return typeList.namedChildren.flatMap((entry) => {
		const ref = baseTypeNameOf(entry);
		return ref ? [ref] : [];
	});
}

// A same-package `extends`/`implements` needs no `import` statement at all - Java's own supertype
// clauses are a distinct, always-present dependency the plain `import_declaration` scan in
// `collectImportSpecs` can never see, cross-package or not (a cross-package one only happens to
// get an edge today as a side effect of Java *requiring* an explicit import for that case).
function supertypesOf(declaration: Parser.SyntaxNode | null): JavaSupertypeReference[] {
	switch (declaration?.type) {
		case "class_declaration": {
			const superclassRef = baseTypeNameOf(declaration.childForFieldName("superclass")?.namedChild(0) ?? null);
			return [
				...(superclassRef ? [superclassRef] : []),
				...collectFromTypeList(declaration.childForFieldName("interfaces")),
			];
		}
		case "enum_declaration":
			return collectFromTypeList(declaration.childForFieldName("interfaces"));
		case "interface_declaration":
			return collectFromTypeList(
				declaration.namedChildren.find((child) => child?.type === "extends_interfaces") ?? null,
			);
		default:
			return [];
	}
}

export function collectSupertypeReferences(sourceFile: Parser.SyntaxNode): JavaSupertypeReference[] {
	return sourceFile.namedChildren.flatMap(supertypesOf);
}

// Resolved only against `visibleTypeIndex` (same-package types plus this file's own imports) -
// unlike a plain import, an unresolved supertype (a JDK/external type needing no local file, e.g.
// `implements Comparable<T>`) produces no `RawImport` at all rather than a redundant `unresolved`
// entry duplicating whatever the ordinary import scan already reported for that same name.
export function toSupertypeImports(
	references: JavaSupertypeReference[],
	visibleTypeIndex: Map<string, string>,
): RawImport[] {
	return references.flatMap((ref): RawImport[] => {
		const filePath = visibleTypeIndex.get(ref.typeName);
		if (!filePath) return [];
		return [
			{
				specifier: ref.typeName,
				viaReExport: false,
				resolvedTarget: { kind: "file", filePath },
				locations: [locationOf(ref.node)],
			},
		];
	});
}

// A dependency's own package sometimes diverges from its declared groupId only in the trailing
// segment - the single most common real-world case being Jackson: `jackson-databind`'s groupId is
// `com.fasterxml.jackson.core`, but its package is `com.fasterxml.jackson.databind` (`jackson-core`
// and `jackson-annotations` are the same story). The shared "vendor.product" ancestor one segment
// up still identifies that same dependency family unambiguously, so it's tried as a second, looser
// candidate alongside the literal groupId. Never drops below 3 segments: going one level further
// would reach a bare vendor/domain prefix (e.g. `com.google`) shared by many unrelated products,
// trading one false negative for a broad false-positive surface.
function groupIdMatchCandidates(groupId: string): string[] {
	const segments = groupId.split(".");
	return segments.length > 3 ? [groupId, segments.slice(0, -1).join(".")] : [groupId];
}

function resolveExternalTarget(project: JavaProject, fqcn: string): ResolvedImportTarget {
	const matches = project.dependencies.filter((dep) =>
		groupIdMatchCandidates(dep.groupId).some((candidate) => fqcn === candidate || fqcn.startsWith(`${candidate}.`)),
	);
	const best = matches.sort((a, b) => b.groupId.length - a.groupId.length)[0];
	return best
		? {
				kind: "external",
				packageName: `${best.groupId}:${best.artifactId}`,
				version: best.version,
				language: "java",
			}
		: { kind: "unresolved" }; // JDK builtin, or a dependency whose groupId doesn't prefix-match its own package
}

// A static import's path is `Class.member`; a regular one's is already the class itself. A
// wildcard import (`import a.b.*;` or `import static a.B.*;`) never names a member to strip.
function importedClassFqcn(spec: JavaImportSpec): string {
	return spec.isStatic && !spec.isWildcard ? spec.path.slice(0, spec.path.lastIndexOf(".")) : spec.path;
}

// The repo files one import resolves to. A non-static wildcard imports a whole *package*
// (`import a.b.*;`), fanned out to every one of its classes already in the index, the same "one
// RawImport per resolved file" shape Go's directory-package imports use.
function internalImportFiles(spec: JavaImportSpec, fqcnIndex: Map<string, string>): string[] {
	const resolvedFile = fqcnIndex.get(importedClassFqcn(spec));
	if (resolvedFile) return [resolvedFile];
	if (!spec.isWildcard || spec.isStatic) return [];
	return packageMembers(fqcnIndex, spec.path).map(([, filePath]) => filePath);
}

export function toRawImports(
	specs: JavaImportSpec[],
	fqcnIndex: Map<string, string>,
	project: JavaProject | undefined,
): RawImport[] {
	return specs.flatMap((spec): RawImport[] => {
		const base = {
			specifier: spec.path,
			viaReExport: false,
			locations: [locationOf(spec.node)],
		};
		const files = internalImportFiles(spec, fqcnIndex);
		if (files.length > 0) {
			return files.map((filePath) => ({
				...base,
				resolvedTarget: { kind: "file", filePath },
			}));
		}
		return [
			{
				...base,
				resolvedTarget: project ? resolveExternalTarget(project, importedClassFqcn(spec)) : { kind: "unresolved" },
			},
		];
	});
}
