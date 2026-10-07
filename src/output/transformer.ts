import type { ClusteredGraph } from "src/core/types";
import { HtmlTransformer } from "src/output/html/html-transformer";
import { JsonTransformer } from "src/output/json/json-transformer";

export interface TransformOptions {
	// The document title HtmlTransformer renders into <title> (defaults to "Code map" when
	// omitted); JsonTransformer ignores it.
	title?: string;
	// Skipped-file warnings JsonTransformer includes in the `codemap.json` envelope itself
	// (defaults to an empty array when omitted); HtmlTransformer ignores it.
	warnings?: string[];
}

export interface Transformer {
	transform(graph: ClusteredGraph, options?: TransformOptions): string;
}

export function createJsonTransformer(): Transformer {
	return new JsonTransformer();
}

export function createHtmlTransformer(): Transformer {
	return new HtmlTransformer();
}
