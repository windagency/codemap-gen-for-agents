import fs from "node:fs";
import type Parser from "tree-sitter";

export function parseSourceFile(parser: Parser, filePath: string): Parser.Tree {
	return parser.parse(fs.readFileSync(filePath, "utf8"));
}
