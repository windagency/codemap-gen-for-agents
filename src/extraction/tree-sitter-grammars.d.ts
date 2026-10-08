// `tree-sitter-go`/`tree-sitter-rust`/`tree-sitter-java`/`tree-sitter-python` ship no types of
// their own (unlike `tree-sitter`, which does) - each just exports the grammar's native
// `Parser.Language` binding as its module default via `module.exports`, so an `export =` ambient
// declaration is all that's needed for `typeof import("tree-sitter-go")` to type the lazily
// `require`d grammar.
declare module "tree-sitter-go" {
	import type Parser from "tree-sitter";

	const language: Parser.Language;
	export = language;
}

declare module "tree-sitter-rust" {
	import type Parser from "tree-sitter";

	const language: Parser.Language;
	export = language;
}

declare module "tree-sitter-java" {
	import type Parser from "tree-sitter";

	const language: Parser.Language;
	export = language;
}

declare module "tree-sitter-python" {
	import type Parser from "tree-sitter";

	const language: Parser.Language;
	export = language;
}
