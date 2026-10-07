import { LouvainModuleDetector } from "src/clustering/louvain/louvain-module-detector";
import type { ModuleDetector } from "src/clustering/module-detector";

// No Factory object: `createModuleDetector` is a plain construction function, not a Factory
// abstraction - it exists only so core/ never has to import louvain/ directly (CODING_RULES/04's
// third-party-library-isolation rule), the same split as `parser.ts`/`parser-factory.ts` and
// `graph-builder.ts`/`graph-builder-factory.ts`: the interface `compose.ts` and `generate-map.ts`
// each depend on lives in its own file, separate from the construction function only `compose.ts`
// (the composition root) needs.
export function createModuleDetector(): ModuleDetector {
	return new LouvainModuleDetector();
}
