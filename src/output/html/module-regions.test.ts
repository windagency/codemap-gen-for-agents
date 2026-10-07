import {
	computeRegionId,
	EXTERNAL_REGION_ID,
	type RegionableNode,
	UNASSIGNED_REGION_ID,
} from "src/output/html/module-regions";
import { describe, expect, it } from "vitest";

describe("computeRegionId", () => {
	it("assigns a File's region from its own moduleId", () => {
		const file: RegionableNode = {
			id: "src/foo.ts",
			kind: "file",
			moduleId: 2,
		};
		expect(computeRegionId(file, new Map())).toBe("region:module-2");
	});

	it("assigns an unassigned File its own distinct region", () => {
		const file: RegionableNode = {
			id: "src/foo.ts",
			kind: "file",
			moduleId: null,
		};
		expect(computeRegionId(file, new Map())).toBe(UNASSIGNED_REGION_ID);
	});

	it("assigns a Symbol's region from its owning File's moduleId, not its own", () => {
		const symbol: RegionableNode = { id: "src/foo.ts#doThing", kind: "symbol" };
		const fileModuleById = new Map([["src/foo.ts", 3]]);
		expect(computeRegionId(symbol, fileModuleById)).toBe("region:module-3");
	});

	it("assigns a Symbol whose owning file is unassigned the shared unassigned region", () => {
		const symbol: RegionableNode = { id: "src/foo.ts#doThing", kind: "symbol" };
		const fileModuleById = new Map<string, number | null>([["src/foo.ts", null]]);
		expect(computeRegionId(symbol, fileModuleById)).toBe(UNASSIGNED_REGION_ID);
	});

	it("gives every External node its own distinct region", () => {
		const external: RegionableNode = { id: "lodash", kind: "external" };
		expect(computeRegionId(external, new Map())).toBe(EXTERNAL_REGION_ID);
	});

	it("keeps unassigned and external regions distinct from each other", () => {
		expect(UNASSIGNED_REGION_ID).not.toBe(EXTERNAL_REGION_ID);
	});
});
