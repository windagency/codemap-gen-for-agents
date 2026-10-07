import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ClusteredGraph } from "src/core/types";
import { SYMBOL_KINDS } from "src/core/types";
import { buildClientFlowViewScript } from "src/output/html/client-flow-view";
import { buildClientForceViewScript } from "src/output/html/client-force-view";
import { buildClientShellScript } from "src/output/html/client-shell";
import { matchesFilterNode } from "src/output/html/filter-engine";
import { FLOW_VIEW_CSS } from "src/output/html/flow-view-css";
import { FORCE_VIEW_CSS } from "src/output/html/force-view-css";
import { computeImportChain } from "src/output/html/import-chain";
import { computeRegionId } from "src/output/html/module-regions";
import { SHARED_CSS } from "src/output/html/shared-css";
import { buildMapJson } from "src/output/json/build-map-json";
import type { Transformer, TransformOptions } from "src/output/transformer";

const require = createRequire(import.meta.url);

// D3 vendored/inlined at generation time (the spec's "Self-contained means zero network
// dependency" principle): read once from the installed `d3` package's own
// pre-built dist bundle, never fetched from a CDN `<script src>`. `d3`'s `exports` map only
// publishes its `.` entry (`src/index.js`) and the `dist/*` bundles aren't a declared subpath, so
// `require.resolve("d3/dist/d3.min.js")` is refused by Node's package-exports enforcement - this
// resolves the always-allowed `.` entry instead and walks up from `<pkg>/src/index.js` to the
// package root to reach `dist/d3.min.js` via a plain filesystem read, which the exports map has no
// say over.
function loadVendoredD3Source(): string {
	const d3EntryPath = require.resolve("d3");
	const d3PackageRoot = path.dirname(path.dirname(d3EntryPath));
	const d3DistPath = path.join(d3PackageRoot, "dist", "d3.min.js");
	try {
		return fs.readFileSync(d3DistPath, "utf8");
	} catch (error) {
		throw new Error(
			`Failed to load vendored D3 bundle from ${d3DistPath} (resolved from the installed ` +
				`"d3" package's entry at ${d3EntryPath}). Check that the "d3" dependency is installed ` +
				`and that its package layout still ships dist/d3.min.js at the package root - a d3 ` +
				`version bump may have moved or renamed this file.`,
			{ cause: error },
		);
	}
}

// A literal `</script` anywhere inside vendored/generated JS or JSON text would prematurely close
// the enclosing inline `<script>` tag when the browser's HTML parser scans for it - regardless of
// that tag's `type` attribute. Every string embedded inside a `<script>` block goes through this.
function escapeScriptClose(text: string): string {
	return text.replace(/<\/script/gi, "<\\/script");
}

function renderSymbolKindOptions(): string {
	return SYMBOL_KINDS.map((kind) => `<option value="${kind}">${kind}</option>`).join("");
}

function renderLanguageOptions(languages: readonly string[]): string {
	return languages.map((language) => `<option value="${language}">${language}</option>`).join("");
}

function renderZoomControls(idPrefix: string): string {
	return `
    <div class="cm-zoom-controls" id="${idPrefix}-zoom">
      <button type="button" data-zoom-in aria-label="Zoom in">+</button>
      <button type="button" data-zoom-reset aria-label="Reset view">&#9679;</button>
      <button type="button" data-zoom-out aria-label="Zoom out">&minus;</button>
    </div>`;
}

interface DocumentSources {
	title: string;
	dataJson: string;
	languages: readonly string[];
	d3Source: string;
	shellScript: string;
	flowScript: string;
	forceScript: string;
}

function renderDocument(sources: DocumentSources): string {
	const { title, dataJson, languages, d3Source, shellScript, flowScript, forceScript } = sources;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${SHARED_CSS}
${FLOW_VIEW_CSS}
${FORCE_VIEW_CSS}
</style>
</head>
<body>
<div class="cm-app">
  <div class="cm-main">
    <header class="cm-topbar" aria-label="Codemap view and filters">
      <div class="cm-view-switcher">
        <button type="button" data-view="flow" class="is-active">Flow view</button>
        <button type="button" data-view="force">Force-directed view</button>
      </div>
      <div class="cm-topbar-divider"></div>
      <div class="cm-topbar-filters">
        <div class="cm-field">
          <label for="cm-filter-path">Path</label>
          <select id="cm-filter-path">
            <option value="">Any</option>
          </select>
        </div>
        <div class="cm-field">
          <label for="cm-filter-symbolkind">Symbol kind</label>
          <select id="cm-filter-symbolkind">
            <option value="">Any</option>
            ${renderSymbolKindOptions()}
          </select>
        </div>
        <div class="cm-field">
          <label for="cm-filter-search">Search</label>
          <input type="text" id="cm-filter-search" placeholder="Search names">
        </div>
        <div class="cm-field">
          <label for="cm-filter-language">Language</label>
          <select id="cm-filter-language">
            <option value="">Any</option>
            ${renderLanguageOptions(languages)}
          </select>
        </div>
      </div>
    </header>
    <div class="cm-body">
      <div class="cm-stage" id="cm-flow-stage" data-view="flow">
        <svg id="cm-flow-svg"></svg>
        ${renderZoomControls("cm-flow")}
      </div>
      <div class="cm-stage" id="cm-force-stage" data-view="force" hidden>
        <svg id="cm-force-svg"></svg>
        ${renderZoomControls("cm-force")}
      </div>
      <div class="cm-tooltip" id="cm-tooltip"></div>
    </div>
  </div>
  <aside class="cm-sidebar" aria-label="Codemap details">
    <details class="cm-card" open>
      <summary class="cm-section-label">Modules</summary>
      <div class="cm-legend" id="cm-module-legend"></div>
      <p class="cm-hint">Click a Module to highlight its footprint in Flow view.</p>
    </details>
  </aside>
</div>
<script id="cm-data" type="application/json">${escapeScriptClose(dataJson)}</script>
<script>${escapeScriptClose(d3Source)}</script>
<script>${escapeScriptClose(shellScript)}</script>
<script>${escapeScriptClose(flowScript)}</script>
<script>${escapeScriptClose(forceScript)}</script>
</body>
</html>
`;
}

// Real `HtmlTransformer`: renders a single self-
// contained HTML file with a client-side view switcher between Flow view and Force-directed view,
// sharing one design system and one AND-filter engine, with D3 vendored inline. Each pure algorithm
// it embeds (`matchesFilterNode`/`computeImportChain`/`computeRegionId`) is unit-tested in its own
// module and shipped to the client via `.toString()` on the exact tested function, so the tested
// logic is what runs in the browser, never a hand-copied duplicate of it.
export class HtmlTransformer implements Transformer {
	transform(graph: ClusteredGraph, options?: TransformOptions): string {
		const mapJson = buildMapJson(graph);
		const dataJson = JSON.stringify(mapJson);
		const d3Source = loadVendoredD3Source();
		const shellScript = buildClientShellScript(matchesFilterNode.toString());
		const flowScript = buildClientFlowViewScript(computeImportChain.toString());
		const forceScript = buildClientForceViewScript(computeRegionId.toString());

		return renderDocument({
			title: options?.title ?? "Code map",
			dataJson,
			languages: mapJson.languages,
			d3Source,
			shellScript,
			flowScript,
			forceScript,
		});
	}
}
