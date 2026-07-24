// Impact management / visualization graph domain logic.
// Ported from 05_blog/lib/impact_graph.ts, with all Deno.Kv-specific
// persistence removed (that lives in src/storage/impactGraphStore.ts,
// backed by localStorage instead of a server-side KV store).

export type ImpactNode = {
  id: string;
  parentId: string | null;
  sheetId: string;
  name: string;
  description: string;
  x: number | null;
  y: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ImpactSheet = {
  id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type ImpactEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type AggregatedEdge = {
  ownerSourceId: string;
  ownerTargetId: string;
  edges: ImpactEdge[];
};

export type ReachabilityDirection = "downstream" | "upstream" | "both";

export const DEFAULT_SHEET_NAME = "シート1";

export function newId(): string {
  return crypto.randomUUID();
}

export function nodeById(nodes: ImpactNode[]): Map<string, ImpactNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function nodesInSheet(nodes: ImpactNode[], sheetId: string): ImpactNode[] {
  return nodes.filter((n) => n.sheetId === sheetId);
}

export function edgesTouchingNodes(edges: ImpactEdge[], nodeIds: Set<string>): ImpactEdge[] {
  return edges.filter((e) => nodeIds.has(e.sourceId) || nodeIds.has(e.targetId));
}

/** Returns the ancestor chain from root to the node itself (inclusive). */
export function getAncestorPath(nodes: ImpactNode[], nodeId: string): ImpactNode[] {
  const byId = nodeById(nodes);
  const path: ImpactNode[] = [];
  let current = byId.get(nodeId);
  const seen = new Set<string>();

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return path;
}

export function fullPathLabel(nodes: ImpactNode[], nodeId: string): string {
  return getAncestorPath(nodes, nodeId).map((n) => n.name).join("/");
}

/** Builds a nodeId -> full path ("A/B/C") map in a single pass (memoized recursion). */
export function buildPathMap(nodes: ImpactNode[]): Map<string, string> {
  const byId = nodeById(nodes);
  const cache = new Map<string, string>();

  function resolve(id: string, seen: Set<string>): string {
    const cached = cache.get(id);
    if (cached !== undefined) {
      return cached;
    }

    const node = byId.get(id);
    if (!node || seen.has(id)) {
      return "";
    }

    seen.add(id);
    const path = node.parentId ? `${resolve(node.parentId, seen)}/${node.name}` : node.name;
    cache.set(id, path);
    return path;
  }

  for (const node of nodes) {
    resolve(node.id, new Set());
  }

  return cache;
}

export function sceneNodes(
  nodes: ImpactNode[],
  focusNodeId: string | null,
  activeSheetId?: string | null,
): ImpactNode[] {
  return nodes
    .filter((n) =>
      n.parentId === focusNodeId &&
      (focusNodeId !== null || activeSheetId == null || n.sheetId === activeSheetId)
    )
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/** Determines which scene node "owns" (represents) the given node within the current scene. */
export function sceneOwnerOf(
  nodes: ImpactNode[],
  focusNodeId: string | null,
  nodeId: string,
): string | undefined {
  const byId = nodeById(nodes);
  let current = byId.get(nodeId);
  const seen = new Set<string>();

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (focusNodeId === null) {
      if (current.parentId === null) {
        return current.id;
      }
    } else {
      if (current.parentId === focusNodeId) {
        return current.id;
      }
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return undefined;
}

export function buildAggregatedEdges(
  nodes: ImpactNode[],
  edges: ImpactEdge[],
  focusNodeId: string | null,
): AggregatedEdge[] {
  const groups = new Map<string, AggregatedEdge>();

  for (const edge of edges) {
    const ownerSourceId = sceneOwnerOf(nodes, focusNodeId, edge.sourceId);
    const ownerTargetId = sceneOwnerOf(nodes, focusNodeId, edge.targetId);
    if (!ownerSourceId || !ownerTargetId || ownerSourceId === ownerTargetId) {
      continue;
    }

    const key = `${ownerSourceId}->${ownerTargetId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.edges.push(edge);
    } else {
      groups.set(key, { ownerSourceId, ownerTargetId, edges: [edge] });
    }
  }

  return [...groups.values()];
}

export type ExternalLinkDirection = "outgoing" | "incoming";

export type ExternalLink = {
  /** The node id that IS visible in the current scene (a scene-owner). */
  sceneOwnerId: string;
  /** The real node id that lives outside the current scene (not directly rendered here). */
  externalNodeId: string;
  /** "outgoing": sceneOwner -> externalNode. "incoming": externalNode -> sceneOwner. */
  direction: ExternalLinkDirection;
  edges: ImpactEdge[];
};

/**
 * Finds edges where only one endpoint resolves to a node visible in the current
 * scene (see sceneOwnerOf) - i.e. the other endpoint lives in a different branch
 * of the hierarchy (a different document, or an ancestor of the current focus)
 * and would otherwise disappear entirely. Returns one aggregated "external link"
 * per (scene owner, real external node, direction) so the nearest connection is
 * always visible, without needing to fully resolve or render where the external
 * node actually lives in the hierarchy.
 */
export function buildExternalLinks(
  nodes: ImpactNode[],
  edges: ImpactEdge[],
  focusNodeId: string | null,
): ExternalLink[] {
  const byId = nodeById(nodes);
  const groups = new Map<string, ExternalLink>();

  for (const edge of edges) {
    const ownerSourceId = sceneOwnerOf(nodes, focusNodeId, edge.sourceId);
    const ownerTargetId = sceneOwnerOf(nodes, focusNodeId, edge.targetId);

    if (Boolean(ownerSourceId) === Boolean(ownerTargetId)) {
      // Both resolve (already a normal in-scene edge) or neither resolves
      // (unrelated to the current scene) - nothing extra to show.
      continue;
    }

    const direction: ExternalLinkDirection = ownerSourceId ? "outgoing" : "incoming";
    const sceneOwnerId = (ownerSourceId ?? ownerTargetId)!;
    const externalNodeId = ownerSourceId ? edge.targetId : edge.sourceId;
    if (!byId.has(externalNodeId)) {
      continue;
    }

    const key = `${direction}:${sceneOwnerId}->${externalNodeId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.edges.push(edge);
    } else {
      groups.set(key, { sceneOwnerId, externalNodeId, direction, edges: [edge] });
    }
  }

  return [...groups.values()];
}

export function getDescendantIds(nodes: ImpactNode[], nodeId: string): Set<string> {
  const childrenByParent = new Map<string, ImpactNode[]>();
  for (const node of nodes) {
    if (node.parentId) {
      const list = childrenByParent.get(node.parentId) ?? [];
      list.push(node);
      childrenByParent.set(node.parentId, list);
    }
  }

  const result = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (!result.has(child.id)) {
        result.add(child.id);
        stack.push(child.id);
      }
    }
  }

  return result;
}

/** BFS over the full graph (all nodes/edges regardless of hierarchy level). */
function reachableIds(
  edges: ImpactEdge[],
  startId: string,
  direction: "downstream" | "upstream",
): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = direction === "downstream" ? edge.sourceId : edge.targetId;
    const to = direction === "downstream" ? edge.targetId : edge.sourceId;
    const list = adjacency.get(from) ?? [];
    list.push(to);
    adjacency.set(from, list);
  }

  const visited = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return visited;
}

export type ImpactHighlight = {
  selectedOwnerId: string | undefined;
  highlightedOwnerIds: Set<string>;
  highlightedEdgeKeys: Set<string>;
  /** Raw reachable node ids (regardless of scene), used to also highlight external links. */
  visitedIds: Set<string>;
};

export function computeImpactHighlight(
  nodes: ImpactNode[],
  edges: ImpactEdge[],
  aggregatedEdges: AggregatedEdge[],
  focusNodeId: string | null,
  selectedNodeId: string,
  direction: ReachabilityDirection,
): ImpactHighlight {
  let visited: Set<string>;
  if (direction === "both") {
    const down = reachableIds(edges, selectedNodeId, "downstream");
    const up = reachableIds(edges, selectedNodeId, "upstream");
    visited = new Set([...down, ...up]);
  } else {
    visited = reachableIds(edges, selectedNodeId, direction);
  }

  const highlightedOwnerIds = new Set<string>();
  for (const id of visited) {
    const owner = sceneOwnerOf(nodes, focusNodeId, id);
    if (owner) {
      highlightedOwnerIds.add(owner);
    }
  }

  const highlightedEdgeKeys = new Set<string>();
  for (const agg of aggregatedEdges) {
    const isRelevant = agg.edges.some(
      (edge) => visited.has(edge.sourceId) && visited.has(edge.targetId),
    );
    if (isRelevant) {
      highlightedEdgeKeys.add(`${agg.ownerSourceId}->${agg.ownerTargetId}`);
    }
  }

  return {
    selectedOwnerId: sceneOwnerOf(nodes, focusNodeId, selectedNodeId),
    highlightedOwnerIds,
    highlightedEdgeKeys,
    visitedIds: visited,
  };
}

/** Extracts the subgraph reachable from selectedNodeId (used for impact-range export). */
export function computeImpactRangeGraph(
  nodes: ImpactNode[],
  edges: ImpactEdge[],
  selectedNodeId: string,
  direction: ReachabilityDirection,
): { nodes: ImpactNode[]; edges: ImpactEdge[] } {
  let visited: Set<string>;
  if (direction === "both") {
    const down = reachableIds(edges, selectedNodeId, "downstream");
    const up = reachableIds(edges, selectedNodeId, "upstream");
    visited = new Set([...down, ...up]);
  } else {
    visited = reachableIds(edges, selectedNodeId, direction);
  }

  const resultNodes = nodes.filter((n) => visited.has(n.id));
  const resultEdges = edges.filter((e) => visited.has(e.sourceId) && visited.has(e.targetId));
  return { nodes: resultNodes, edges: resultEdges };
}

// ---------------------------------------------------------------------------
// Snapshots (git-like history: diff two full graph states)
// ---------------------------------------------------------------------------

export type ImpactSnapshotMeta = {
  id: string;
  message: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
};

export type ImpactSnapshotData = {
  nodes: ImpactNode[];
  edges: ImpactEdge[];
};

export type GraphDiff = {
  addedNodes: ImpactNode[];
  removedNodes: ImpactNode[];
  changedNodes: { before: ImpactNode; after: ImpactNode }[];
  addedEdges: ImpactEdge[];
  removedEdges: ImpactEdge[];
  changedEdges: { before: ImpactEdge; after: ImpactEdge }[];
};

/** Compares two full graph states (e.g. a snapshot vs the current live graph). */
export function diffGraphs(
  before: ImpactSnapshotData,
  after: ImpactSnapshotData,
): GraphDiff {
  const beforeNodeById = nodeById(before.nodes);
  const afterNodeById = nodeById(after.nodes);

  const addedNodes = after.nodes.filter((n) => !beforeNodeById.has(n.id));
  const removedNodes = before.nodes.filter((n) => !afterNodeById.has(n.id));
  const changedNodes: { before: ImpactNode; after: ImpactNode }[] = [];
  for (const n of after.nodes) {
    const prev = beforeNodeById.get(n.id);
    if (
      prev &&
      (prev.name !== n.name || prev.description !== n.description ||
        prev.parentId !== n.parentId)
    ) {
      changedNodes.push({ before: prev, after: n });
    }
  }

  const beforeEdgeById = new Map(before.edges.map((e) => [e.id, e]));
  const afterEdgeById = new Map(after.edges.map((e) => [e.id, e]));
  const addedEdges = after.edges.filter((e) => !beforeEdgeById.has(e.id));
  const removedEdges = before.edges.filter((e) => !afterEdgeById.has(e.id));
  const changedEdges: { before: ImpactEdge; after: ImpactEdge }[] = [];
  for (const e of after.edges) {
    const prev = beforeEdgeById.get(e.id);
    if (
      prev &&
      (prev.name !== e.name || prev.description !== e.description ||
        prev.sourceId !== e.sourceId || prev.targetId !== e.targetId)
    ) {
      changedEdges.push({ before: prev, after: e });
    }
  }

  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges, changedEdges };
}

// ---------------------------------------------------------------------------
// Import (from pasted/uploaded JSON) with defensive validation
// ---------------------------------------------------------------------------

export type GraphImportResult =
  | {
    ok: true;
    nodes: ImpactNode[];
    edges: ImpactEdge[];
    sheets: ImpactSheet[];
    warnings: string[];
  }
  | { ok: false; message: string };

const MAX_IMPORT_NODES = 5000;
const MAX_IMPORT_EDGES = 20000;
const MAX_IMPORT_SHEETS = 500;
const UNSORTED_SHEET_NAME = "未分類";

/** Parses and validates a user-supplied JSON graph export before it is trusted and persisted. */
export function parseGraphImport(text: string): GraphImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: "JSONの解析に失敗しました" };
  }

  if (typeof data !== "object" || data === null) {
    return { ok: false, message: "トップレベルはオブジェクトである必要があります" };
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    return { ok: false, message: "nodes / edges 配列が必要です" };
  }
  if (obj.nodes.length > MAX_IMPORT_NODES || obj.edges.length > MAX_IMPORT_EDGES) {
    return { ok: false, message: "データ量が大きすぎます" };
  }
  const rawSheets = Array.isArray(obj.sheets) ? obj.sheets : [];
  if (rawSheets.length > MAX_IMPORT_SHEETS) {
    return { ok: false, message: "シート数が多すぎます" };
  }

  const warnings: string[] = [];

  const sheets: ImpactSheet[] = [];
  const knownSheetIds = new Set<string>();
  for (const raw of rawSheets) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string" || !s.id || typeof s.name !== "string" || !s.name) {
      continue;
    }
    if (knownSheetIds.has(s.id)) {
      continue;
    }
    knownSheetIds.add(s.id);
    sheets.push({
      id: s.id,
      name: s.name.slice(0, 100),
      order: typeof s.order === "number" && Number.isFinite(s.order) ? s.order : sheets.length,
      createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString(),
      updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : new Date().toISOString(),
    });
  }

  const nodes: ImpactNode[] = [];
  const nodeIds = new Set<string>();
  for (const raw of obj.nodes) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, message: "ノードの形式が不正です" };
    }
    const n = raw as Record<string, unknown>;
    if (typeof n.id !== "string" || !n.id || typeof n.name !== "string" || !n.name) {
      return { ok: false, message: "ノードには id / name (文字列) が必要です" };
    }
    if (nodeIds.has(n.id)) {
      return { ok: false, message: `ノードIDが重複しています: ${n.id}` };
    }
    nodeIds.add(n.id);
    nodes.push({
      id: n.id,
      parentId: typeof n.parentId === "string" && n.parentId ? n.parentId : null,
      sheetId: typeof n.sheetId === "string" ? n.sheetId : "",
      name: n.name.slice(0, 200),
      description: typeof n.description === "string" ? n.description.slice(0, 5000) : "",
      x: typeof n.x === "number" && Number.isFinite(n.x) ? n.x : null,
      y: typeof n.y === "number" && Number.isFinite(n.y) ? n.y : null,
      createdAt: typeof n.createdAt === "string" ? n.createdAt : new Date().toISOString(),
      updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : new Date().toISOString(),
    });
  }

  const nodeByIdMap = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    if (node.parentId !== null && !nodeByIdMap.has(node.parentId)) {
      return { ok: false, message: `親ノードが見つかりません: ${node.parentId}` };
    }
  }
  for (const node of nodes) {
    const seen = new Set<string>();
    let current: ImpactNode | undefined = node;
    while (current && current.parentId) {
      if (seen.has(current.id)) {
        return { ok: false, message: "循環した親子関係が検出されました" };
      }
      seen.add(current.id);
      current = nodeByIdMap.get(current.parentId);
    }
  }

  // Every node's sheet follows its top-level (root) ancestor. Unknown sheetIds
  // become placeholder sheets (with a warning); nodes with no sheet info at
  // all are grouped into a shared "未分類" sheet (with a single summary warning).
  let unsortedSheet: ImpactSheet | null = null;
  function ensureUnsortedSheet(): ImpactSheet {
    if (!unsortedSheet) {
      const now = new Date().toISOString();
      unsortedSheet = {
        id: newId(),
        name: UNSORTED_SHEET_NAME,
        order: sheets.length,
        createdAt: now,
        updatedAt: now,
      };
      sheets.push(unsortedSheet);
    }
    return unsortedSheet;
  }

  function rootOf(node: ImpactNode): ImpactNode {
    let current = node;
    const seen = new Set<string>([node.id]);
    while (current.parentId) {
      const parent = nodeByIdMap.get(current.parentId);
      if (!parent || seen.has(parent.id)) {
        break;
      }
      seen.add(parent.id);
      current = parent;
    }
    return current;
  }

  const rootSheetIdCache = new Map<string, string>();
  const placeholderSheetIds = new Set<string>();
  let unsortedNodeCount = 0;

  function resolveRootSheetId(root: ImpactNode): string {
    if (root.sheetId && knownSheetIds.has(root.sheetId)) {
      return root.sheetId;
    }
    if (root.sheetId) {
      if (!placeholderSheetIds.has(root.sheetId)) {
        placeholderSheetIds.add(root.sheetId);
        knownSheetIds.add(root.sheetId);
        const now = new Date().toISOString();
        sheets.push({
          id: root.sheetId,
          name: `不明なシート(${root.sheetId.slice(0, 8)})`,
          order: sheets.length,
          createdAt: now,
          updatedAt: now,
        });
        warnings.push(
          `シートID "${root.sheetId}" が見つからないため仮のシートを作成しました。`,
        );
      }
      return root.sheetId;
    }
    unsortedNodeCount += 1;
    return ensureUnsortedSheet().id;
  }

  for (const node of nodes) {
    const root = rootOf(node);
    let sheetId = rootSheetIdCache.get(root.id);
    if (sheetId === undefined) {
      sheetId = resolveRootSheetId(root);
      rootSheetIdCache.set(root.id, sheetId);
    }
    node.sheetId = sheetId;
  }
  if (unsortedNodeCount > 0) {
    warnings.push(
      `${unsortedNodeCount}件のノードにシート情報がなかったため「${UNSORTED_SHEET_NAME}」シートに割り当てました。`,
    );
  }
  if (sheets.length === 0) {
    const now = new Date().toISOString();
    sheets.push({
      id: newId(),
      name: DEFAULT_SHEET_NAME,
      order: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  const edges: ImpactEdge[] = [];
  const edgeIds = new Set<string>();
  for (const raw of obj.edges) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, message: "関係の形式が不正です" };
    }
    const e = raw as Record<string, unknown>;
    if (
      typeof e.id !== "string" || !e.id ||
      typeof e.sourceId !== "string" || !e.sourceId ||
      typeof e.targetId !== "string" || !e.targetId ||
      typeof e.name !== "string" || !e.name
    ) {
      return { ok: false, message: "関係には id / sourceId / targetId / name (文字列) が必要です" };
    }
    if (edgeIds.has(e.id)) {
      return { ok: false, message: `関係IDが重複しています: ${e.id}` };
    }
    edgeIds.add(e.id);

    if (!nodeByIdMap.has(e.sourceId) || !nodeByIdMap.has(e.targetId)) {
      warnings.push(
        `関係「${e.name}」は参照先ノードが見つからないため読み込みをスキップしました` +
          `（別シートのノードが今回の読み込みに含まれていない可能性があります）。`,
      );
      continue;
    }

    edges.push({
      id: e.id,
      sourceId: e.sourceId,
      targetId: e.targetId,
      name: e.name.slice(0, 200),
      description: typeof e.description === "string" ? e.description.slice(0, 5000) : "",
      createdAt: typeof e.createdAt === "string" ? e.createdAt : new Date().toISOString(),
      updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : new Date().toISOString(),
    });
  }

  return { ok: true, nodes, edges, sheets, warnings };
}

// ---------------------------------------------------------------------------
// Export serialization (share as text: JSON / YAML / TOML / CSV)
// ---------------------------------------------------------------------------

export type ExportFormat = "json" | "yaml" | "toml" | "csv";

export type ExportNodeRow = {
  id: string;
  sheet: string;
  path: string;
  name: string;
  description: string;
};
export type ExportEdgeRow = {
  id: string;
  sourceSheet: string;
  sourcePath: string;
  targetSheet: string;
  targetPath: string;
  name: string;
  description: string;
  crossSheet: boolean;
};

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function yamlScalar(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function tomlScalar(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/**
 * Builds flat, human-readable rows (full path instead of raw parentId) used by every export
 * format. `allNodes` (the full graph) is used to resolve paths/sheet names even for endpoints
 * that fall outside the `nodes`/`edges` subset being exported.
 */
export function buildExportRows(
  allNodes: ImpactNode[],
  nodes: ImpactNode[],
  edges: ImpactEdge[],
  sheets: ImpactSheet[],
): { nodeRows: ExportNodeRow[]; edgeRows: ExportEdgeRow[] } {
  const pathMap = buildPathMap(allNodes);
  const allById = nodeById(allNodes);
  const sheetNameById = new Map(sheets.map((s) => [s.id, s.name]));

  function sheetNameOfNode(nodeId: string): string {
    const node = allById.get(nodeId);
    if (!node) {
      return "(不明)";
    }
    return sheetNameById.get(node.sheetId) ?? "(不明なシート)";
  }

  const nodeRows = nodes
    .map((n) => ({
      id: n.id,
      sheet: sheetNameOfNode(n.id),
      path: pathMap.get(n.id) ?? n.name,
      name: n.name,
      description: n.description,
    }))
    .sort((a, b) => (a.sheet + a.path).localeCompare(b.sheet + b.path, "ja"));
  const edgeRows = edges
    .map((e) => ({
      id: e.id,
      sourceSheet: sheetNameOfNode(e.sourceId),
      sourcePath: pathMap.get(e.sourceId) ?? e.sourceId,
      targetSheet: sheetNameOfNode(e.targetId),
      targetPath: pathMap.get(e.targetId) ?? e.targetId,
      name: e.name,
      description: e.description,
      crossSheet: allById.get(e.sourceId)?.sheetId !== allById.get(e.targetId)?.sheetId,
    }))
    .sort((a, b) =>
      (a.sourceSheet + a.sourcePath).localeCompare(b.sourceSheet + b.sourcePath, "ja")
    );
  return { nodeRows, edgeRows };
}

export function exportRowsToCsv(nodeRows: ExportNodeRow[], edgeRows: ExportEdgeRow[]): string {
  const lines = ["type,id,sheet,path,related_sheet,related_path,name,description,cross_sheet"];
  for (const r of nodeRows) {
    lines.push(
      ["node", r.id, r.sheet, r.path, "", "", r.name, r.description, ""].map(csvEscape).join(
        ",",
      ),
    );
  }
  for (const r of edgeRows) {
    lines.push(
      [
        "edge",
        r.id,
        r.sourceSheet,
        r.sourcePath,
        r.targetSheet,
        r.targetPath,
        r.name,
        r.description,
        r.crossSheet ? "true" : "false",
      ].map(csvEscape).join(","),
    );
  }
  return lines.join("\n");
}

export function exportRowsToYaml(nodeRows: ExportNodeRow[], edgeRows: ExportEdgeRow[]): string {
  const lines: string[] = ["nodes:"];
  if (nodeRows.length === 0) {
    lines.push("  []");
  }
  for (const r of nodeRows) {
    lines.push(`  - id: ${yamlScalar(r.id)}`);
    lines.push(`    sheet: ${yamlScalar(r.sheet)}`);
    lines.push(`    path: ${yamlScalar(r.path)}`);
    lines.push(`    name: ${yamlScalar(r.name)}`);
    lines.push(`    description: ${yamlScalar(r.description)}`);
  }
  lines.push("edges:");
  if (edgeRows.length === 0) {
    lines.push("  []");
  }
  for (const r of edgeRows) {
    lines.push(`  - id: ${yamlScalar(r.id)}`);
    lines.push(`    source_sheet: ${yamlScalar(r.sourceSheet)}`);
    lines.push(`    source_path: ${yamlScalar(r.sourcePath)}`);
    lines.push(`    target_sheet: ${yamlScalar(r.targetSheet)}`);
    lines.push(`    target_path: ${yamlScalar(r.targetPath)}`);
    lines.push(`    name: ${yamlScalar(r.name)}`);
    lines.push(`    description: ${yamlScalar(r.description)}`);
    lines.push(`    cross_sheet: ${r.crossSheet ? "true" : "false"}`);
  }
  return lines.join("\n") + "\n";
}

export function exportRowsToToml(nodeRows: ExportNodeRow[], edgeRows: ExportEdgeRow[]): string {
  const parts: string[] = [];
  for (const r of nodeRows) {
    parts.push(
      [
        "[[nodes]]",
        `id = ${tomlScalar(r.id)}`,
        `sheet = ${tomlScalar(r.sheet)}`,
        `path = ${tomlScalar(r.path)}`,
        `name = ${tomlScalar(r.name)}`,
        `description = ${tomlScalar(r.description)}`,
      ].join("\n"),
    );
  }
  for (const r of edgeRows) {
    parts.push(
      [
        "[[edges]]",
        `id = ${tomlScalar(r.id)}`,
        `source_sheet = ${tomlScalar(r.sourceSheet)}`,
        `source_path = ${tomlScalar(r.sourcePath)}`,
        `target_sheet = ${tomlScalar(r.targetSheet)}`,
        `target_path = ${tomlScalar(r.targetPath)}`,
        `name = ${tomlScalar(r.name)}`,
        `description = ${tomlScalar(r.description)}`,
        `cross_sheet = ${r.crossSheet ? "true" : "false"}`,
      ].join("\n"),
    );
  }
  return parts.join("\n\n") + "\n";
}

export function exportRowsToJson(nodeRows: ExportNodeRow[], edgeRows: ExportEdgeRow[]): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), nodes: nodeRows, edges: edgeRows },
    null,
    2,
  );
}

export function serializeExportRows(
  format: ExportFormat,
  nodeRows: ExportNodeRow[],
  edgeRows: ExportEdgeRow[],
): { content: string; contentType: string; extension: string } {
  switch (format) {
    case "yaml":
      return {
        content: exportRowsToYaml(nodeRows, edgeRows),
        contentType: "text/yaml;charset=utf-8",
        extension: "yaml",
      };
    case "toml":
      return {
        content: exportRowsToToml(nodeRows, edgeRows),
        contentType: "application/toml;charset=utf-8",
        extension: "toml",
      };
    case "csv":
      return {
        content: exportRowsToCsv(nodeRows, edgeRows),
        contentType: "text/csv;charset=utf-8",
        extension: "csv",
      };
    default:
      return {
        content: exportRowsToJson(nodeRows, edgeRows),
        contentType: "application/json;charset=utf-8",
        extension: "json",
      };
  }
}

/** Full-fidelity JSON (raw fields, re-importable via parseGraphImport). */
export function exportGraphJson(
  nodes: ImpactNode[],
  edges: ImpactEdge[],
  sheets: ImpactSheet[],
): string {
  return JSON.stringify(
    { version: 2, exportedAt: new Date().toISOString(), sheets, nodes, edges },
    null,
    2,
  );
}
