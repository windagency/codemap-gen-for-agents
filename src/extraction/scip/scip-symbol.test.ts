import { lastDescriptor, parseScipSymbol } from "src/extraction/scip/scip-symbol";
import { describe, expect, it } from "vitest";

describe("parseScipSymbol", () => {
	it("parses a local symbol", () => {
		expect(parseScipSymbol("local 0")).toStrictEqual({ kind: "local" });
	});

	it("parses a method descriptor chain under a backtick-escaped namespace", () => {
		expect(parseScipSymbol("scip-python python python-scip 0.1.0 `app.storage`/FileStore#save().")).toStrictEqual({
			kind: "global",
			scheme: "scip-python",
			package: { manager: "python", name: "python-scip", version: "0.1.0" },
			descriptors: [
				{ name: "app.storage", suffix: "namespace" },
				{ name: "FileStore", suffix: "type" },
				{ name: "save", suffix: "method" },
			],
		});
	});

	it("parses a parameter, a term, and a meta descriptor", () => {
		expect(lastDescriptor(parseScipSymbol("scip-python python p 1 `a.b`/load().(path)"))).toStrictEqual({
			name: "path",
			suffix: "parameter",
		});
		expect(lastDescriptor(parseScipSymbol("scip-python python p 1 a/CONSTANT."))).toStrictEqual({
			name: "CONSTANT",
			suffix: "term",
		});
		expect(lastDescriptor(parseScipSymbol("scip-python python python-stdlib 3.11 json/__init__:"))).toStrictEqual({
			name: "__init__",
			suffix: "meta",
		});
	});

	it("keeps a method disambiguator out of the name", () => {
		expect(lastDescriptor(parseScipSymbol("rust-analyzer cargo c 1 m/f(+1)."))).toStrictEqual({
			name: "f",
			suffix: "method",
		});
	});

	it("reads '.' as an empty package field and a doubled space as an escaped space", () => {
		expect(parseScipSymbol("scip-go gomod . . pkg/Run().")).toMatchObject({
			package: { manager: "gomod", name: "", version: "" },
		});
		expect(parseScipSymbol("s m my  pkg 1 a/b.")).toMatchObject({
			package: { manager: "m", name: "my pkg", version: "1" },
		});
	});

	it("returns undefined for a malformed symbol", () => {
		expect(parseScipSymbol("")).toBeUndefined();
		expect(parseScipSymbol("scheme only")).toBeUndefined();
		expect(parseScipSymbol("s m p 1 `unterminated")).toBeUndefined();
	});
});
