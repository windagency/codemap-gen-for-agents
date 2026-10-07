// @vitest-environment jsdom
/// <reference lib="dom" />
import type { CallEdge, ClusteredGraph, ExternalNode, FileNode, ImportEdge, SymbolNode } from "src/core/types";
import { buildClientFlowViewScript } from "src/output/html/client-flow-view";
import { buildClientForceViewScript } from "src/output/html/client-force-view";
import { buildClientShellScript } from "src/output/html/client-shell";
import { matchesFilterNode } from "src/output/html/filter-engine";
import { HtmlTransformer } from "src/output/html/html-transformer";
import { computeImportChain } from "src/output/html/import-chain";
import { computeRegionId } from "src/output/html/module-regions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";

// The spec's Testing Decisions call for a manual
// keyboard/contrast pass on the shared design system (`06-frontend.md`'s "any new or changed UI
// component or page" bar, per `13-testing-strategy.md`'s Accessibility row). This file automates
// the structural half of that pass, in two layers:
//
//   1. Static markup - the generated document's body is parsed once via `DOMParser` and mounted
//      into a detached container for `vitest-axe`'s `axe()` runner (semantic elements, labels,
//      focusability). That requires this file's Vitest environment to be `jsdom` (axe reaches for
//      the *global* `document`, not an out-of-band instance). Asserts on `results.violations`
//      directly rather than the package's own `toHaveNoViolations` matcher, whose shipped `.d.ts`
//      only re-exports the matcher as a type, not a value.
//   2. The live diagrams - axe can only see what the client `<script>` bundles *render*, and
//      content assigned through `innerHTML` never executes per the HTML spec, so the diagram
//      nodes (the primary interactive surface of both views, and the thing most at risk of
//      silently regressing to mouse-only) were previously invisible to this pass entirely. The
//      tests below therefore mount the generated body and then execute the very same script
//      sources `HtmlTransformer` ships, built the same way it builds them - the codebase's
//      "pure algorithms tested then shipped via `.toString()`" pattern extended one step, so what
//      runs here is what runs in the browser.
//
// Colour contrast can't be judged without a real paint/layout engine, so that rule is disabled
// here and was checked by hand instead: `--cm-gold` (#d4af37) and `--cm-cyan` (#4fd7e0) on
// `--cm-bg` (#14161c) both exceed 7:1, and `--cm-text-secondary` (#a7a9b4) on the same background
// exceeds 4.5:1 - all comfortably pass WCAG AA for the sizes they're used at.

// `d3-timer` captures `window.requestAnimationFrame` at import time, so freezing the frame clock
// *before* d3 is loaded stops the Force view's physics loop and every d3 zoom transition from
// ticking in the background of this file. Nothing here asserts on animated state - only on the
// synchronous DOM the scripts produce - and a simulation still running at teardown is pure flake.
window.requestAnimationFrame = (() => 0) as unknown as typeof window.requestAnimationFrame;
const d3 = await import("d3");

function file(id: string, moduleId = 0): FileNode {
	return {
		id,
		kind: "file",
		name: id.split("/").pop() ?? id,
		extension: "ts",
		language: "typescript",
		moduleId,
		unassignedReason: null,
	};
}

const externalNode: ExternalNode = {
	id: "lodash",
	kind: "external",
	name: "lodash",
	version: "4.17.21",
	language: "typescript",
};

const importEdge: ImportEdge = {
	source: "a.ts",
	target: "lodash",
	kind: "static",
	type: "import",
	specifier: "lodash",
	viaReExport: false,
	locations: [{ startLine: 1, endLine: 1 }],
};

const fixtureGraph: ClusteredGraph = {
	nodes: [file("a.ts"), externalNode],
	edges: [importEdge],
};

function generatedBody(graph: ClusteredGraph = fixtureGraph): HTMLElement {
	const html = new HtmlTransformer().transform(graph);
	return new DOMParser().parseFromString(html, "text/html").body;
}

// Mounts the generated body and runs the client bundles against it. The inline `<script>` tags are
// dropped first (they are inert under `innerHTML` and the vendored D3 one is a ~300KB no-op here);
// the `#cm-data` JSON island stays, since the shell reads the graph out of it. D3 itself is
// supplied as `window.d3`, exactly as the generated document's own vendored bundle does.
function mountAndRunClientScripts(graph: ClusteredGraph = fixtureGraph): void {
	const body = generatedBody(graph);
	for (const script of Array.from(body.querySelectorAll("script"))) {
		if (script.id !== "cm-data") script.remove();
	}
	document.body.innerHTML = body.innerHTML;
	stubSvgGeometry();
	stubScrollIntoView();

	(window as unknown as { d3: unknown }).d3 = d3;
	for (const source of [
		buildClientShellScript(matchesFilterNode.toString()),
		buildClientFlowViewScript(computeImportChain.toString()),
		buildClientForceViewScript(computeRegionId.toString()),
	]) {
		new Function(source)();
	}
}

// jsdom's SVGSVGElement carries none of the SVG geometry interfaces, but `d3-zoom` reads
// `svg.width.baseVal.value` to work out a zoom extent. Give each stage svg the minimum shape it
// looks for; the numbers only decide the default extent, which nothing here asserts on.
function stubSvgGeometry(): void {
	for (const svg of Array.from(document.querySelectorAll("svg"))) {
		for (const [dimension, value] of [
			["width", 800],
			["height", 600],
		] as const) {
			Object.defineProperty(svg, dimension, {
				configurable: true,
				value: { baseVal: { value } },
			});
		}
	}
}

// jsdom implements no layout at all, so `Element.prototype.scrollIntoView` doesn't exist there -
// calling it (client-shell.ts's own auto-scroll-and-focus behaviour) would throw "not a function" in
// this harness alone, something a real browser never does. A harmless no-op stub, scoped to this
// mounted document only, lets the production code call the real DOM method unconditionally rather
// than feature-detecting a gap that's specific to this test environment.
function stubScrollIntoView(): void {
	Element.prototype.scrollIntoView = function scrollIntoViewStub(): void {};
}

function nodesOf(selector: string): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>(selector));
}

function classSnapshot(selector: string): Record<string, string> {
	const snapshot: Record<string, string> = {};
	for (const node of nodesOf(selector)) {
		snapshot[node.getAttribute("aria-label") ?? ""] = node.getAttribute("class") ?? "";
	}
	return snapshot;
}

function click(target: Element): void {
	target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function pressKey(target: Element, key: string): void {
	target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

afterEach(() => {
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("HtmlTransformer accessibility", () => {
	it("has no automatically detectable accessibility violations in the static shell/sidebar markup", async () => {
		const container = document.createElement("div");
		container.innerHTML = generatedBody().innerHTML;

		const results = await axe(container, {
			rules: {
				// No real paint/layout engine here to compute contrast against - checked by hand instead
				// (see the module comment above).
				"color-contrast": { enabled: false },
			},
		});

		expect(results.violations).toEqual([]);
	});

	it("has no automatically detectable accessibility violations in the diagrams the client scripts render", async () => {
		mountAndRunClientScripts();

		const results = await axe(document.body, {
			rules: {
				"color-contrast": { enabled: false },
			},
		});

		expect(results.violations).toEqual([]);
	});
});

// Both views' node selections go through `window.CM.makeActivatable` in `client-shell.ts`; these
// tests are what stops either of them regressing to a click-only `.on("click", ...)` again.
describe.each([
	{ view: "Flow", nodeSelector: ".cm-flow-node", svgId: "cm-flow-svg" },
	{ view: "Force", nodeSelector: ".cm-force-node", svgId: "cm-force-svg" },
])("$view view diagram nodes (executed client script)", (viewCase) => {
	it("renders nodes that are focusable, labelled, and exposed as controls", () => {
		mountAndRunClientScripts();

		const nodes = nodesOf(viewCase.nodeSelector);

		expect(nodes.length).toBeGreaterThan(0);
		for (const node of nodes) {
			expect(node.getAttribute("tabindex")).toBe("0");
			expect(node.getAttribute("role")).toBe("button");
			expect(node.getAttribute("aria-label")).toBeTruthy();
		}
	});

	it.each(["Enter", " "])("applies the same highlight on %s as on a click", (key) => {
		mountAndRunClientScripts();
		const svg = document.getElementById(viewCase.svgId);
		const node = document.querySelector(`${viewCase.nodeSelector}[aria-label^="a.ts,"]`);
		if (!svg || !node) throw new Error("fixture node not rendered");

		click(node);
		const afterClick = classSnapshot(viewCase.nodeSelector);
		click(svg);
		const afterClear = classSnapshot(viewCase.nodeSelector);
		pressKey(node, key);
		const afterKey = classSnapshot(viewCase.nodeSelector);

		expect(afterClick[node.getAttribute("aria-label") ?? ""]).toContain("cm-highlighted");
		expect(afterClear).not.toEqual(afterClick);
		expect(afterKey).toEqual(afterClick);
	});

	it("ignores keys that are not Enter or Space", () => {
		mountAndRunClientScripts();
		const node = document.querySelector(`${viewCase.nodeSelector}[aria-label^="a.ts,"]`);
		if (!node) throw new Error("fixture node not rendered");
		const before = classSnapshot(viewCase.nodeSelector);

		pressKey(node, "a");

		expect(classSnapshot(viewCase.nodeSelector)).toEqual(before);
	});
});

// client-shell.ts's wireViewSwitcher only ever toggled ".cm-stage" visibility; client-flow-view.ts
// appends its Flow-only "Step detail" card to the shared ".cm-sidebar" instead of html-transformer's
// static markup, and nothing scoped that card's visibility to the active view - it used to stay
// visible after switching to Force view. Both are fixed together: the card now carries
// `data-view="flow"` (client-flow-view.ts) and the switcher's toggle selector was broadened to
// ".cm-stage, .cm-sidebar [data-view]" (client-shell.ts) to cover it. Lives in this file because
// this is the one harness that executes the client bundles rather than inspecting their source text.
describe("view switcher hides Flow-only sidebar chrome", () => {
	it("hides the Step detail card in Force view and restores it back in Flow view", () => {
		mountAndRunClientScripts();
		const stepDetailCard = document.querySelector<HTMLElement>('.cm-sidebar [data-view="flow"]');
		if (!stepDetailCard) throw new Error("Step detail card not rendered");
		const forceButton = document.querySelector<HTMLElement>('.cm-view-switcher button[data-view="force"]');
		const flowButton = document.querySelector<HTMLElement>('.cm-view-switcher button[data-view="flow"]');
		if (!forceButton || !flowButton) throw new Error("view switcher not rendered");

		expect(stepDetailCard.hidden).toBe(false);

		click(forceButton);
		expect(stepDetailCard.hidden).toBe(true);

		click(flowButton);
		expect(stepDetailCard.hidden).toBe(false);
	});

	it("leaves other sidebar chrome (the Module legend) visible in both views", () => {
		mountAndRunClientScripts();
		const moduleLegendCard = document.getElementById("cm-module-legend")?.closest<HTMLElement>(".cm-card");
		const forceButton = document.querySelector<HTMLElement>('.cm-view-switcher button[data-view="force"]');
		if (!moduleLegendCard || !forceButton) {
			throw new Error("module legend or view switcher not rendered");
		}

		click(forceButton);

		expect(moduleLegendCard.hidden).toBe(false);
	});
});

describe("Sidebar cards are collapsible", () => {
	it("opens both the Modules card and the Step detail card by default, and collapses each via its own <summary>", () => {
		mountAndRunClientScripts();

		const moduleLegendCard = document
			.getElementById("cm-module-legend")
			?.closest<HTMLDetailsElement>("details.cm-card");
		const stepDetailCard = document.querySelector<HTMLDetailsElement>('details.cm-card[data-view="flow"]');
		if (!moduleLegendCard || !stepDetailCard) {
			throw new Error("a sidebar card was not rendered as a <details>");
		}

		expect(moduleLegendCard.open).toBe(true);
		expect(stepDetailCard.open).toBe(true);

		const moduleLegendSummary = moduleLegendCard.querySelector<HTMLElement>("summary");
		const stepDetailSummary = stepDetailCard.querySelector<HTMLElement>("summary");
		if (!moduleLegendSummary || !stepDetailSummary) {
			throw new Error("a card's <summary> was not rendered");
		}

		click(moduleLegendSummary);
		expect(moduleLegendCard.open).toBe(false);
		expect(stepDetailCard.open).toBe(true);

		click(stepDetailSummary);
		expect(stepDetailCard.open).toBe(false);

		click(moduleLegendSummary);
		expect(moduleLegendCard.open).toBe(true);
	});
});

describe("Module legend order", () => {
	it("sorts the Module legend alphabetically by name, not by Module id or the JSON envelope's execution-flow order", () => {
		// Module ids deliberately run the *opposite* way from alphabetical order ("zzz-module" has the
		// lower id, "aaa-module" the higher one), so this only passes if the legend is genuinely
		// sorted by name rather than coincidentally agreeing with id order.
		const multiModuleGraph: ClusteredGraph = {
			nodes: [file("zzz-module/a.ts", 2), file("aaa-module/b.ts", 9)],
			edges: [],
		};
		mountAndRunClientScripts(multiModuleGraph);

		const labels = Array.from(document.querySelectorAll<HTMLElement>("#cm-module-legend button.cm-list-item")).map(
			(item) => item.textContent?.trim(),
		);

		expect(labels).toStrictEqual(["aaa-module", "zzz-module"]);
	});
});

describe("Force view node scope", () => {
	it("renders File and External nodes but never a Symbol node (performance: a Symbol can outnumber Files many times over)", () => {
		const symbol: SymbolNode = {
			id: "a.ts#doThing",
			kind: "symbol",
			name: "doThing",
			symbolKind: "function",
			startLine: 1,
			endLine: 2,
			exported: true,
		};
		const graphWithSymbol: ClusteredGraph = {
			nodes: [file("a.ts", 0), externalNode, symbol],
			edges: [importEdge],
		};
		mountAndRunClientScripts(graphWithSymbol);

		const labels = Array.from(document.querySelectorAll<HTMLElement>(".cm-force-node")).map((node) =>
			node.getAttribute("aria-label"),
		);

		expect(labels.some((label) => label?.startsWith("doThing"))).toBe(false);
		expect(labels.some((label) => label?.startsWith("a.ts"))).toBe(true);
		expect(labels.some((label) => label?.startsWith("lodash"))).toBe(true);
	});
});

describe("Flow view step detail", () => {
	it("names the actual function that links the two files, not just the files themselves", () => {
		const callerSymbol: SymbolNode = {
			id: "a.ts#callerFn",
			kind: "symbol",
			name: "callerFn",
			symbolKind: "function",
			startLine: 1,
			endLine: 3,
			exported: true,
		};
		const calleeSymbol: SymbolNode = {
			id: "b.ts#calleeFn",
			kind: "symbol",
			name: "calleeFn",
			symbolKind: "function",
			startLine: 1,
			endLine: 2,
			exported: true,
		};
		const fileImport: ImportEdge = {
			source: "a.ts",
			target: "b.ts",
			kind: "static",
			type: "import",
			specifier: "./b",
			viaReExport: false,
			locations: [{ startLine: 1, endLine: 1 }],
		};
		const callLink: CallEdge = {
			source: "a.ts#callerFn",
			target: "b.ts#calleeFn",
			kind: "static",
			type: "call",
			locations: [{ startLine: 2, endLine: 2 }],
		};
		const graph: ClusteredGraph = {
			nodes: [file("a.ts"), file("b.ts"), callerSymbol, calleeSymbol],
			edges: [fileImport, callLink],
		};
		mountAndRunClientScripts(graph);

		const sourceBox = document.querySelector<HTMLElement>('.cm-flow-node[aria-label^="a.ts,"]');
		if (!sourceBox) throw new Error("fixture node not rendered");
		click(sourceBox);

		const badge = document.querySelector<HTMLElement>(".cm-flow-badge");
		if (!badge) throw new Error("import-chain step badge not rendered");
		click(badge);

		const links = Array.from(document.querySelectorAll<HTMLElement>(".cm-step-detail-links li")).map(
			(item) => item.textContent,
		);

		expect(links.some((text) => text?.includes("callerFn"))).toBe(true);
		expect(links.some((text) => text?.includes("calleeFn"))).toBe(true);
	});

	it("says so plainly when no function call actually links the two files (a type-only or side-effect import)", () => {
		const fileImport: ImportEdge = {
			source: "a.ts",
			target: "b.ts",
			kind: "static",
			type: "import",
			specifier: "./b",
			viaReExport: false,
			locations: [{ startLine: 1, endLine: 1 }],
		};
		const graph: ClusteredGraph = {
			nodes: [file("a.ts"), file("b.ts")],
			edges: [fileImport],
		};
		mountAndRunClientScripts(graph);

		const sourceBox = document.querySelector<HTMLElement>('.cm-flow-node[aria-label^="a.ts,"]');
		if (!sourceBox) throw new Error("fixture node not rendered");
		click(sourceBox);

		const badge = document.querySelector<HTMLElement>(".cm-flow-badge");
		if (!badge) throw new Error("import-chain step badge not rendered");
		click(badge);

		expect(document.querySelector(".cm-step-detail-links")).toBeNull();
		const hints = Array.from(document.querySelectorAll<HTMLElement>(".cm-hint")).map((hint) => hint.textContent);
		expect(hints.some((text) => text?.includes("No direct function calls found"))).toBe(true);
	});

	it("expands the Step detail card and moves focus to its newly-rendered title when a step badge is clicked", () => {
		const fileImport: ImportEdge = {
			source: "a.ts",
			target: "b.ts",
			kind: "static",
			type: "import",
			specifier: "./b",
			viaReExport: false,
			locations: [{ startLine: 1, endLine: 1 }],
		};
		const graph: ClusteredGraph = {
			nodes: [file("a.ts"), file("b.ts")],
			edges: [fileImport],
		};
		mountAndRunClientScripts(graph);

		const stepDetailCard = document.querySelector<HTMLDetailsElement>('details.cm-card[data-view="flow"]');
		if (!stepDetailCard) throw new Error("Step detail card not rendered");
		// Collapsed beforehand - proves the click reopens it, not merely that it started open.
		stepDetailCard.open = false;

		const sourceBox = document.querySelector<HTMLElement>('.cm-flow-node[aria-label^="a.ts,"]');
		if (!sourceBox) throw new Error("fixture node not rendered");
		click(sourceBox);

		const badge = document.querySelector<HTMLElement>(".cm-flow-badge");
		if (!badge) throw new Error("import-chain step badge not rendered");
		click(badge);

		expect(stepDetailCard.open).toBe(true);
		const title = document.querySelector(".cm-step-detail-title");
		expect(document.activeElement).toBe(title);
	});
});

// 14-observability.md's "Frontend is not exempt" - the instrumentation itself gets a test, on the
// path that actually fires it. It lives in this file because this is the one harness that executes
// the client bundles rather than inspecting their source text.
describe("client-side error reporting", () => {
	it("logs an uncaught error as a structured entry", () => {
		mountAndRunClientScripts();
		const consoleError = vi.spyOn(window.console, "error").mockImplementation(() => {});

		window.dispatchEvent(
			new ErrorEvent("error", {
				message: "boom",
				error: new Error("boom"),
				filename: "codemap.html",
				lineno: 42,
			}),
		);

		expect(consoleError).toHaveBeenCalled();
		const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0]));
		expect(entry).toMatchObject({
			level: "error",
			source: "window.error",
			reason: "boom",
			file: "codemap.html",
			line: 42,
		});
		expect(typeof entry.timestamp).toBe("string");
	});

	it("logs an unhandled promise rejection as a structured entry", () => {
		mountAndRunClientScripts();
		const consoleError = vi.spyOn(window.console, "error").mockImplementation(() => {});

		const rejection = new Event("unhandledrejection") as Event & {
			reason?: unknown;
		};
		rejection.reason = new Error("nope");
		window.dispatchEvent(rejection);

		expect(consoleError).toHaveBeenCalled();
		const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0]));
		expect(entry).toMatchObject({
			level: "error",
			source: "window.unhandledrejection",
			reason: "nope",
		});
	});
});
