import { DefaultGraphBuilder } from "src/graph-building/default/default-graph-builder";
import type { GraphBuilder } from "src/graph-building/graph-builder";

export interface GraphBuilderFactory {
	create(): GraphBuilder;
}

export function createGraphBuilderFactory(): GraphBuilderFactory {
	return {
		create(): GraphBuilder {
			return new DefaultGraphBuilder();
		},
	};
}
