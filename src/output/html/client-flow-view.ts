// Ticket 02's Flow view client script:
// fixed stage-column layout over File/External nodes, curved import connectors, Module highlight
// (via the sidebar's Module legend) and cycle-safe numbered import-chain highlight (via clicking a
// File box), with filter/highlight coexistence. Registers itself with `window.CM` from
// `client-shell.ts` and never redefines that shell's chrome or filter-matching logic. Written as a
// plain-JS template for the same reason as `client-shell.ts`.
export function buildClientFlowViewScript(computeImportChainSource: string): string {
	return `
(function () {
  "use strict";

  ${computeImportChainSource}

  var COLUMN_WIDTH = 220;
  var BOX_WIDTH = 160;
  var BOX_HEIGHT = 40;
  var ROW_GAP = 18;
  var MARGIN = 60;
  var HEADER_HEIGHT = 28;

  var svg = window.d3.select("#cm-flow-svg");
  var viewport = svg.append("g").attr("class", "cm-flow-viewport");
  var linksLayer = viewport.append("g").attr("class", "cm-flow-links");
  var nodesLayer = viewport.append("g").attr("class", "cm-flow-nodes");
  var badgesLayer = viewport.append("g").attr("class", "cm-flow-badges");
  var headersLayer = viewport.append("g").attr("class", "cm-flow-headers");

  // Step detail card: appended to the shared sidebar rather than baked into html-transformer.ts's
  // static markup, since it is a Flow-view-only surface (Force-directed view has no import-chain
  // steps) - this way client-shell.ts's shared shell chrome stays untouched. A native
  // <details>/<summary> disclosure (open by default, matching the card's previous always-visible
  // state) - collapsible with no custom JS/ARIA wiring, fully keyboard- and screen-reader-operable
  // for free (CODING_RULES/06-frontend.md's "semantic HTML for interactive elements").
  var stepDetailCard = document.createElement("details");
  stepDetailCard.className = "cm-card";
  stepDetailCard.open = true;
  // Same data-view convention client-shell.ts's .cm-stage elements already use, so
  // wireViewSwitcher's visibility toggle (broadened to ".cm-sidebar [data-view]") hides this
  // Flow-only card when Force view is active instead of leaving it stranded in the shared sidebar.
  stepDetailCard.dataset.view = "flow";
  var stepDetailLabel = document.createElement("summary");
  stepDetailLabel.className = "cm-section-label";
  stepDetailLabel.textContent = "Step detail";
  var stepDetailBody = document.createElement("div");
  stepDetailCard.appendChild(stepDetailLabel);
  stepDetailCard.appendChild(stepDetailBody);
  document.querySelector(".cm-sidebar").appendChild(stepDetailCard);

  function clearStepDetail() {
    stepDetailBody.innerHTML = "";
    var hint = document.createElement("p");
    hint.className = "cm-hint";
    hint.textContent = "Click a numbered step to see its import detail.";
    stepDetailBody.appendChild(hint);
  }

  var MAX_SYMBOL_LINKS_SHOWN = 20;

  // A File/External id has no "#"; a Symbol id is always "<fileId>#<localId>" - stripping back to
  // the first "#" recovers the owning File regardless of how many "#"s a Symbol's own localId
  // might itself contain.
  function fileIdOfSymbol(symbolId) {
    var hashIndex = symbolId.indexOf("#");
    return hashIndex === -1 ? symbolId : symbolId.slice(0, hashIndex);
  }

  function describeLocations(locations) {
    if (!locations || locations.length === 0) return "";
    return locations
      .map(function (loc) {
        return loc.startLine === loc.endLine
          ? "line " + loc.startLine
          : "lines " + loc.startLine + "-" + loc.endLine;
      })
      .join(", ");
  }

  // The file-level import edge clicked to open this step only ever carries the raw specifier
  // ("./utils") and where the import statement itself sits - it has no idea which specific
  // function/class/const in the source file actually uses something from the target file. That's
  // only visible at the symbol level, via the same graph's "call" edges (symbol -> symbol) - this
  // narrows them down to exactly the pair of files this one step connects.
  function symbolLevelLinksFor(edge) {
    return window.CM.edges.filter(function (e) {
      return (
        e.type === "call" &&
        fileIdOfSymbol(e.source) === edge.source &&
        fileIdOfSymbol(e.target) === edge.target
      );
    });
  }

  function appendSymbolLinks(edge) {
    var symbolLinks = symbolLevelLinksFor(edge);
    var note = document.createElement("p");
    note.className = "cm-hint";
    if (symbolLinks.length === 0) {
      note.textContent =
        "No direct function calls found between these files - likely a type-only or side-effect import.";
      stepDetailBody.appendChild(note);
      return;
    }

    note.textContent = "Linked by:";
    stepDetailBody.appendChild(note);

    var list = document.createElement("ul");
    list.className = "cm-step-detail-links";
    symbolLinks.slice(0, MAX_SYMBOL_LINKS_SHOWN).forEach(function (callEdge) {
      var callerNode = window.CM.nodesById.get(callEdge.source);
      var calleeNode = window.CM.nodesById.get(callEdge.target);
      var callerName = callerNode ? callerNode.name : callEdge.source;
      var calleeName = calleeNode ? calleeNode.name : callEdge.target;
      var callLocation = describeLocations(callEdge.locations);
      var item = document.createElement("li");
      item.textContent =
        callerName + "() → " + calleeName + "()" + (callLocation ? " (" + callLocation + ")" : "");
      list.appendChild(item);
    });
    stepDetailBody.appendChild(list);

    if (symbolLinks.length > MAX_SYMBOL_LINKS_SHOWN) {
      var more = document.createElement("p");
      more.className = "cm-hint";
      more.textContent = "+" + (symbolLinks.length - MAX_SYMBOL_LINKS_SHOWN) + " more";
      stepDetailBody.appendChild(more);
    }
  }

  function renderStepDetail(edge, number) {
    var sourceNode = window.CM.nodesById.get(edge.source);
    var targetNode = window.CM.nodesById.get(edge.target);
    var sourceName = sourceNode ? sourceNode.name : edge.source;
    var targetName = targetNode ? targetNode.name : edge.target;

    stepDetailBody.innerHTML = "";
    var title = document.createElement("p");
    title.className = "cm-step-detail-title";
    title.textContent = "Step " + number + ": " + sourceName + " → " + targetName;
    // Not an interactive element, but it's the one piece of newly-rendered content worth a
    // keyboard or screen-reader user's immediate attention - tabindex="-1" makes it a valid
    // .focus() target (still unreachable by Tab) without claiming it's a control.
    title.setAttribute("tabindex", "-1");
    stepDetailBody.appendChild(title);

    var importLine = document.createElement("p");
    importLine.className = "cm-hint";
    var locationText = describeLocations(edge.locations);
    importLine.textContent =
      (edge.viaReExport ? "Re-exports " : "Imports ") +
      '"' + edge.specifier + '"' +
      (locationText ? " (" + locationText + ")" : "");
    stepDetailBody.appendChild(importLine);

    appendSymbolLinks(edge);

    // The card this content just populated may be collapsed, scrolled out of view, or both -
    // clicking a step badge should surface its own result without a second manual step. Expanding
    // before scrolling/focusing matters: a collapsed <details> can't bring its own (hidden) content
    // into view or receive focus inside it.
    stepDetailCard.open = true;
    stepDetailCard.scrollIntoView({ block: "nearest" });
    title.focus();
  }

  clearStepDetail();

  var zoomControlsEl = document.getElementById("cm-flow-zoom");
  var controller = window.CM.createZoomController(svg, viewport);

  var flowNodes = window.CM.nodes.filter(function (n) { return n.kind === "file" || n.kind === "external"; });
  var flowNodeIds = flowNodes.map(function (n) { return n.id; });
  var flowNodeIdSet = new Set(flowNodeIds);
  var importEdges = window.CM.edges.filter(function (e) {
    return e.type === "import" && flowNodeIdSet.has(e.source) && flowNodeIdSet.has(e.target);
  });

  // Columns group File/External boxes by Module (ticket 02's "fixed columns by pipeline
  // stage" is realised as one column per Module, so the column header is the Module name a
  // human already recognises from the sidebar legend), with trailing Unassigned/External
  // columns for nodes that carry no Module. \`flowNodes\` only ever holds File/External kinds
  // (filtered above), so this lookup only needs an entry per kind rather than a cascade.
  var COLUMN_KEY_STRATEGY_BY_KIND = {
    external: function () { return "external"; },
    file: function (node) {
      return node.moduleId === null || node.moduleId === undefined
        ? "unassigned"
        : "module:" + node.moduleId;
    },
  };

  function columnKeyForNode(node) {
    return COLUMN_KEY_STRATEGY_BY_KIND[node.kind](node);
  }

  function computeModuleColumns(nodes) {
    // Same dedupe/sort the sidebar legend uses, from client-shell.ts - shared so the column order
    // and the legend order stay identical by construction.
    var moduleIds = window.CM.sortedModuleIds(nodes);

    var columnKeys = moduleIds.map(function (id) { return "module:" + id; });
    if (nodes.some(function (n) { return n.kind === "file" && (n.moduleId === null || n.moduleId === undefined); })) {
      columnKeys.push("unassigned");
    }
    if (nodes.some(function (n) { return n.kind === "external"; })) {
      columnKeys.push("external");
    }

    var columnIndexByKey = new Map();
    columnKeys.forEach(function (key, index) { columnIndexByKey.set(key, index); });

    var columnById = new Map();
    nodes.forEach(function (n) {
      columnById.set(n.id, columnIndexByKey.get(columnKeyForNode(n)));
    });

    return { columnById: columnById, columnKeys: columnKeys };
  }

  // Label and colour both dispatch on the same column-key variant, so one lookup (falling
  // through to the dynamic "module:<id>" case) replaces what would otherwise be two parallel
  // if-cascades on the same discriminant.
  var COLUMN_INFO_BY_STATIC_KEY = {
    external: { label: "External", color: window.CM.externalColor },
    unassigned: { label: "Unassigned", color: window.CM.unassignedColor },
  };

  function columnInfoForKey(key) {
    var staticInfo = COLUMN_INFO_BY_STATIC_KEY[key];
    if (staticInfo) return staticInfo;
    var moduleId = Number(key.slice("module:".length));
    return {
      label: window.CM.nameForModuleId(moduleId),
      color: window.CM.colorForModuleId(moduleId),
    };
  }

  function labelForColumnKey(key) {
    return columnInfoForKey(key).label;
  }

  function colorForColumnKey(key) {
    return columnInfoForKey(key).color;
  }

  var moduleColumns = computeModuleColumns(flowNodes);
  var columnById = moduleColumns.columnById;
  var positionById = new Map();
  var columnCounts = new Map();
  flowNodeIds
    .slice()
    .sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; })
    .forEach(function (id) {
      var column = columnById.get(id);
      var row = columnCounts.get(column) || 0;
      columnCounts.set(column, row + 1);
      positionById.set(id, {
        x: MARGIN + column * COLUMN_WIDTH,
        y: MARGIN + HEADER_HEIGHT + row * (BOX_HEIGHT + ROW_GAP),
      });
    });

  var headerData = moduleColumns.columnKeys.map(function (key, index) {
    return {
      key: key,
      x: MARGIN + index * COLUMN_WIDTH + BOX_WIDTH / 2,
      label: labelForColumnKey(key),
      color: colorForColumnKey(key),
    };
  });

  headersLayer
    .selectAll(".cm-flow-column-header")
    .data(headerData, function (d) { return d.key; })
    .join("text")
    .attr("class", "cm-flow-column-header")
    .attr("x", function (d) { return d.x; })
    .attr("y", MARGIN + HEADER_HEIGHT - 10)
    .style("fill", function (d) { return d.color; })
    .text(function (d) { return truncateLabel(d.label); });

  function boxExtent(pos) {
    return { minX: pos.x, minY: pos.y, maxX: pos.x + BOX_WIDTH, maxY: pos.y + BOX_HEIGHT };
  }

  // Shape shared with Force view's currentBoundsFor via window.CM.boundsForSubset (client-shell.ts):
  // narrow to the subset an id set names (or the whole node collection when absent/empty), then
  // reduce to one rectangle. Only idOf/nodeExtent below are Flow-specific.
  function idOf(node) {
    return node.id;
  }

  function nodeExtent(node) {
    return boxExtent(positionById.get(node.id));
  }

  function fullBounds() {
    var bounds = window.CM.boundsForSubset(flowNodes, idOf, nodeExtent, null);
    if (!bounds) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    return { minX: bounds.minX, minY: bounds.minY - HEADER_HEIGHT, maxX: bounds.maxX, maxY: bounds.maxY };
  }

  function boundsForIds(ids) {
    if (!ids || ids.size === 0) return fullBounds();
    var bounds = window.CM.boundsForSubset(flowNodes, idOf, nodeExtent, ids);
    return bounds || fullBounds();
  }

  function truncateLabel(name) {
    return name.length > 20 ? name.slice(0, 19) + "…" : name;
  }

  // A box is a <g> in diagram coordinates, so it can't be a real <button>; window.CM.makeActivatable
  // gives it the manual equivalent (tabindex/role/aria-label plus Enter+Space wired to this same
  // handler) so the primary interactive surface of the view is keyboard-operable, per WCAG 2.0 AA.
  // Activating an External box is a no-op, exactly as clicking one is - an External has no
  // outgoing imports to chain from - but it stays focusable and named so a keyboard or
  // screen-reader user can still traverse and identify every box in the diagram.
  function activateNode(_event, d) {
    if (d.kind === "file") highlightImportChain(d.id);
  }

  function describeNode(d) {
    if (d.kind === "external") return d.name + ", external dependency";
    return d.name + ", file in " + window.CM.nameForModuleId(d.moduleId) +
      ". Activate to highlight its import chain.";
  }

  var nodeSelection = nodesLayer
    .selectAll(".cm-flow-node")
    .data(flowNodes, function (d) { return d.id; })
    .join("g")
    .attr("class", function (d) { return "cm-flow-node" + (d.kind === "external" ? " cm-is-external" : ""); })
    .attr("transform", function (d) {
      var pos = positionById.get(d.id);
      return "translate(" + pos.x + "," + pos.y + ")";
    });

  // Click/hover/keyboard-focus wiring (plus the makeActivatable keyboard equivalent) is
  // client-shell.ts's shared wireNodeInteractions; only activateNode/describeNode above are
  // Flow-view-specific.
  window.CM.wireNodeInteractions(nodeSelection, {
    label: describeNode,
    activate: activateNode,
  });

  nodeSelection.append("rect").attr("width", BOX_WIDTH).attr("height", BOX_HEIGHT);
  nodeSelection
    .append("rect")
    .attr("class", "cm-flow-combined-ring")
    .attr("x", -4)
    .attr("y", -4)
    .attr("width", BOX_WIDTH + 8)
    .attr("height", BOX_HEIGHT + 8)
    .attr("rx", 8);
  nodeSelection
    .append("text")
    .attr("x", 10)
    .attr("y", BOX_HEIGHT / 2)
    .attr("dominant-baseline", "central")
    .text(function (d) { return truncateLabel(d.name); });

  var linkSelection = linksLayer
    .selectAll(".cm-flow-link")
    .data(importEdges, function (e) { return e.source + "->" + e.target; })
    .join("g")
    .attr("class", "cm-flow-link");

  linkSelection.append("path").attr("d", function (e) {
    var sourcePos = positionById.get(e.source);
    var targetPos = positionById.get(e.target);
    var sx = sourcePos.x + BOX_WIDTH, sy = sourcePos.y + BOX_HEIGHT / 2;
    var tx = targetPos.x, ty = targetPos.y + BOX_HEIGHT / 2;
    var mx = (sx + tx) / 2;
    return "M" + sx + "," + sy + " C" + mx + "," + sy + " " + mx + "," + ty + " " + tx + "," + ty;
  });

  var highlightedNodeIds = new Set();
  var highlightedEdgeKeys = new Set();
  var badgeInfoByEdgeKey = new Map();
  var highlightActive = false;

  function edgeKey(source, target) {
    return source + "->" + target;
  }

  // Dim/highlight/filter-match bookkeeping (including the shared node/link call shape) is
  // client-shell.ts's shared applyStateClasses/applyViewStateClasses; this view only says what
  // "highlighted" and "filter-matched" mean for its own data shapes.
  function applyClasses() {
    window.CM.applyViewStateClasses(
      nodeSelection,
      linkSelection,
      highlightActive,
      {
        isHighlighted: function (d) { return highlightedNodeIds.has(d.id); },
        isFilterMatched: function (d) { return window.CM.isFilterMatched(d); },
      },
      {
        isHighlighted: function (e) { return highlightedEdgeKeys.has(edgeKey(e.source, e.target)); },
        isFilterMatched: function (e) {
          return (
            window.CM.isFilterMatched(window.CM.nodesById.get(e.source)) &&
            window.CM.isFilterMatched(window.CM.nodesById.get(e.target))
          );
        },
      },
    );
  }

  function activateBadge(_event, d) {
    renderStepDetail(d.edge, d.number);
  }

  function describeBadge(d) {
    var sourceNode = window.CM.nodesById.get(d.edge.source);
    var targetNode = window.CM.nodesById.get(d.edge.target);
    return "Import step " + d.number + ", " +
      (sourceNode ? sourceNode.name : d.edge.source) + " to " +
      (targetNode ? targetNode.name : d.edge.target) +
      ". Activate to see its import detail.";
  }

  function renderBadges() {
    var badgeData = [];
    badgeInfoByEdgeKey.forEach(function (info, key) {
      var sourcePos = positionById.get(info.edge.source);
      var targetPos = positionById.get(info.edge.target);
      if (!sourcePos || !targetPos) return;
      var midX = (sourcePos.x + BOX_WIDTH + targetPos.x) / 2;
      var midY = (sourcePos.y + BOX_HEIGHT / 2 + targetPos.y + BOX_HEIGHT / 2) / 2;
      badgeData.push({ key: key, x: midX, y: midY, number: info.number, edge: info.edge });
    });

    var badgeSelection = badgesLayer
      .selectAll(".cm-flow-badge")
      .data(badgeData, function (d) { return d.key; })
      .join("g")
      .attr("class", "cm-flow-badge")
      .attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; })
      .on("click", function (event, d) {
        event.stopPropagation();
        activateBadge(event, d);
      });

    // Numbered step badges are clickable too, so they get the same keyboard treatment as the boxes.
    window.CM.makeActivatable(badgeSelection, {
      label: function (d) { return describeBadge(d); },
      activate: activateBadge,
    });
    badgeSelection.selectAll("*").remove();
    badgeSelection.append("circle").attr("r", 9);
    badgeSelection.append("text").text(function (d) { return d.number; });
  }

  function setHighlight(nodeIds, edgeOrder) {
    highlightedNodeIds = nodeIds;
    highlightedEdgeKeys = new Set();
    badgeInfoByEdgeKey = new Map();
    (edgeOrder || []).forEach(function (edge, index) {
      var key = edgeKey(edge.source, edge.target);
      highlightedEdgeKeys.add(key);
      badgeInfoByEdgeKey.set(key, { number: index + 1, edge: edge });
    });
    highlightActive = nodeIds.size > 0;
    clearStepDetail();
    applyClasses();
    renderBadges();
    controller.fitToBounds(highlightActive ? boundsForIds(nodeIds) : fullBounds());
  }

  function clearHighlight() {
    setHighlight(new Set(), []);
  }

  function highlightImportChain(fileId) {
    var chain = computeImportChain(fileId, importEdges);
    setHighlight(new Set(chain.visitedOrder), chain.edgeOrder);
  }

  function highlightModule(moduleId) {
    var ids = new Set(
      flowNodes.filter(function (n) { return n.kind === "file" && n.moduleId === moduleId; }).map(function (n) { return n.id; })
    );
    setHighlight(ids, []);
  }

  svg.on("click", function () {
    clearHighlight();
  });

  window.CM.wireZoomControls(zoomControlsEl, controller, function () {
    clearHighlight();
  });

  window.CM.registerView("flow", {
    onActivate: function () {
      applyClasses();
    },
    onFilterChanged: function () {
      applyClasses();
      if (!highlightActive) {
        var hasFilter = window.CM.hasActiveFilter();
        if (!hasFilter) {
          controller.fitToBounds(fullBounds());
          return;
        }
        var matchedIds = new Set(
          flowNodes.filter(function (n) { return window.CM.isFilterMatched(n); }).map(function (n) { return n.id; })
        );
        controller.fitToBounds(boundsForIds(matchedIds));
      }
    },
    highlightModule: highlightModule,
  });

  controller.fitToBounds(fullBounds(), false);
})();
`;
}
