// Ticket 01's shared client-side runtime:
// parses the embedded graph, owns the view switcher, the shared zoom-control-stack factory, the
// tooltip, the filter-sidebar inputs (debounced ~220ms), the Module legend, the client-side error
// reporter, and the cross-screen helpers (keyboard activation, dim/highlight class application,
// Module ordering) both diagrams share. Screens register themselves via `window.CM.registerView`
// and are left to render their own diagram (tickets 02/03).
// Written as a plain-JS template (not type-checked TS) since it ships verbatim inside the
// generated HTML's inline `<script>` - only the pure algorithms it calls are separately
// type-checked and unit-tested (`filter-engine.ts`, `import-chain.ts`, `module-regions.ts`).
export function buildClientShellScript(matchesFilterNodeSource: string): string {
	return `
(function () {
  "use strict";

  // Client-side error tracking (CODING_RULES/14-observability.md's "Frontend is not exempt").
  // Deliberate deviation from that rule's "route it into the same observability pipeline as the
  // backend": this build artefact is a single self-contained *offline* HTML file with zero network
  // dependency by design (same constraint that makes html-transformer.ts vendor D3 inline instead
  // of linking a CDN). There is no server, no session and no endpoint to ship telemetry to, and
  // inventing one would both break that guarantee and silently exfiltrate a user's private
  // codebase structure. Structured console output - the same JSON entry shape as
  // src/core/observability/logger.ts writes server-side - is therefore the honest ceiling here:
  // whoever opens the file still gets a parseable, contextful record in DevTools instead of a
  // silent failure. If this ever gains a host page, route reportClientError through it.
  function reportClientError(context) {
    var entry = { timestamp: new Date().toISOString(), level: "error", message: "codemap.html client error" };
    for (var key in context) {
      if (Object.prototype.hasOwnProperty.call(context, key) && context[key] !== undefined) {
        entry[key] = context[key];
      }
    }
    window.console.error(JSON.stringify(entry));
  }

  window.addEventListener("error", function (event) {
    var error = event.error;
    reportClientError({
      source: "window.error",
      reason: (error && error.message) || event.message || "unknown error",
      stack: error && error.stack,
      file: event.filename || undefined,
      line: typeof event.lineno === "number" ? event.lineno : undefined,
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    reportClientError({
      source: "window.unhandledrejection",
      reason: (reason && reason.message) || String(reason),
      stack: reason && reason.stack,
    });
  });

  ${matchesFilterNodeSource}

  var dataEl = document.getElementById("cm-data");
  var rawData = JSON.parse(dataEl.textContent);
  var nodes = rawData.nodes;
  var edges = rawData.edges;
  var modules = rawData.modules;
  var nodesById = new Map(nodes.map(function (n) { return [n.id, n]; }));
  var moduleNameById = new Map(modules.map(function (m) { return [m.id, m.name]; }));

  // Ordinal (not locale-aware) string comparison, matching every server-side sort in this
  // generator - a reader scanning the legend shouldn't see its order change with the browser's
  // locale.
  function compareStrings(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  // "Which Modules does this set of nodes contain, in a stable order" is needed by the legend here
  // and by client-flow-view.ts's column layout over its own (filtered) node set - one dedupe/sort,
  // exposed on window.CM, so the legend order and the column order can never disagree. Sorted
  // alphabetically by name (not Module id, which is an arbitrary clustering artifact, and not the
  // JSON envelope's own execution-flow order, which favours a dependency-first reading order over
  // being easy to scan by eye) - a human looking for one specific Module in this list benefits more
  // from alphabetical than either of those.
  function sortedModuleIds(nodeList) {
    return Array.from(
      new Set(
        nodeList
          .filter(function (n) { return n.kind === "file" && n.moduleId !== null && n.moduleId !== undefined; })
          .map(function (n) { return n.moduleId; })
      )
    ).sort(function (a, b) {
      return compareStrings(nameForModuleId(a), nameForModuleId(b)) || (a - b);
    });
  }

  var moduleIds = sortedModuleIds(nodes);

  var directoryIds = Array.from(
    new Set(
      nodes
        .filter(function (n) { return n.kind === "directory"; })
        .map(function (n) { return n.id; })
    )
  ).sort();

  var moduleColorScale = window.d3.scaleOrdinal(window.d3.schemeTableau10).domain(moduleIds);
  // Reuses shared-css.ts's --cm-text-tertiary/--cm-external-color tokens as the single source of
  // truth for these colours, rather than a second hardcoded copy of the same hex values drifting
  // independently.
  var UNASSIGNED_COLOR = window.getComputedStyle(document.documentElement).getPropertyValue("--cm-text-tertiary").trim();
  var EXTERNAL_COLOR = window.getComputedStyle(document.documentElement).getPropertyValue("--cm-external-color").trim();

  function colorForModuleId(moduleId) {
    if (moduleId === null || moduleId === undefined) return UNASSIGNED_COLOR;
    return moduleColorScale(moduleId);
  }

  function nameForModuleId(moduleId) {
    if (moduleId === null || moduleId === undefined) return "Unassigned";
    return moduleNameById.get(moduleId) || ("Module " + moduleId);
  }

  var filters = { path: "", symbolKind: "", search: "", language: "" };

  function hasActiveFilter() {
    return !!(filters.path || filters.symbolKind || filters.search || filters.language);
  }

  function isFilterMatched(node) {
    if (!hasActiveFilter()) return false;
    return matchesFilterNode(node, {
      path: filters.path || undefined,
      symbolKind: filters.symbolKind || undefined,
      search: filters.search || undefined,
      language: filters.language || undefined,
    }, nodesById);
  }

  var views = {};
  var activeViewName = "flow";

  function registerView(name, view) {
    views[name] = view;
  }

  function activeView() {
    return views[activeViewName];
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(self, args);
      }, wait);
    };
  }

  function onFilterChanged() {
    for (var name in views) {
      if (views[name] && views[name].onFilterChanged) views[name].onFilterChanged();
    }
  }

  var onFilterChangedDebounced = debounce(onFilterChanged, 220);

  var tooltipEl = document.getElementById("cm-tooltip");
  function showTooltip(text, x, y) {
    tooltipEl.textContent = text;
    tooltipEl.style.left = x + 12 + "px";
    tooltipEl.style.top = y + 12 + "px";
    tooltipEl.classList.add("is-visible");
  }
  function hideTooltip() {
    tooltipEl.classList.remove("is-visible");
  }

  function createZoomController(svgSelection, viewportSelection) {
    var zoom = window.d3.zoom().scaleExtent([0.1, 8]).on("zoom", function (event) {
      viewportSelection.attr("transform", event.transform);
    });
    svgSelection.call(zoom);

    function center() {
      var node = svgSelection.node();
      var rect = node.getBoundingClientRect();
      return [rect.width / 2, rect.height / 2];
    }

    function zoomBy(factor) {
      svgSelection.transition().duration(150).call(zoom.scaleBy, factor, center());
    }

    function fitToBounds(bounds, animate) {
      var node = svgSelection.node();
      var rect = node.getBoundingClientRect();
      var width = rect.width || 800;
      var height = rect.height || 600;
      var boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
      var boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
      var padding = 60;
      var scale = Math.min(
        8,
        Math.max(0.1, Math.min((width - padding) / boundsWidth, (height - padding) / boundsHeight))
      );
      var midX = (bounds.minX + bounds.maxX) / 2;
      var midY = (bounds.minY + bounds.maxY) / 2;
      var transform = window.d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-midX, -midY);
      var target = animate === false ? svgSelection : svgSelection.transition().duration(300);
      target.call(zoom.transform, transform);
    }

    function reset(fullBounds) {
      fitToBounds(fullBounds);
    }

    return {
      zoomIn: function () { zoomBy(1.3); },
      zoomOut: function () { zoomBy(1 / 1.3); },
      fitToBounds: fitToBounds,
      reset: reset,
      zoomBehavior: zoom,
    };
  }

  // WCAG 2.0 AA / CODING_RULES 06-frontend.md: everything clickable is keyboard-operable. A
  // diagram node can't be a real <button> (it's an SVG <g> positioned in diagram coordinates), so
  // it gets the manual equivalent - focusable, named, and activated by Enter/Space through the
  // exact same handler the click uses. Both screens' node selections go through this one helper so
  // neither can regress to being mouse-only again (asserted in html-transformer.a11y.test.ts).
  function makeActivatable(selection, spec) {
    return selection
      .attr("tabindex", 0)
      .attr("role", spec.role || "button")
      .attr("aria-label", spec.label)
      .on("keydown", function (event, d) {
        if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
        // Space would otherwise scroll the stage, Enter would bubble to the svg's clear-highlight.
        event.preventDefault();
        event.stopPropagation();
        spec.activate.call(this, event, d);
      });
  }

  // The click/hover/keyboard-focus wiring on a diagram's node selection is identical on both
  // screens - click activates (stopping propagation so the svg's own click-to-clear-highlight
  // doesn't also fire), hover and keyboard focus both show the shared tooltip, and makeActivatable
  // layers on the keyboard-equivalent of that same click. Only what "activate" does and how a node
  // describes itself (spec.activate / spec.label) differ per view, which is what the spec supplies.
  // Sharing this means the two screens' node interactivity can't quietly drift apart (asserted in
  // html-transformer.a11y.test.ts).
  function wireNodeInteractions(selection, spec) {
    selection
      .on("click", function (event, d) {
        event.stopPropagation();
        spec.activate(event, d);
      })
      .on("mouseenter", function (event, d) {
        showTooltip(d.name, event.clientX, event.clientY);
      })
      .on("mouseleave", function () {
        hideTooltip();
      })
      .on("focus", function (event, d) {
        var rect = this.getBoundingClientRect();
        showTooltip(d.name, rect.left, rect.top);
      })
      .on("blur", function () {
        hideTooltip();
      });

    makeActivatable(selection, {
      label: spec.label,
      activate: spec.activate,
    });

    return selection;
  }

  // The dim / highlight / filter-match class triad behaves identically on both screens - only
  // "what counts as highlighted" and "which node backs this datum" differ, which is what the spec
  // callbacks supply. Keeping the rule here means a change to how filters and highlights coexist
  // lands in one place instead of two divergent copies.
  function applyStateClasses(selection, spec) {
    var hasFilter = hasActiveFilter();
    selection
      .classed("cm-dimmed", function (d) {
        var dimByHighlight = spec.highlightActive && !spec.isHighlighted(d);
        var dimByFilter = hasFilter && !spec.isFilterMatched(d);
        return dimByHighlight || dimByFilter;
      })
      .classed("cm-highlighted", function (d) { return spec.isHighlighted(d); });
    // Only node selections opt into cm-filter-matched: the stylesheets use it to punch a
    // filter-matched *node* back through a dim, while a link stays dimmed unless its own
    // highlight says otherwise.
    if (spec.markFilterMatched) {
      selection.classed("cm-filter-matched", function (d) { return hasFilter && spec.isFilterMatched(d); });
    }
    return selection;
  }

  // Both screens' own applyClasses() called applyStateClasses twice in the exact same shape - once
  // for the node selection (always opting into cm-filter-matched), once for the link/edge selection
  // (never opting in) - passing the same highlightActive flag to both calls. Only "what counts as
  // highlighted/filter-matched" for a node vs. a link differ per view (nodeSpec/linkSpec), which is
  // what each screen's applyClasses() still supplies locally.
  function applyViewStateClasses(nodeSelection, linkSelection, highlightActive, nodeSpec, linkSpec) {
    applyStateClasses(nodeSelection, {
      highlightActive: highlightActive,
      isHighlighted: nodeSpec.isHighlighted,
      isFilterMatched: nodeSpec.isFilterMatched,
      markFilterMatched: true,
    });
    applyStateClasses(linkSelection, {
      highlightActive: highlightActive,
      isHighlighted: linkSpec.isHighlighted,
      isFilterMatched: linkSpec.isFilterMatched,
    });
  }

  // Both screens reduce some collection of positioned items down to a single bounding rectangle
  // (Flow view's box layout, Force view's live simulation coordinates) so their zoom controller can
  // fit the stage to it. Only "what counts as one item's extent" differs between them, which is
  // what \`extentOf\` supplies; this owns the shared Infinity-seeded min/max reduce and the
  // no-items-contributed case (returns null rather than guessing a fallback rectangle, since only
  // the caller knows what an empty diagram should default to).
  function computeBounds(items, extentOf) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    items.forEach(function (item) {
      var extent = extentOf(item);
      minX = Math.min(minX, extent.minX);
      minY = Math.min(minY, extent.minY);
      maxX = Math.max(maxX, extent.maxX);
      maxY = Math.max(maxY, extent.maxY);
    });
    if (!isFinite(minX)) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  // Both screens' own bounds-for-a-highlight helper (Flow view's boundsForIds, Force view's
  // currentBoundsFor) reduced to the same two steps: narrow the full item collection down to the
  // subset named by an id set (or keep everything, when the set is absent/empty - a Flow highlight
  // clear or a Force view with no active highlight/filter both mean "fit the whole graph"), then
  // reduce that subset via computeBounds. Only how one item exposes its own id (idOf) and its own
  // extent (extentOf) differ per view. Padding and the "no items at all" fallback rectangle stay
  // caller-side deliberately: Flow only pads its *full*-graph bounds by the header row and leaves a
  // highlighted subset unpadded, while Force pads every bounds call by a fixed margin - those are
  // real differences in what each screen wants framed, not incidental duplication.
  function boundsForSubset(items, idOf, extentOf, ids) {
    var relevant = items;
    if (ids && ids.size > 0) {
      relevant = items.filter(function (item) { return ids.has(idOf(item)); });
      if (relevant.length === 0) relevant = items;
    }
    return computeBounds(relevant, extentOf);
  }

  function wireZoomControls(container, controller, onReset) {
    var group = container.querySelector('[data-zoom-in]');
    var groupOut = container.querySelector('[data-zoom-out]');
    var groupReset = container.querySelector('[data-zoom-reset]');
    if (group) group.addEventListener("click", function () { controller.zoomIn(); });
    if (groupOut) groupOut.addEventListener("click", function () { controller.zoomOut(); });
    if (groupReset) groupReset.addEventListener("click", function () { onReset(); });
  }

  function renderModuleLegend() {
    var legendEl = document.getElementById("cm-module-legend");
    legendEl.innerHTML = "";
    moduleIds.forEach(function (moduleId) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "cm-list-item";
      item.dataset.moduleId = String(moduleId);
      var swatch = document.createElement("span");
      swatch.className = "cm-legend-swatch";
      swatch.style.background = colorForModuleId(moduleId);
      var label = document.createElement("span");
      label.textContent = nameForModuleId(moduleId);
      item.appendChild(swatch);
      item.appendChild(label);
      item.addEventListener("click", function () {
        var view = activeView();
        if (view && view.highlightModule) view.highlightModule(moduleId);
      });
      legendEl.appendChild(item);
    });
    var unassignedItem = document.createElement("div");
    unassignedItem.className = "cm-list-item";
    var unassignedSwatch = document.createElement("span");
    unassignedSwatch.className = "cm-legend-swatch";
    unassignedSwatch.style.background = UNASSIGNED_COLOR;
    var unassignedLabel = document.createElement("span");
    unassignedLabel.textContent = "Unassigned";
    unassignedItem.appendChild(unassignedSwatch);
    unassignedItem.appendChild(unassignedLabel);
    legendEl.appendChild(unassignedItem);
  }

  function renderPathOptions() {
    var pathSelect = document.getElementById("cm-filter-path");
    directoryIds.forEach(function (id) {
      var option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      pathSelect.appendChild(option);
    });
  }

  function wireFilterInputs() {
    var pathSelect = document.getElementById("cm-filter-path");
    var symbolKindSelect = document.getElementById("cm-filter-symbolkind");
    var searchInput = document.getElementById("cm-filter-search");
    var languageSelect = document.getElementById("cm-filter-language");

    pathSelect.addEventListener("change", function () {
      filters.path = pathSelect.value;
      onFilterChanged();
    });
    symbolKindSelect.addEventListener("change", function () {
      filters.symbolKind = symbolKindSelect.value;
      onFilterChangedDebounced();
    });
    searchInput.addEventListener("input", function () {
      filters.search = searchInput.value.trim();
      onFilterChangedDebounced();
    });
    languageSelect.addEventListener("change", function () {
      filters.language = languageSelect.value;
      onFilterChanged();
    });
  }

  function wireViewSwitcher() {
    var buttons = document.querySelectorAll(".cm-view-switcher button");
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        var viewName = button.dataset.view;
        if (viewName === activeViewName) return;
        activeViewName = viewName;
        buttons.forEach(function (b) { b.classList.toggle("is-active", b === button); });
        // ".cm-sidebar [data-view]" catches view-only chrome a screen appends to the shared
        // sidebar at runtime (e.g. client-flow-view.ts's "Step detail" card) alongside the two
        // ".cm-stage" panels - anything under .cm-sidebar with no data-view (the Module legend,
        // the filter inputs) is untouched by this selector and stays visible in both views.
        document.querySelectorAll(".cm-stage, .cm-sidebar [data-view]").forEach(function (stage) {
          stage.hidden = stage.dataset.view !== viewName;
        });
        var view = activeView();
        if (view && view.onActivate) view.onActivate();
      });
    });
  }

  renderPathOptions();
  wireFilterInputs();
  wireViewSwitcher();
  renderModuleLegend();

  window.CM = {
    nodes: nodes,
    edges: edges,
    nodesById: nodesById,
    isFilterMatched: isFilterMatched,
    hasActiveFilter: hasActiveFilter,
    colorForModuleId: colorForModuleId,
    nameForModuleId: nameForModuleId,
    unassignedColor: UNASSIGNED_COLOR,
    externalColor: EXTERNAL_COLOR,
    sortedModuleIds: sortedModuleIds,
    makeActivatable: makeActivatable,
    wireNodeInteractions: wireNodeInteractions,
    applyStateClasses: applyStateClasses,
    applyViewStateClasses: applyViewStateClasses,
    computeBounds: computeBounds,
    boundsForSubset: boundsForSubset,
    reportError: reportClientError,
    registerView: registerView,
    createZoomController: createZoomController,
    wireZoomControls: wireZoomControls,
    showTooltip: showTooltip,
    hideTooltip: hideTooltip,
    onViewReady: function (name) {
      if (name === activeViewName) {
        var view = views[name];
        if (view && view.onActivate) view.onActivate();
      }
    },
  };
})();
`;
}
