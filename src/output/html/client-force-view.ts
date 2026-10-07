// Ticket 03's Force-directed view client script:
// d3-force physics over every File/External node (Symbol nodes are out of scope - a codebase's
// symbol count can run tens of times its file count, and simulating one physics particle per
// symbol stops being renderable, not just slow, well before a real-sized repo's scale), a custom
// force pulling each node toward its own Module *region*'s live centroid (never called "cluster" -
// `CONTEXT.md`'s Cluster is a different concept), soft region hulls, 1-hop neighbourhood highlight,
// and this screen's own (freshly implemented, not ported from the disposed prototype)
// filter/highlight combined visual. Registers itself with `window.CM` from `client-shell.ts`.
// Written as a plain-JS template for the same reason as `client-shell.ts`.
export function buildClientForceViewScript(computeRegionIdSource: string): string {
	return `
(function () {
  "use strict";

  ${computeRegionIdSource}

  var VIRTUAL_WIDTH = 1200;
  var VIRTUAL_HEIGHT = 900;
  var ANCHOR_RADIUS = 320;

  var svg = window.d3.select("#cm-force-svg");
  var viewport = svg.append("g").attr("class", "cm-force-viewport");
  var hullsLayer = viewport.append("g").attr("class", "cm-force-hulls");
  var linksLayer = viewport.append("g").attr("class", "cm-force-links-layer");
  var nodesLayer = viewport.append("g").attr("class", "cm-force-nodes-layer");

  var zoomControlsEl = document.getElementById("cm-force-zoom");
  var controller = window.CM.createZoomController(svg, viewport);

  var forceNodeKinds = { file: true, external: true };
  var rawForceNodes = window.CM.nodes.filter(function (n) { return forceNodeKinds[n.kind]; });
  var forceNodeIdSet = new Set(rawForceNodes.map(function (n) { return n.id; }));
  var forceLinks = window.CM.edges
    .filter(function (e) { return e.type === "import" && forceNodeIdSet.has(e.source) && forceNodeIdSet.has(e.target); })
    .map(function (e) { return { source: e.source, target: e.target, kind: e.kind, type: e.type }; });

  var fileModuleById = new Map(
    window.CM.nodes.filter(function (n) { return n.kind === "file"; }).map(function (n) { return [n.id, n.moduleId]; })
  );

  var simNodes = rawForceNodes.map(function (n) {
    return {
      id: n.id,
      kind: n.kind,
      name: n.name,
      moduleId: n.kind === "file" ? n.moduleId : undefined,
      raw: n,
    };
  });

  simNodes.forEach(function (n) {
    n.regionId = computeRegionId(n, fileModuleById);
  });

  var regionIds = Array.from(new Set(simNodes.map(function (n) { return n.regionId; }))).sort();
  var anchorByRegion = new Map();
  regionIds.forEach(function (regionId, index) {
    var angle = (index / Math.max(1, regionIds.length)) * Math.PI * 2;
    anchorByRegion.set(regionId, {
      x: VIRTUAL_WIDTH / 2 + ANCHOR_RADIUS * Math.cos(angle),
      y: VIRTUAL_HEIGHT / 2 + ANCHOR_RADIUS * Math.sin(angle),
    });
  });

  // Region membership never changes after assignment above - only a node's (x, y) does, every
  // tick. A hull's fill colour only needs one representative member per region, so that's looked
  // up once here rather than re-scanning every node for it on every single tick.
  var sampleNodeByRegion = new Map();
  simNodes.forEach(function (n) {
    if (!sampleNodeByRegion.has(n.regionId)) sampleNodeByRegion.set(n.regionId, n);
  });

  simNodes.forEach(function (n) {
    var anchor = anchorByRegion.get(n.regionId);
    n.x = anchor.x + (Math.random() - 0.5) * 40;
    n.y = anchor.y + (Math.random() - 0.5) * 40;
  });

  var RADIUS_BY_KIND = { file: 7, external: 6 };

  function radiusFor(d) {
    return RADIUS_BY_KIND[d.kind];
  }

  function collideRadiusFor(d) {
    return d.kind === "file" ? 24 : radiusFor(d) + 3;
  }

  // Colour dispatches on kind only to decide *how* to resolve a moduleId (a File carries its own,
  // an External has none at all) - one lookup of per-kind resolvers replaces what would otherwise
  // be its own if-cascade alongside \`radiusFor\`'s.
  var MODULE_ID_RESOLVER_BY_KIND = {
    file: function (d) { return d.moduleId; },
  };

  function colorFor(d) {
    if (d.kind === "external") return window.CM.externalColor;
    var moduleId = MODULE_ID_RESOLVER_BY_KIND[d.kind](d);
    if (moduleId === null || moduleId === undefined) return window.CM.unassignedColor;
    return window.CM.colorForModuleId(moduleId);
  }

  // The spec (line 36) describes this force as pulling "each
  // node toward the live centroid of its own Module region," with no mention of a fixed component.
  // The target below is actually a blend - 55% live centroid, 45% \`anchorByRegion\`'s fixed
  // polar-layout point (documentation/adr/0026) - because a pure-centroid pull is self-referential: the
  // target a region's own nodes are pulled toward is itself just the mean of those same nodes'
  // current positions, with nothing external holding it in place. Nothing then stops a region's
  // whole cluster (and its centroid with it) drifting across the canvas over many ticks, or two
  // regions' centroids converging and visually merging. The 45%-weighted anchor - the same fixed
  // point \`simNodes\` are first scattered around, above - pins each region to its own stable sector
  // of \`VIRTUAL_WIDTH\`/\`VIRTUAL_HEIGHT\` while the 55% centroid component still lets a region breathe
  // and self-organise around its own nodes' real layout.
  function regionForce(alpha) {
    var sums = new Map();
    simNodes.forEach(function (n) {
      var entry = sums.get(n.regionId);
      if (!entry) {
        entry = { x: 0, y: 0, count: 0 };
        sums.set(n.regionId, entry);
      }
      entry.x += n.x;
      entry.y += n.y;
      entry.count += 1;
    });
    simNodes.forEach(function (n) {
      var entry = sums.get(n.regionId);
      var anchor = anchorByRegion.get(n.regionId);
      var centroidX = entry.x / entry.count;
      var centroidY = entry.y / entry.count;
      var targetX = centroidX * 0.55 + anchor.x * 0.45;
      var targetY = centroidY * 0.55 + anchor.y * 0.45;
      n.vx += (targetX - n.x) * alpha * 0.15;
      n.vy += (targetY - n.y) * alpha * 0.15;
    });
  }

  // Built while \`forceLinks\` entries still hold plain id strings - \`d3.forceLink\` mutates each
  // entry's \`source\`/\`target\` into a live node-object reference the moment it's installed as a
  // force below, so any string-keyed lookup (adjacency, id-based dimming) has to happen first.
  var adjacency = new Map();
  simNodes.forEach(function (n) { adjacency.set(n.id, new Set()); });
  forceLinks.forEach(function (edge) {
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  });

  var simulation = window.d3
    .forceSimulation(simNodes)
    .force("link", window.d3.forceLink(forceLinks).id(function (d) { return d.id; }).distance(50).strength(0.25))
    .force("charge", window.d3.forceManyBody().strength(-60))
    .force("collide", window.d3.forceCollide().radius(collideRadiusFor))
    .force("region", regionForce);

  var linkSelection = linksLayer
    .selectAll(".cm-force-link")
    .data(forceLinks)
    .join("line")
    .attr("class", "cm-force-link");

  // A node is a <g> positioned by the physics simulation, so it can't be a real <button>;
  // window.CM.makeActivatable gives it the manual equivalent (tabindex/role/aria-label plus
  // Enter+Space wired to this same handler) so the view's primary interactive surface is
  // keyboard-operable, per WCAG 2.0 AA.
  function activateNode(_event, d) {
    highlightNeighborhood(d.id);
  }

  function describeNode(d) {
    var kindLabel = d.kind === "external" ? "external dependency" : d.kind;
    return d.name + ", " + kindLabel + ". Activate to highlight its neighbourhood.";
  }

  var nodeSelection = nodesLayer
    .selectAll(".cm-force-node")
    .data(simNodes, function (d) { return d.id; })
    .join("g")
    .attr("class", "cm-force-node");

  // Click/hover/keyboard-focus wiring (plus the makeActivatable keyboard equivalent) is
  // client-shell.ts's shared wireNodeInteractions; only activateNode/describeNode above are
  // Force-view-specific.
  window.CM.wireNodeInteractions(nodeSelection, {
    label: describeNode,
    activate: activateNode,
  });

  nodeSelection
    .append("circle")
    .attr("class", "cm-force-combined-ring")
    .attr("r", function (d) { return radiusFor(d) + 5; });
  nodeSelection.append("circle").attr("r", radiusFor).attr("fill", colorFor);
  nodeSelection
    .filter(function (d) { return d.kind === "file"; })
    .append("text")
    .attr("x", function (d) { return radiusFor(d) + 4; })
    .attr("y", 3)
    .text(function (d) { return d.name; });

  var highlightedIds = new Set();
  var highlightActive = false;

  // Dim/highlight/filter-match bookkeeping (including the shared node/link call shape) is
  // client-shell.ts's shared applyStateClasses/applyViewStateClasses; this view only says what
  // "highlighted" and "filter-matched" mean for its own data shapes (its simulation nodes wrap the
  // raw graph node as \`.raw\`, and d3.forceLink has by now replaced each link's source/target id
  // string with the live node object).
  function applyClasses() {
    window.CM.applyViewStateClasses(
      nodeSelection,
      linkSelection,
      highlightActive,
      {
        isHighlighted: function (d) { return highlightedIds.has(d.id); },
        isFilterMatched: function (d) { return window.CM.isFilterMatched(d.raw); },
      },
      {
        isHighlighted: function (e) {
          return highlightActive && highlightedIds.has(e.source.id) && highlightedIds.has(e.target.id);
        },
        isFilterMatched: function (e) {
          return window.CM.isFilterMatched(e.source.raw) && window.CM.isFilterMatched(e.target.raw);
        },
      },
    );
  }

  function nodeIdOf(node) {
    return node.id;
  }

  function nodePointExtent(node) {
    return { minX: node.x, minY: node.y, maxX: node.x, maxY: node.y };
  }

  // Shape shared with Flow view's boundsForIds/fullBounds via window.CM.boundsForSubset
  // (client-shell.ts): narrow to the subset an id set names (or every simulation node when
  // absent/empty), then reduce to one rectangle. Only nodeIdOf/nodePointExtent above, and the
  // fixed margin/fallback below, are Force-specific.
  function currentBoundsFor(ids) {
    var bounds = window.CM.boundsForSubset(simNodes, nodeIdOf, nodePointExtent, ids);
    if (!bounds) return { minX: 0, minY: 0, maxX: VIRTUAL_WIDTH, maxY: VIRTUAL_HEIGHT };
    return { minX: bounds.minX - 40, minY: bounds.minY - 40, maxX: bounds.maxX + 40, maxY: bounds.maxY + 40 };
  }

  function activeFocusIds() {
    if (highlightActive) return highlightedIds;
    if (window.CM.hasActiveFilter()) {
      return new Set(simNodes.filter(function (n) { return window.CM.isFilterMatched(n.raw); }).map(function (n) { return n.id; }));
    }
    return new Set();
  }

  simulation.on("tick", function () {
    nodeSelection.attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });
    linkSelection
      .attr("x1", function (e) { return e.source.x; })
      .attr("y1", function (e) { return e.source.y; })
      .attr("x2", function (e) { return e.target.x; })
      .attr("y2", function (e) { return e.target.y; });

    // One O(n) bucketing pass rather than one O(n) filter per region (O(regions * n) overall,
    // every tick) - the same points, grouped, just without re-scanning the full node list once
    // per region to do it.
    var pointsByRegion = new Map();
    simNodes.forEach(function (n) {
      var points = pointsByRegion.get(n.regionId);
      if (!points) {
        points = [];
        pointsByRegion.set(n.regionId, points);
      }
      points.push([n.x, n.y]);
    });

    var hullData = regionIds
      .map(function (regionId) {
        return { regionId: regionId, points: pointsByRegion.get(regionId) || [] };
      })
      .filter(function (d) { return d.points.length >= 3; });

    hullsLayer
      .selectAll(".cm-force-hull")
      .data(hullData, function (d) { return d.regionId; })
      .join("path")
      .attr("class", "cm-force-hull")
      .attr("fill", function (d) {
        var sample = sampleNodeByRegion.get(d.regionId);
        return sample ? colorFor(sample) : window.CM.unassignedColor;
      })
      .attr("d", function (d) {
        var hull = window.d3.polygonHull(d.points);
        return hull ? "M" + hull.map(function (p) { return p.join(","); }).join("L") + "Z" : "";
      });

    controller.fitToBounds(currentBoundsFor(activeFocusIds()), false);
  });

  function highlightNeighborhood(nodeId) {
    var ids = new Set([nodeId]);
    (adjacency.get(nodeId) || new Set()).forEach(function (neighborId) { ids.add(neighborId); });
    highlightedIds = ids;
    highlightActive = true;
    applyClasses();
    controller.fitToBounds(currentBoundsFor(ids));
  }

  function clearHighlight() {
    highlightedIds = new Set();
    highlightActive = false;
    applyClasses();
    // Deselect/reset always re-fits to the literal full graph, regardless of any active filter -
    // an active filter's own auto-fit only ever applies while a filter changes or on activation,
    // never overrides an explicit clear.
    controller.fitToBounds(currentBoundsFor(new Set()));
  }

  svg.on("click", function () {
    clearHighlight();
  });

  window.CM.wireZoomControls(zoomControlsEl, controller, function () {
    clearHighlight();
  });

  window.CM.registerView("force", {
    onActivate: function () {
      applyClasses();
      controller.fitToBounds(currentBoundsFor(activeFocusIds()), false);
    },
    onFilterChanged: function () {
      applyClasses();
      if (!highlightActive) {
        controller.fitToBounds(currentBoundsFor(activeFocusIds()));
      }
    },
  });
})();
`;
}
