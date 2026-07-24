import {
  buildAggregatedEdges,
  buildExternalLinks,
  computeImpactHighlight,
  fullPathLabel,
  getAncestorPath,
  sceneNodes,
} from "/src/domain/impactGraph.js";
import {
  addEdge,
  addNode,
  addSheet,
  createSnapshot,
  deleteEdge,
  deleteNode,
  deleteSheet,
  deleteSnapshot,
  diffSnapshot,
  exportAll,
  exportImpactRange,
  importGraph,
  listSnapshotMetas,
  loadGraph,
  renameSheet,
  restoreSnapshot,
  updateEdge,
  updateNode,
  updateNodePosition,
} from "/src/storage/impactGraphStore.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const EDITOR_TABS = ["node", "edge", "snapshot", "io"];
const NODE_HEIGHT = 40;
const NODE_MIN_WIDTH = 64;
const NODE_MAX_WIDTH = 160;
const NODE_CHAR_WIDTH = 13;
const NODE_PADDING_X = 20;
const EXTERNAL_GAP = 70;
const EXTERNAL_STACK_GAP = 56;

const state = {
  nodes: [],
  edges: [],
  sheets: [],
  activeSheetId: null,
  focusNodeId: null,
  mode: "visualize",
  direction: "downstream",
  selectedNodeId: null,
  editingNodeId: null,
  nodeFormParentId: null,
  editingEdgeId: null,
  openEdgeGroupKey: null,
  diffOpenSnapshotId: null,
  drag: null,
};

let refs = null;

function q(id) {
  return document.querySelector(`#${id}`);
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

function setStatus(message = "") {
  refs.status.textContent = message;
}

function triggerDownload(filename, content, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Layout (auto-position nodes that have no saved x/y)
// ---------------------------------------------------------------------------

function layoutPositions(nodesInScene) {
  const positions = new Map();
  const missing = [];
  for (const node of nodesInScene) {
    if (typeof node.x === "number" && typeof node.y === "number") {
      positions.set(node.id, { x: node.x, y: node.y });
    } else {
      missing.push(node);
    }
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(missing.length || 1)));
  missing.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions.set(node.id, { x: 130 + col * 200, y: 90 + row * 140 });
  });
  return positions;
}

function clientToSvgPoint(clientX, clientY) {
  const rect = refs.svg.getBoundingClientRect();
  const viewBox = refs.svg.viewBox.baseVal;
  if (rect.width === 0 || rect.height === 0) {
    return { x: viewBox.x, y: viewBox.y };
  }
  return {
    x: viewBox.x + (clientX - rect.left) * (viewBox.width / rect.width),
    y: viewBox.y + (clientY - rect.top) * (viewBox.height / rect.height),
  };
}

// ---------------------------------------------------------------------------
// Node box geometry (rounded-rect nodes sized to fit their label, instead of
// fixed-radius circles that clip long Japanese names).
// ---------------------------------------------------------------------------

function fitNodeLabel(name) {
  const maxChars = Math.max(2, Math.floor((NODE_MAX_WIDTH - NODE_PADDING_X) / NODE_CHAR_WIDTH));
  if (name.length <= maxChars) {
    return name;
  }
  return `${name.slice(0, maxChars - 1)}…`;
}

function nodeBoxWidth(label) {
  const width = label.length * NODE_CHAR_WIDTH + NODE_PADDING_X;
  return Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, width));
}

/** Point where the ray from a box's center towards (dx,dy) exits the box's border. */
function boxBoundaryPoint(center, halfW, halfH, dx, dy) {
  if (dx === 0 && dy === 0) {
    return { x: center.x, y: center.y };
  }
  const tx = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: center.x + dx * t, y: center.y + dy * t };
}

// ---------------------------------------------------------------------------
// Data refresh
// ---------------------------------------------------------------------------

function reloadGraph() {
  const graph = loadGraph();
  state.nodes = graph.nodes;
  state.edges = graph.edges;
  state.sheets = graph.sheets;
  if (!state.activeSheetId || !state.sheets.some((s) => s.id === state.activeSheetId)) {
    state.activeSheetId = state.sheets[0]?.id ?? null;
  }
  if (state.focusNodeId && !state.nodes.some((n) => n.id === state.focusNodeId)) {
    state.focusNodeId = null;
  }
  if (state.selectedNodeId && !state.nodes.some((n) => n.id === state.selectedNodeId)) {
    state.selectedNodeId = null;
  }
}

function render() {
  renderSheetTabs();
  renderBreadcrumb();
  renderCanvas();
  renderNodeList();
  renderEdgeList();
  renderEdgeSelects();
  renderSnapshotList();
}

function refreshAll() {
  reloadGraph();
  render();
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function renderSheetTabs() {
  refs.sheetTabs.innerHTML = "";
  const sorted = [...state.sheets].sort((a, b) => a.order - b.order);
  for (const sheet of sorted) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tab impact-sheet-tab${sheet.id === state.activeSheetId ? " active" : ""}`;
    btn.textContent = sheet.name;
    btn.addEventListener("click", () => {
      if (state.activeSheetId === sheet.id) {
        return;
      }
      state.activeSheetId = sheet.id;
      state.focusNodeId = null;
      state.selectedNodeId = null;
      resetNodeForm();
      resetEdgeForm();
      render();
    });
    refs.sheetTabs.append(btn);
  }
}

function handleAddSheet() {
  const name = refs.sheetNameInput.value.trim();
  const result = addSheet(name);
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  refs.sheetNameInput.value = "";
  state.activeSheetId = result.sheet.id;
  state.focusNodeId = null;
  setStatus(`シート「${result.sheet.name}」を追加しました。`);
  refreshAll();
}

function handleRenameSheet() {
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  if (!sheet) {
    return;
  }
  const name = refs.sheetNameInput.value.trim() || sheet.name;
  const result = renameSheet(sheet.id, name);
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  refs.sheetNameInput.value = "";
  setStatus("シート名を変更しました。");
  refreshAll();
}

function handleDeleteSheet() {
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  if (!sheet) {
    return;
  }
  if (!globalThis.confirm(`シート「${sheet.name}」を削除しますか？含まれるノード・関係も削除されます。`)) {
    return;
  }
  const result = deleteSheet(sheet.id);
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  state.activeSheetId = null;
  state.focusNodeId = null;
  setStatus("シートを削除しました。");
  refreshAll();
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

function renderBreadcrumb() {
  refs.breadcrumb.innerHTML = "";
  const root = document.createElement("button");
  root.type = "button";
  root.className = "impact-breadcrumb-item";
  root.textContent = "ルート";
  root.disabled = state.focusNodeId === null;
  root.addEventListener("click", () => navigateFocus(null));
  refs.breadcrumb.append(root);

  if (state.focusNodeId) {
    const path = getAncestorPath(state.nodes, state.focusNodeId);
    for (const [index, node] of path.entries()) {
      const sep = document.createElement("span");
      sep.className = "impact-breadcrumb-sep";
      sep.textContent = "/";
      refs.breadcrumb.append(sep);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "impact-breadcrumb-item";
      btn.textContent = node.name;
      const isLast = index === path.length - 1;
      btn.disabled = isLast;
      btn.addEventListener("click", () => navigateFocus(node.id));
      refs.breadcrumb.append(btn);
    }
  }
}

function navigateFocus(nodeId) {
  state.focusNodeId = nodeId;
  state.selectedNodeId = null;
  resetNodeForm();
  resetEdgeForm();
  render();
}

// ---------------------------------------------------------------------------
// Canvas (SVG graph)
// ---------------------------------------------------------------------------

function ensureArrowMarker() {
  if (refs.svg.querySelector("#impact-arrow")) {
    return;
  }
  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "impact-arrow",
    viewBox: "0 0 10 10",
    refX: 8,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: "auto-start-reverse",
  });
  const path = svgEl("path", { d: "M0,0 L10,5 L0,10 Z", fill: "#64748b" });
  marker.append(path);
  defs.append(marker);
  refs.svg.append(defs);
}

function renderCanvas() {
  refs.svg.innerHTML = "";
  ensureArrowMarker();

  const scene = sceneNodes(state.nodes, state.focusNodeId, state.activeSheetId);
  const aggregatedEdges = buildAggregatedEdges(state.nodes, state.edges, state.focusNodeId);
  const externalLinks = buildExternalLinks(state.nodes, state.edges, state.focusNodeId);
  const positions = layoutPositions(scene);

  let highlight = null;
  if (state.selectedNodeId) {
    highlight = computeImpactHighlight(
      state.nodes,
      state.edges,
      aggregatedEdges,
      state.focusNodeId,
      state.selectedNodeId,
      state.direction,
    );
  }

  // Boxes for real, in-scene nodes.
  const boxes = new Map();
  for (const node of scene) {
    const pos = positions.get(node.id);
    if (!pos) {
      continue;
    }
    const label = fitNodeLabel(node.name);
    const width = nodeBoxWidth(label);
    boxes.set(node.id, { x: pos.x, y: pos.y, halfW: width / 2, halfH: NODE_HEIGHT / 2, label });
  }

  // Boxes for pseudo "external" nodes, positioned just outside their scene owner
  // so that at least one hop toward a different document/hierarchy level is
  // always visible, even though the external node itself isn't part of this scene.
  const externalBoxes = new Map();
  const stackIndex = new Map();
  for (const [index, link] of externalLinks.entries()) {
    const ownerBox = boxes.get(link.sceneOwnerId);
    if (!ownerBox) {
      continue;
    }
    const stackKey = `${link.sceneOwnerId}:${link.direction}`;
    const stack = stackIndex.get(stackKey) ?? 0;
    stackIndex.set(stackKey, stack + 1);

    const arrow = link.direction === "outgoing" ? "→ " : "← ";
    const label = fitNodeLabel(`${arrow}${fullPathLabel(state.nodes, link.externalNodeId)}`);
    const width = nodeBoxWidth(label);
    const dirSign = link.direction === "outgoing" ? 1 : -1;
    const x = ownerBox.x + dirSign * (ownerBox.halfW + width / 2 + EXTERNAL_GAP);
    const y = ownerBox.y + stack * EXTERNAL_STACK_GAP;
    const key = `ext-${index}`;
    externalBoxes.set(key, { x, y, halfW: width / 2, halfH: NODE_HEIGHT / 2, label, link });
  }

  const edgeLayer = svgEl("g", { class: "impact-edge-layer" });

  for (const agg of aggregatedEdges) {
    const from = boxes.get(agg.ownerSourceId);
    const to = boxes.get(agg.ownerTargetId);
    if (!from || !to) {
      continue;
    }
    const key = `${agg.ownerSourceId}->${agg.ownerTargetId}`;
    const isHighlighted = highlight?.highlightedEdgeKeys.has(key) ?? false;
    const label = agg.edges.length > 1 ? `${agg.edges[0].name} 他${agg.edges.length}件` : agg.edges[0].name;
    const group = renderEdgeLine(from, to, label, isHighlighted, false);
    group.style.cursor = "pointer";
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      openEdgeGroup(agg);
    });
    edgeLayer.append(group);
  }

  for (const externalBox of externalBoxes.values()) {
    const { link } = externalBox;
    const ownerBox = boxes.get(link.sceneOwnerId);
    if (!ownerBox) {
      continue;
    }
    const from = link.direction === "outgoing" ? ownerBox : externalBox;
    const to = link.direction === "outgoing" ? externalBox : ownerBox;
    const isHighlighted = highlight?.visitedIds.has(link.externalNodeId) ?? false;
    const label = link.edges.length > 1 ? `${link.edges[0].name} 他${link.edges.length}件` : link.edges[0].name;
    const group = renderEdgeLine(from, to, label, isHighlighted, true);
    edgeLayer.append(group);
  }
  refs.svg.append(edgeLayer);

  const nodeLayer = svgEl("g", { class: "impact-node-layer" });
  for (const node of scene) {
    const box = boxes.get(node.id);
    if (!box) {
      continue;
    }
    const isHighlighted = highlight?.highlightedOwnerIds.has(node.id) ?? false;
    const isSelected = state.selectedNodeId === node.id || state.editingNodeId === node.id;
    const hasChildren = state.nodes.some((n) => n.parentId === node.id);

    const group = svgEl("g", {
      class: `impact-node${isHighlighted ? " highlight" : ""}${isSelected ? " selected" : ""}`,
      transform: `translate(${box.x},${box.y})`,
    });

    const rect = svgEl("rect", {
      x: -box.halfW,
      y: -box.halfH,
      width: box.halfW * 2,
      height: box.halfH * 2,
      rx: 10,
      ry: 10,
    });
    const label = svgEl("text", { class: "impact-node-label", y: 4 });
    label.textContent = box.label;
    const titleEl = svgEl("title");
    titleEl.textContent = fullPathLabel(state.nodes, node.id);
    group.append(rect, titleEl, label);

    if (hasChildren) {
      const badge = svgEl("text", { class: "impact-node-badge", y: box.halfH + 13 });
      badge.textContent = "▽ 展開可";
      group.append(badge);
    }

    let clickTimer = null;
    group.style.cursor = state.mode === "edit" ? "grab" : "pointer";
    group.addEventListener("pointerdown", (event) => {
      if (state.mode !== "edit") {
        return;
      }
      event.stopPropagation();
      const start = clientToSvgPoint(event.clientX, event.clientY);
      state.drag = { nodeId: node.id, offsetX: start.x - box.x, offsetY: start.y - box.y, moved: false };
      group.setPointerCapture(event.pointerId);
    });
    group.addEventListener("pointermove", (event) => {
      if (!state.drag || state.drag.nodeId !== node.id) {
        return;
      }
      const point = clientToSvgPoint(event.clientX, event.clientY);
      const nx = point.x - state.drag.offsetX;
      const ny = point.y - state.drag.offsetY;
      state.drag.moved = true;
      group.setAttribute("transform", `translate(${nx},${ny})`);
    });
    group.addEventListener("pointerup", (event) => {
      if (!state.drag || state.drag.nodeId !== node.id) {
        return;
      }
      const drag = state.drag;
      state.drag = null;
      group.releasePointerCapture(event.pointerId);
      if (!drag.moved) {
        return;
      }
      const point = clientToSvgPoint(event.clientX, event.clientY);
      const nx = point.x - drag.offsetX;
      const ny = point.y - drag.offsetY;
      const result = updateNodePosition(node.id, nx, ny);
      if (!result.ok) {
        setStatus(result.message);
      }
      refreshAll();
    });

    group.addEventListener("click", (event) => {
      event.stopPropagation();
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        navigateFocus(node.id);
        return;
      }
      clickTimer = setTimeout(() => {
        clickTimer = null;
        selectNode(node.id);
      }, 220);
    });

    nodeLayer.append(group);
  }

  for (const externalBox of externalBoxes.values()) {
    const { link } = externalBox;
    const isHighlighted = highlight?.visitedIds.has(link.externalNodeId) ?? false;

    const group = svgEl("g", {
      class: `impact-node external${isHighlighted ? " highlight" : ""}`,
      transform: `translate(${externalBox.x},${externalBox.y})`,
    });
    const rect = svgEl("rect", {
      x: -externalBox.halfW,
      y: -externalBox.halfH,
      width: externalBox.halfW * 2,
      height: externalBox.halfH * 2,
      rx: 10,
      ry: 10,
    });
    const label = svgEl("text", { class: "impact-node-label", y: 4 });
    label.textContent = externalBox.label;
    const titleEl = svgEl("title");
    titleEl.textContent = `${fullPathLabel(state.nodes, link.externalNodeId)}（別階層・クリックで移動）`;
    group.append(rect, titleEl, label);

    group.addEventListener("click", (event) => {
      event.stopPropagation();
      revealNode(link.externalNodeId);
    });

    nodeLayer.append(group);
  }

  refs.svg.append(nodeLayer);
}

function renderEdgeLine(from, to, label, isHighlighted, isExternal) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const start = boxBoundaryPoint(from, from.halfW, from.halfH, dx, dy);
  const end = boxBoundaryPoint(to, to.halfW, to.halfH, -dx, -dy);

  const group = svgEl("g", {
    class: `impact-edge${isExternal ? " external" : ""}${isHighlighted ? " highlight" : ""}`,
  });
  const line = svgEl("line", {
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    "marker-end": "url(#impact-arrow)",
  });
  group.append(line);

  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const labelBg = svgEl("rect", {
    x: midX - (label.length * 3.6),
    y: midY - 9,
    width: label.length * 7.2,
    height: 16,
    rx: 3,
    class: "impact-edge-label-bg",
  });
  const text = svgEl("text", { x: midX, y: midY + 3, class: "impact-edge-label" });
  text.textContent = label;
  group.append(labelBg, text);
  return group;
}

/** Switches to the node's own sheet/parent scope and selects it - used to "jump" from an external link pseudo-node to the real node. */
function revealNode(nodeId) {
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return;
  }
  state.activeSheetId = node.sheetId;
  state.focusNodeId = node.parentId;
  render();
  selectNode(nodeId);
}

function handleSvgBackgroundClick() {
  state.selectedNodeId = null;
  resetNodeForm();
  renderCanvas();
}

// ---------------------------------------------------------------------------
// Node form
// ---------------------------------------------------------------------------

function resetNodeForm() {
  state.editingNodeId = null;
  state.nodeFormParentId = state.focusNodeId;
  refs.nodeName.value = "";
  refs.nodeDescription.value = "";
}

function selectNode(nodeId) {
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return;
  }
  state.selectedNodeId = nodeId;
  state.editingNodeId = nodeId;
  state.nodeFormParentId = node.parentId;
  refs.nodeName.value = node.name;
  refs.nodeDescription.value = node.description;
  setEditorTab("node");
  renderCanvas();
}

function startAddChild() {
  if (!state.editingNodeId) {
    setStatus("先にノードを選択してください。");
    return;
  }
  state.nodeFormParentId = state.editingNodeId;
  state.editingNodeId = null;
  state.selectedNodeId = null;
  refs.nodeName.value = "";
  refs.nodeDescription.value = "";
  refs.nodeName.focus();
  setStatus("子ノードを追加します。ノード名を入力して保存してください。");
}

function saveNode() {
  const input = { name: refs.nodeName.value, description: refs.nodeDescription.value };
  const result = state.editingNodeId
    ? updateNode(state.editingNodeId, input)
    : addNode({ ...input, parentId: state.nodeFormParentId, sheetId: state.activeSheetId });
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  setStatus(state.editingNodeId ? "ノードを更新しました。" : "ノードを追加しました。");
  if (!state.editingNodeId) {
    selectNode(result.node.id);
  }
  refreshAll();
}

function deleteSelectedNode() {
  if (!state.editingNodeId) {
    setStatus("削除するノードを選択してください。");
    return;
  }
  const node = state.nodes.find((n) => n.id === state.editingNodeId);
  if (!node) {
    return;
  }
  if (!globalThis.confirm(`ノード「${node.name}」を削除しますか？子ノードと関連する関係も削除されます。`)) {
    return;
  }
  const result = deleteNode(state.editingNodeId);
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  if (state.focusNodeId && result.deletedNodeIds.includes(state.focusNodeId)) {
    state.focusNodeId = node.parentId;
  }
  resetNodeForm();
  setStatus("ノードを削除しました。");
  refreshAll();
}

// ---------------------------------------------------------------------------
// Node list / search
// ---------------------------------------------------------------------------

function renderNodeList() {
  refs.nodeList.innerHTML = "";
  const query = refs.nodeSearch.value.trim().toLowerCase();
  const pathById = new Map(state.nodes.map((n) => [n.id, fullPathLabel(state.nodes, n.id)]));
  const candidates = query
    ? state.nodes.filter((n) =>
      n.name.toLowerCase().includes(query) ||
      (pathById.get(n.id) ?? "").toLowerCase().includes(query)
    )
    : state.nodes.filter((n) => n.sheetId === state.activeSheetId);

  if (candidates.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "ノードがありません。";
    refs.nodeList.append(li);
    return;
  }

  for (const node of candidates.slice(0, 200)) {
    const li = document.createElement("li");
    li.className = "impact-item";
    const label = document.createElement("button");
    label.type = "button";
    label.className = "impact-item-label";
    label.textContent = pathById.get(node.id) || node.name;
    label.addEventListener("click", () => revealNode(node.id));
    li.append(label);
    refs.nodeList.append(li);
  }
}

// ---------------------------------------------------------------------------
// Edge form / list
// ---------------------------------------------------------------------------

function renderEdgeSelects() {
  const pathById = new Map(state.nodes.map((n) => [n.id, fullPathLabel(state.nodes, n.id)]));
  const sorted = [...state.nodes].sort((a, b) =>
    (pathById.get(a.id) ?? "").localeCompare(pathById.get(b.id) ?? "", "ja")
  );
  for (const select of [refs.edgeSource, refs.edgeTarget]) {
    const previous = select.value;
    select.innerHTML = "";
    for (const node of sorted) {
      const option = document.createElement("option");
      option.value = node.id;
      option.textContent = pathById.get(node.id) || node.name;
      select.append(option);
    }
    if (sorted.some((n) => n.id === previous)) {
      select.value = previous;
    }
  }
}

function resetEdgeForm() {
  state.editingEdgeId = null;
  state.openEdgeGroupKey = null;
  refs.edgeName.value = "";
  refs.edgeDescription.value = "";
}

function openEdgeGroup(agg) {
  if (agg.edges.length === 1) {
    selectEdge(agg.edges[0]);
    return;
  }
  state.openEdgeGroupKey = `${agg.ownerSourceId}->${agg.ownerTargetId}`;
  selectEdge(agg.edges[0]);
  setStatus(`このつながりには${agg.edges.length}件の関係があります。関係一覧から個別に編集してください。`);
}

function selectEdge(edge) {
  state.editingEdgeId = edge.id;
  refs.edgeSource.value = edge.sourceId;
  refs.edgeTarget.value = edge.targetId;
  refs.edgeName.value = edge.name;
  refs.edgeDescription.value = edge.description;
  setEditorTab("edge");
}

function saveEdge() {
  const input = {
    sourceId: refs.edgeSource.value,
    targetId: refs.edgeTarget.value,
    name: refs.edgeName.value,
    description: refs.edgeDescription.value,
  };
  const result = state.editingEdgeId
    ? updateEdge(state.editingEdgeId, input)
    : addEdge(input);
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  setStatus(state.editingEdgeId ? "関係を更新しました。" : "関係を追加しました。");
  state.editingEdgeId = result.edge.id;
  refreshAll();
}

function deleteSelectedEdge() {
  if (!state.editingEdgeId) {
    setStatus("削除する関係を選択してください。");
    return;
  }
  if (!globalThis.confirm("この関係を削除しますか？")) {
    return;
  }
  const result = deleteEdge(state.editingEdgeId);
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  resetEdgeForm();
  setStatus("関係を削除しました。");
  refreshAll();
}

function renderEdgeList() {
  refs.edgeList.innerHTML = "";
  const pathById = new Map(state.nodes.map((n) => [n.id, fullPathLabel(state.nodes, n.id)]));
  const sheetNodeIds = new Set(state.nodes.filter((n) => n.sheetId === state.activeSheetId).map((n) => n.id));
  const edges = state.edges.filter((e) => sheetNodeIds.has(e.sourceId) || sheetNodeIds.has(e.targetId));

  if (edges.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "関係がありません。";
    refs.edgeList.append(li);
    return;
  }

  for (const edge of edges) {
    const li = document.createElement("li");
    li.className = "impact-item";
    const label = document.createElement("button");
    label.type = "button";
    label.className = "impact-item-label";
    const from = pathById.get(edge.sourceId) ?? "?";
    const to = pathById.get(edge.targetId) ?? "?";
    label.textContent = `${from} → ${to} (${edge.name})`;
    label.addEventListener("click", () => selectEdge(edge));
    li.append(label);
    refs.edgeList.append(li);
  }
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

function renderSnapshotList() {
  refs.snapshotList.innerHTML = "";
  const metas = listSnapshotMetas();
  if (metas.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "スナップショットはありません。";
    refs.snapshotList.append(li);
    return;
  }

  for (const meta of metas) {
    const li = document.createElement("li");
    li.className = "impact-item";

    const row = document.createElement("div");
    row.className = "impact-item-main";
    const info = document.createElement("span");
    info.textContent = `${meta.createdAt.slice(0, 19).replace("T", " ")} - ${meta.message} (N:${meta.nodeCount} / E:${meta.edgeCount})`;
    row.append(info);

    const actions = document.createElement("div");
    actions.className = "impact-item-actions";

    const diffBtn = document.createElement("button");
    diffBtn.type = "button";
    diffBtn.className = "outline mini";
    diffBtn.textContent = "差分";
    diffBtn.addEventListener("click", () => toggleDiff(meta.id));
    actions.append(diffBtn);

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "outline mini";
    restoreBtn.textContent = "復元";
    restoreBtn.addEventListener("click", () => handleRestoreSnapshot(meta.id));
    actions.append(restoreBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "outline mini";
    deleteBtn.textContent = "削除";
    deleteBtn.addEventListener("click", () => handleDeleteSnapshot(meta.id));
    actions.append(deleteBtn);

    row.append(actions);
    li.append(row);

    if (state.diffOpenSnapshotId === meta.id) {
      const result = diffSnapshot(meta.id);
      const pre = document.createElement("pre");
      pre.className = "impact-diff-output";
      pre.textContent = result.ok ? formatDiff(result.diff) : result.message;
      li.append(pre);
    }

    refs.snapshotList.append(li);
  }
}

function formatDiff(diff) {
  const lines = [];
  lines.push(`追加ノード: ${diff.addedNodes.length}件`);
  for (const n of diff.addedNodes) lines.push(`  + ${n.name}`);
  lines.push(`削除ノード: ${diff.removedNodes.length}件`);
  for (const n of diff.removedNodes) lines.push(`  - ${n.name}`);
  lines.push(`変更ノード: ${diff.changedNodes.length}件`);
  for (const c of diff.changedNodes) lines.push(`  * ${c.before.name} -> ${c.after.name}`);
  lines.push(`追加関係: ${diff.addedEdges.length}件`);
  for (const e of diff.addedEdges) lines.push(`  + ${e.name}`);
  lines.push(`削除関係: ${diff.removedEdges.length}件`);
  for (const e of diff.removedEdges) lines.push(`  - ${e.name}`);
  lines.push(`変更関係: ${diff.changedEdges.length}件`);
  for (const c of diff.changedEdges) lines.push(`  * ${c.before.name} -> ${c.after.name}`);
  return lines.join("\n");
}

function toggleDiff(id) {
  state.diffOpenSnapshotId = state.diffOpenSnapshotId === id ? null : id;
  renderSnapshotList();
}

function handleCreateSnapshot() {
  const message = refs.snapshotMessage.value;
  const meta = createSnapshot(message);
  refs.snapshotMessage.value = "";
  setStatus(`スナップショット「${meta.message}」を保存しました。`);
  renderSnapshotList();
}

function handleRestoreSnapshot(id) {
  if (!globalThis.confirm("現在のデータを自動保存した上でスナップショットを復元します。よろしいですか？")) {
    return;
  }
  const result = restoreSnapshot(id);
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  setStatus("スナップショットを復元しました。復元前の状態は自動保存されています。");
  resetNodeForm();
  resetEdgeForm();
  refreshAll();
}

function handleDeleteSnapshot(id) {
  if (!globalThis.confirm("このスナップショットを削除しますか？")) {
    return;
  }
  const result = deleteSnapshot(id);
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  if (state.diffOpenSnapshotId === id) {
    state.diffOpenSnapshotId = null;
  }
  setStatus("スナップショットを削除しました。");
  renderSnapshotList();
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

function handleExportAll(format) {
  const result = exportAll(format, state.activeSheetId);
  triggerDownload(result.filename, result.content, result.contentType);
  setStatus(`シート全体を ${format.toUpperCase()} で書き出しました。`);
}

function handleExportRange(format) {
  if (!state.selectedNodeId) {
    setStatus("先に影響範囲を確認したいノードを選択してください。");
    return;
  }
  const result = exportImpactRange(state.selectedNodeId, state.direction, format);
  if (!result) {
    setStatus("選択中のノードが見つかりません。");
    return;
  }
  triggerDownload(result.filename, result.content, result.contentType);
  setStatus(`影響範囲を ${format.toUpperCase()} で書き出しました。`);
}

function handleImport() {
  const text = refs.importText.value.trim();
  if (!text) {
    setStatus("インポートするJSONを貼り付けてください。");
    return;
  }
  if (!globalThis.confirm("現在のデータを自動保存した上でインポートを実行します。よろしいですか？")) {
    return;
  }
  const result = importGraph(text);
  refs.importWarnings.innerHTML = "";
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  setStatus(`インポートしました（ノード${result.nodes.length}件 / 関係${result.edges.length}件）。`);
  for (const warning of result.warnings) {
    const p = document.createElement("p");
    p.textContent = `⚠ ${warning}`;
    refs.importWarnings.append(p);
  }
  refs.importText.value = "";
  state.activeSheetId = result.sheets[0]?.id ?? null;
  state.focusNodeId = null;
  resetNodeForm();
  resetEdgeForm();
  refreshAll();
}

// ---------------------------------------------------------------------------
// Mode / direction toggles
// ---------------------------------------------------------------------------

function setMode(mode) {
  state.mode = mode;
  refs.modeVisualize.classList.toggle("active", mode === "visualize");
  refs.modeEdit.classList.toggle("active", mode === "edit");
  renderCanvas();
}

function setEditorTab(tab) {
  for (const name of EDITOR_TABS) {
    refs.editorTabs[name].classList.toggle("active", name === tab);
    refs.editorPanels[name].classList.toggle("active", name === tab);
  }
  setEditorCollapsed(false);
}

function setEditorCollapsed(collapsed) {
  refs.editorContainer.classList.toggle("collapsed", collapsed);
  refs.editorToggle.setAttribute("aria-expanded", String(!collapsed));
  refs.editorToggle.textContent = collapsed ? "▴ 開く" : "▾ 閉じる";
}

function bindEvents() {
  refs.svg.addEventListener("click", handleSvgBackgroundClick);

  refs.modeVisualize.addEventListener("click", () => setMode("visualize"));
  refs.modeEdit.addEventListener("click", () => setMode("edit"));

  for (const name of EDITOR_TABS) {
    refs.editorTabs[name].addEventListener("click", () => setEditorTab(name));
  }

  refs.editorToggle.addEventListener("click", () => {
    setEditorCollapsed(!refs.editorContainer.classList.contains("collapsed"));
  });

  for (const radio of refs.directionRadios) {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        state.direction = radio.value;
        renderCanvas();
      }
    });
  }

  refs.sheetAdd.addEventListener("click", handleAddSheet);
  refs.sheetRename.addEventListener("click", handleRenameSheet);
  refs.sheetDelete.addEventListener("click", handleDeleteSheet);

  refs.nodeSave.addEventListener("click", saveNode);
  refs.nodeAddChild.addEventListener("click", startAddChild);
  refs.nodeDelete.addEventListener("click", deleteSelectedNode);
  refs.nodeCancel.addEventListener("click", () => {
    resetNodeForm();
    state.selectedNodeId = null;
    renderCanvas();
  });
  refs.nodeSearch.addEventListener("input", renderNodeList);

  refs.edgeSave.addEventListener("click", saveEdge);
  refs.edgeDelete.addEventListener("click", deleteSelectedEdge);
  refs.edgeCancel.addEventListener("click", resetEdgeForm);

  refs.snapshotCreate.addEventListener("click", handleCreateSnapshot);

  refs.exportJson.addEventListener("click", () => handleExportAll("json"));
  refs.exportYaml.addEventListener("click", () => handleExportAll("yaml"));
  refs.exportToml.addEventListener("click", () => handleExportAll("toml"));
  refs.exportCsv.addEventListener("click", () => handleExportAll("csv"));

  refs.exportRangeJson.addEventListener("click", () => handleExportRange("json"));
  refs.exportRangeYaml.addEventListener("click", () => handleExportRange("yaml"));
  refs.exportRangeToml.addEventListener("click", () => handleExportRange("toml"));
  refs.exportRangeCsv.addEventListener("click", () => handleExportRange("csv"));

  refs.importRun.addEventListener("click", handleImport);
}

export function initImpactGraph() {
  refs = {
    status: q("impact-status"),
    modeVisualize: q("impact-mode-visualize"),
    modeEdit: q("impact-mode-edit"),
    editorContainer: q("impact-editor"),
    editorToggle: q("impact-editor-toggle"),
    editorTabs: {
      node: q("impact-editor-tab-node"),
      edge: q("impact-editor-tab-edge"),
      snapshot: q("impact-editor-tab-snapshot"),
      io: q("impact-editor-tab-io"),
    },
    editorPanels: {
      node: q("impact-editor-panel-node"),
      edge: q("impact-editor-panel-edge"),
      snapshot: q("impact-editor-panel-snapshot"),
      io: q("impact-editor-panel-io"),
    },
    sheetTabs: q("impact-sheet-tabs"),
    sheetNameInput: q("impact-sheet-name-input"),
    sheetAdd: q("impact-sheet-add"),
    sheetRename: q("impact-sheet-rename"),
    sheetDelete: q("impact-sheet-delete"),
    breadcrumb: q("impact-breadcrumb"),
    svg: q("impact-svg"),
    directionRadios: document.querySelectorAll('input[name="impact-direction"]'),
    nodeName: q("impact-node-name"),
    nodeDescription: q("impact-node-description"),
    nodeSave: q("impact-node-save"),
    nodeAddChild: q("impact-node-add-child"),
    nodeDelete: q("impact-node-delete"),
    nodeCancel: q("impact-node-cancel"),
    nodeSearch: q("impact-node-search"),
    nodeList: q("impact-node-list"),
    edgeSource: q("impact-edge-source"),
    edgeTarget: q("impact-edge-target"),
    edgeName: q("impact-edge-name"),
    edgeDescription: q("impact-edge-description"),
    edgeSave: q("impact-edge-save"),
    edgeDelete: q("impact-edge-delete"),
    edgeCancel: q("impact-edge-cancel"),
    edgeList: q("impact-edge-list"),
    snapshotMessage: q("impact-snapshot-message"),
    snapshotCreate: q("impact-snapshot-create"),
    snapshotList: q("impact-snapshot-list"),
    exportJson: q("impact-export-json"),
    exportYaml: q("impact-export-yaml"),
    exportToml: q("impact-export-toml"),
    exportCsv: q("impact-export-csv"),
    exportRangeJson: q("impact-export-range-json"),
    exportRangeYaml: q("impact-export-range-yaml"),
    exportRangeToml: q("impact-export-range-toml"),
    exportRangeCsv: q("impact-export-range-csv"),
    importText: q("impact-import-text"),
    importRun: q("impact-import-run"),
    importWarnings: q("impact-import-warnings"),
  };

  bindEvents();
  resetNodeForm();
  resetEdgeForm();
  refreshAll();
}
