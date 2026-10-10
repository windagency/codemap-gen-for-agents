// Parses a SCIP symbol string, per the grammar documented on `Symbol` in `scip.proto`:
//   <scheme> ' ' <manager> ' ' <package-name> ' ' <version> ' ' <descriptor>+
// or `local <id>`. A space inside one of the four leading fields is written as two spaces, and a
// lone `.` stands for an empty field.

export type DescriptorSuffix =
	| "namespace"
	| "type"
	| "term"
	| "method"
	| "typeParameter"
	| "parameter"
	| "meta"
	| "macro";

export interface ScipDescriptor {
	name: string;
	suffix: DescriptorSuffix;
}

export type ParsedScipSymbol =
	| { kind: "local" }
	| {
			kind: "global";
			scheme: string;
			package: { manager: string; name: string; version: string };
			descriptors: ScipDescriptor[];
	  };

// One leading field: any run of non-space characters and doubled spaces.
const LEADING_FIELDS = /^((?:[^ ]| {2})+) ((?:[^ ]| {2})+) ((?:[^ ]| {2})+) ((?:[^ ]| {2})+) (.+)$/s;

// A name is a run of simple identifier characters, or backtick-quoted with "``" for a backtick.
const NAME = "([\\w+\\-$]+|`(?:[^`]|``)*`)";

// Tried in order: parameter `(name)`, type parameter `[name]`, method `name(disambiguator).`, then
// a name followed by its one-character suffix.
const DESCRIPTOR = new RegExp(`\\(${NAME}\\)|\\[${NAME}\\]|${NAME}\\([^)]*\\)\\.|${NAME}([/#.:!])`, "y");

const SUFFIX_BY_CHARACTER: Readonly<Record<string, DescriptorSuffix>> = {
	"/": "namespace",
	"#": "type",
	".": "term",
	":": "meta",
	"!": "macro",
};

function unescapeField(field: string): string {
	return field === "." ? "" : field.replaceAll("  ", " ");
}

function unescapeName(name: string): string {
	return name.startsWith("`") ? name.slice(1, -1).replaceAll("``", "`") : name;
}

function toDescriptor(match: RegExpExecArray): ScipDescriptor | undefined {
	const [, parameter, typeParameter, method, name, suffixCharacter] = match;
	if (parameter !== undefined) return { name: unescapeName(parameter), suffix: "parameter" };
	if (typeParameter !== undefined) return { name: unescapeName(typeParameter), suffix: "typeParameter" };
	if (method !== undefined) return { name: unescapeName(method), suffix: "method" };
	const suffix = SUFFIX_BY_CHARACTER[suffixCharacter ?? ""];
	return name !== undefined && suffix ? { name: unescapeName(name), suffix } : undefined;
}

function parseDescriptors(text: string): ScipDescriptor[] | undefined {
	const descriptors: ScipDescriptor[] = [];
	DESCRIPTOR.lastIndex = 0;
	while (DESCRIPTOR.lastIndex < text.length) {
		const match = DESCRIPTOR.exec(text);
		const descriptor = match ? toDescriptor(match) : undefined;
		if (!descriptor) return undefined;
		descriptors.push(descriptor);
	}
	return descriptors;
}

export function parseScipSymbol(symbol: string): ParsedScipSymbol | undefined {
	if (symbol.startsWith("local ")) return { kind: "local" };

	const fields = LEADING_FIELDS.exec(symbol);
	if (!fields) return undefined;
	const [, scheme = "", manager = "", name = "", version = "", rest = ""] = fields;

	const descriptors = parseDescriptors(rest);
	if (!descriptors) return undefined;

	return {
		kind: "global",
		scheme: unescapeField(scheme),
		package: { manager: unescapeField(manager), name: unescapeField(name), version: unescapeField(version) },
		descriptors,
	};
}

export function lastDescriptor(parsed: ParsedScipSymbol | undefined): ScipDescriptor | undefined {
	return parsed?.kind === "global" ? parsed.descriptors.at(-1) : undefined;
}
