import {
  buildExportRows,
  computeImpactRangeGraph,
  DEFAULT_SHEET_NAME,
  diffGraphs,
  exportGraphJson,
  getDescendantIds,
  newId,
  nodeById,
  nodesInSheet,
  parseGraphImport,
  serializeExportRows,
} from "../domain/impactGraph.js";

const KEYS = {
    nodes: "impact.v1.nodes",
    edges: "impact.v1.edges",
    sheets: "impact.v1.sheets",
    snapshotMetas: "impact.v1.snapshots.meta",
    snapshotData: (id) => `impact.v1.snapshots.data.${id}`,
};
function readJson(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) {
        return fallback;
    }
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}
function loadNodesRaw() {
    return readJson(KEYS.nodes, []);
}
function saveNodes(nodes) {
    writeJson(KEYS.nodes, nodes);
}
function loadEdges() {
    return readJson(KEYS.edges, []);
}
function saveEdges(edges) {
    writeJson(KEYS.edges, edges);
}
function loadSheetsRaw() {
    return readJson(KEYS.sheets, []);
}
function saveSheets(sheets) {
    writeJson(KEYS.sheets, sheets);
}
/**
 * Ensures at least one sheet exists and that every node's sheetId follows its
 * top-level (root) ancestor, healing any inconsistency left over from manual
 * edits or a partial import. Synchronous equivalent of the original
 * `ensureSheetsAndMigrateNodes` (which operated against Deno.Kv).
 */
function healSheetsAndNodes() {
    let sheets = loadSheetsRaw();
    let nodes = loadNodesRaw();
    if (sheets.length === 0) {
        const now = new Date().toISOString();
        sheets = [{
                id: newId(),
                name: DEFAULT_SHEET_NAME,
                order: 0,
                createdAt: now,
                updatedAt: now,
            }];
        saveSheets(sheets);
    }
    const validSheetIds = new Set(sheets.map((s) => s.id));
    const fallbackSheetId = sheets[0].id;
    const byId = nodeById(nodes);
    const rootSheetIdCache = new Map();
    function rootOf(node) {
        let current = node;
        const seen = new Set([node.id]);
        while (current.parentId) {
            const parent = byId.get(current.parentId);
            if (!parent || seen.has(parent.id)) {
                break;
            }
            seen.add(parent.id);
            current = parent;
        }
        return current;
    }
    let changed = false;
    const fixedNodes = nodes.map((node) => {
        const root = rootOf(node);
        let sheetId = rootSheetIdCache.get(root.id);
        if (sheetId === undefined) {
            sheetId = validSheetIds.has(root.sheetId) ? root.sheetId : fallbackSheetId;
            rootSheetIdCache.set(root.id, sheetId);
        }
        if (sheetId !== node.sheetId) {
            changed = true;
            return { ...node, sheetId };
        }
        return node;
    });
    if (changed) {
        saveNodes(fixedNodes);
    }
    nodes = fixedNodes;
    return { nodes, sheets };
}
export function loadGraph() {
    const { nodes, sheets } = healSheetsAndNodes();
    return { nodes, edges: loadEdges(), sheets };
}
export function addNode(input) {
    const name = input.name.trim();
    if (!name) {
        return { ok: false, message: "ノード名を入力してください" };
    }
    const { nodes, sheets } = healSheetsAndNodes();
    let sheetId;
    if (input.parentId) {
        const parent = nodes.find((n) => n.id === input.parentId);
        if (!parent) {
            return { ok: false, message: "親ノードが見つかりません" };
        }
        sheetId = parent.sheetId;
    }
    else {
        const sheet = sheets.find((s) => s.id === input.sheetId);
        if (!sheet) {
            return { ok: false, message: "シートを選択してください" };
        }
        sheetId = sheet.id;
    }
    const now = new Date().toISOString();
    const node = {
        id: newId(),
        parentId: input.parentId,
        sheetId,
        name,
        description: input.description ?? "",
        x: null,
        y: null,
        createdAt: now,
        updatedAt: now,
    };
    saveNodes([...nodes, node]);
    return { ok: true, node };
}
export function updateNode(id, input) {
    const name = input.name.trim();
    if (!name) {
        return { ok: false, message: "ノード名を入力してください" };
    }
    const { nodes } = healSheetsAndNodes();
    const index = nodes.findIndex((n) => n.id === id);
    if (index === -1) {
        return { ok: false, message: "ノードが見つかりません" };
    }
    const updated = {
        ...nodes[index],
        name,
        description: input.description ?? "",
        updatedAt: new Date().toISOString(),
    };
    const next = [...nodes];
    next[index] = updated;
    saveNodes(next);
    return { ok: true, node: updated };
}
export function updateNodePosition(id, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, message: "位置情報が不正です" };
    }
    const { nodes } = healSheetsAndNodes();
    const index = nodes.findIndex((n) => n.id === id);
    if (index === -1) {
        return { ok: false, message: "ノードが見つかりません" };
    }
    const updated = { ...nodes[index], x, y, updatedAt: new Date().toISOString() };
    const next = [...nodes];
    next[index] = updated;
    saveNodes(next);
    return { ok: true, node: updated };
}
export function deleteNode(id) {
    const { nodes } = healSheetsAndNodes();
    if (!nodes.some((n) => n.id === id)) {
        return { ok: false, message: "ノードが見つかりません" };
    }
    const descendantIds = getDescendantIds(nodes, id);
    const edges = loadEdges();
    const deletedEdgeIds = edges
        .filter((e) => descendantIds.has(e.sourceId) || descendantIds.has(e.targetId))
        .map((e) => e.id);
    saveNodes(nodes.filter((n) => !descendantIds.has(n.id)));
    saveEdges(edges.filter((e) => !deletedEdgeIds.includes(e.id)));
    return { ok: true, deletedNodeIds: [...descendantIds], deletedEdgeIds };
}
export function addEdge(input) {
    const name = input.name.trim();
    if (!input.sourceId || !input.targetId) {
        return { ok: false, message: "関係元・関係先を選択してください" };
    }
    if (input.sourceId === input.targetId) {
        return { ok: false, message: "同じノード同士は関係付けできません" };
    }
    if (!name) {
        return { ok: false, message: "関係名を入力してください" };
    }
    const { nodes } = healSheetsAndNodes();
    const byId = nodeById(nodes);
    if (!byId.has(input.sourceId) || !byId.has(input.targetId)) {
        return { ok: false, message: "対象ノードが見つかりません" };
    }
    const now = new Date().toISOString();
    const edge = {
        id: newId(),
        sourceId: input.sourceId,
        targetId: input.targetId,
        name,
        description: input.description ?? "",
        createdAt: now,
        updatedAt: now,
    };
    saveEdges([...loadEdges(), edge]);
    return { ok: true, edge };
}
export function updateEdge(id, input) {
    const name = input.name.trim();
    if (!name) {
        return { ok: false, message: "関係名を入力してください" };
    }
    const edges = loadEdges();
    const index = edges.findIndex((e) => e.id === id);
    if (index === -1) {
        return { ok: false, message: "関係が見つかりません" };
    }
    const updated = {
        ...edges[index],
        name,
        description: input.description ?? "",
        updatedAt: new Date().toISOString(),
    };
    const next = [...edges];
    next[index] = updated;
    saveEdges(next);
    return { ok: true, edge: updated };
}
export function deleteEdge(id) {
    const edges = loadEdges();
    if (!edges.some((e) => e.id === id)) {
        return { ok: false, message: "関係が見つかりません" };
    }
    saveEdges(edges.filter((e) => e.id !== id));
    return { ok: true, deletedEdgeId: id };
}
export function addSheet(name) {
    const trimmed = name.trim();
    if (!trimmed) {
        return { ok: false, message: "シート名を入力してください" };
    }
    const { sheets } = healSheetsAndNodes();
    const now = new Date().toISOString();
    const sheet = {
        id: newId(),
        name: trimmed.slice(0, 100),
        order: sheets.length,
        createdAt: now,
        updatedAt: now,
    };
    saveSheets([...sheets, sheet]);
    return { ok: true, sheet };
}
export function renameSheet(id, name) {
    const trimmed = name.trim();
    if (!trimmed) {
        return { ok: false, message: "シート名を入力してください" };
    }
    const { sheets } = healSheetsAndNodes();
    const index = sheets.findIndex((s) => s.id === id);
    if (index === -1) {
        return { ok: false, message: "シートが見つかりません" };
    }
    const updated = {
        ...sheets[index],
        name: trimmed.slice(0, 100),
        updatedAt: new Date().toISOString(),
    };
    const next = [...sheets];
    next[index] = updated;
    saveSheets(next);
    return { ok: true, sheet: updated };
}
export function deleteSheet(id) {
    const { nodes, sheets } = healSheetsAndNodes();
    if (!sheets.some((s) => s.id === id)) {
        return { ok: false, message: "シートが見つかりません" };
    }
    if (sheets.length <= 1) {
        return { ok: false, message: "最後の1枚のシートは削除できません" };
    }
    const edges = loadEdges();
    const deletedNodeIds = nodesInSheet(nodes, id).map((n) => n.id);
    const deletedNodeIdSet = new Set(deletedNodeIds);
    const deletedEdgeIds = edges
        .filter((e) => deletedNodeIdSet.has(e.sourceId) || deletedNodeIdSet.has(e.targetId))
        .map((e) => e.id);
    saveNodes(nodes.filter((n) => !deletedNodeIdSet.has(n.id)));
    saveEdges(edges.filter((e) => !deletedEdgeIds.includes(e.id)));
    saveSheets(sheets.filter((s) => s.id !== id));
    return { ok: true, deletedNodeIds, deletedEdgeIds, deletedSheetId: id };
}
function loadSnapshotMetas() {
    return readJson(KEYS.snapshotMetas, []);
}
function saveSnapshotMetas(metas) {
    writeJson(KEYS.snapshotMetas, metas);
}
function saveSnapshotFor(message) {
    const { nodes, edges } = loadGraph();
    const id = newId();
    const createdAt = new Date().toISOString();
    writeJson(KEYS.snapshotData(id), { nodes, edges });
    const meta = {
        id,
        message,
        createdAt,
        nodeCount: nodes.length,
        edgeCount: edges.length,
    };
    saveSnapshotMetas([meta, ...loadSnapshotMetas()]);
    return meta;
}
export function createSnapshot(message) {
    return saveSnapshotFor(message.trim() || "(no message)");
}
export function listSnapshotMetas() {
    return [...loadSnapshotMetas()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function diffSnapshot(id) {
    const data = readJson(KEYS.snapshotData(id), null);
    if (!data) {
        return { ok: false, message: "スナップショットが見つかりません" };
    }
    const current = loadGraph();
    return { ok: true, diff: diffGraphs(data, { nodes: current.nodes, edges: current.edges }) };
}
export function restoreSnapshot(id) {
    const data = readJson(KEYS.snapshotData(id), null);
    if (!data) {
        return { ok: false, message: "スナップショットが見つかりません" };
    }
    const autoSnapshotMeta = saveSnapshotFor("復元前の自動保存");
    saveNodes(data.nodes);
    saveEdges(data.edges);
    return { ok: true, nodes: data.nodes, edges: data.edges, autoSnapshotMeta };
}
export function deleteSnapshot(id) {
    const metas = loadSnapshotMetas();
    if (!metas.some((m) => m.id === id)) {
        return { ok: false, message: "スナップショットが見つかりません" };
    }
    saveSnapshotMetas(metas.filter((m) => m.id !== id));
    localStorage.removeItem(KEYS.snapshotData(id));
    return { ok: true };
}
export function importGraph(text) {
    const parsed = parseGraphImport(text);
    if (!parsed.ok) {
        return { ok: false, message: parsed.message };
    }
    const autoSnapshotMeta = saveSnapshotFor("インポート前の自動保存");
    saveNodes(parsed.nodes);
    saveEdges(parsed.edges);
    saveSheets(parsed.sheets);
    return {
        ok: true,
        nodes: parsed.nodes,
        edges: parsed.edges,
        sheets: parsed.sheets,
        warnings: parsed.warnings,
        autoSnapshotMeta,
    };
}
function timestampForFilename() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}
/** Exports the whole graph (optionally scoped to one sheet). */
export function exportAll(format, sheetId) {
    const { nodes, edges, sheets } = loadGraph();
    const exportNodes = sheetId ? nodesInSheet(nodes, sheetId) : nodes;
    const exportNodeIds = new Set(exportNodes.map((n) => n.id));
    const exportEdges = sheetId
        ? edges.filter((e) => exportNodeIds.has(e.sourceId) && exportNodeIds.has(e.targetId))
        : edges;
    const sheetSuffix = sheetId ? `_${sheets.find((s) => s.id === sheetId)?.name ?? "sheet"}` : "";
    const stamp = timestampForFilename();
    if (format === "json") {
        return {
            content: exportGraphJson(exportNodes, exportEdges, sheets),
            contentType: "application/json;charset=utf-8",
            filename: `impact_graph${sheetSuffix}_${stamp}.json`,
        };
    }
    const { nodeRows, edgeRows } = buildExportRows(nodes, exportNodes, exportEdges, sheets);
    const serialized = serializeExportRows(format, nodeRows, edgeRows);
    return {
        content: serialized.content,
        contentType: serialized.contentType,
        filename: `impact_graph${sheetSuffix}_${stamp}.${serialized.extension}`,
    };
}
/** Exports the subgraph reachable from a node (used for "影響範囲をファイルに出力"). */
export function exportImpactRange(nodeId, direction, format) {
    const { nodes, edges, sheets } = loadGraph();
    if (!nodes.some((n) => n.id === nodeId)) {
        return null;
    }
    const range = computeImpactRangeGraph(nodes, edges, nodeId, direction);
    const { nodeRows, edgeRows } = buildExportRows(nodes, range.nodes, range.edges, sheets);
    const serialized = serializeExportRows(format, nodeRows, edgeRows);
    const stamp = timestampForFilename();
    return {
        content: serialized.content,
        contentType: serialized.contentType,
        filename: `impact_range_${stamp}.${serialized.extension}`,
    };
}
