import type { ClusteredGraph } from "src/core/types";
import { buildMapJson } from "src/output/json/build-map-json";
import type { Transformer, TransformOptions } from "src/output/transformer";

export class JsonTransformer implements Transformer {
	transform(graph: ClusteredGraph, options?: TransformOptions): string {
		return JSON.stringify(buildMapJson(graph, options?.warnings));
	}
}
