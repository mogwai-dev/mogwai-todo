// Template Runner domain logic.
//
// Models a folder/file "template" as a graph of nodes (folder or file) with
// per-node key/value properties and a run-script command. A node's `path`
// encodes its place in the real folder hierarchy (its parent directory is
// derived from the path itself), which gives us "structural" edges for free.
// Property values and run scripts may reference another node's *resolved*
// properties via `node('<path>')`; every such reference is captured as a
// separate "property" dependency edge.
//
// This module is intentionally free of DOM/Tauri/eval concerns: expression
// evaluation (the `${...}` sandbox) and all filesystem/process execution live
// in app/templateRunner.js and the Rust backend, respectively. Pure logic
// here (path handling, dependency graph, topological ordering) stays easy to
// reason about and test.
//
// Keep this file in sync with templateRunner.ts (no build step converts one
// to the other).

export function newId() {
  return crypto.randomUUID();
}

/** Normalizes a user-entered path to forward slashes with no leading/trailing/duplicate separators. */
export function normalizePath(path) {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
}

export function pathSegments(path) {
  const normalized = normalizePath(path);
  return normalized ? normalized.split("/") : [];
}

export function pathDepth(path) {
  return pathSegments(path).length;
}

export function lastSegment(path) {
  const segments = pathSegments(path);
  return segments.length > 0 ? segments[segments.length - 1] : "";
}

/** Parent directory path, or null for a top-level node. */
export function parentPath(path) {
  const segments = pathSegments(path);
  if (segments.length <= 1) {
    return null;
  }
  return segments.slice(0, -1).join("/");
}

export function nodesByPath(nodes) {
  return new Map(nodes.map((n) => [normalizePath(n.path), n]));
}

export function nodesById(nodes) {
  return new Map(nodes.map((n) => [n.id, n]));
}

/** Parent -> child edges derived purely from path hierarchy (only when the parent path exists as a node too). */
export function buildStructuralEdges(nodes) {
  const byPath = nodesByPath(nodes);
  const edges = [];
  for (const node of nodes) {
    const parent = parentPath(node.path);
    if (parent === null) {
      continue;
    }
    const parentNode = byPath.get(parent);
    if (parentNode) {
      edges.push({ fromId: parentNode.id, toId: node.id, kind: "structural" });
    }
  }
  return edges;
}

const REFERENCE_RE = /node\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Extracts every `node('<path>')` reference path mentioned in a text blob. */
export function extractReferences(text) {
  const found = new Set();
  for (const match of text.matchAll(REFERENCE_RE)) {
    found.add(normalizePath(match[1]));
  }
  return [...found];
}

/** Edges for every `node('other/path')` reference found in a node's properties or run script. */
export function buildPropertyEdges(nodes) {
  const byPath = nodesByPath(nodes);
  const edges = [];
  for (const node of nodes) {
    const refs = new Set();
    for (const text of [...Object.values(node.properties), node.runScript]) {
      for (const ref of extractReferences(text ?? "")) {
        refs.add(ref);
      }
    }
    for (const ref of refs) {
      const target = byPath.get(ref);
      if (target && target.id !== node.id) {
        edges.push({ fromId: target.id, toId: node.id, kind: "property" });
      }
    }
  }
  return edges;
}

/** Kahn's algorithm; ties break by the order `nodeIds` were given in. */
export function topologicalOrder(nodeIds, edges) {
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const adjacency = new Map(nodeIds.map((id) => [id, []]));
  for (const edge of edges) {
    if (!adjacency.has(edge.fromId) || !indegree.has(edge.toId)) {
      continue;
    }
    adjacency.get(edge.fromId).push(edge.toId);
    indegree.set(edge.toId, (indegree.get(edge.toId) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) {
        queue.push(next);
      }
    }
  }

  if (order.length !== nodeIds.length) {
    const cycle = nodeIds.filter((id) => (indegree.get(id) ?? 0) > 0);
    return { ok: false, cycle };
  }
  return { ok: true, order };
}

/**
 * All property-dependency ancestors of `targetId` (transitively), in
 * topological order, with `targetId` itself last. Used to resolve just
 * enough property values to evaluate a single node without running anything.
 */
export function propertyResolutionOrder(nodeIds, propertyEdges, targetId) {
  const incoming = new Map();
  for (const edge of propertyEdges) {
    incoming.set(edge.toId, [...(incoming.get(edge.toId) ?? []), edge.fromId]);
  }

  const needed = new Set();
  const stack = [targetId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (needed.has(id)) {
      continue;
    }
    needed.add(id);
    for (const dep of incoming.get(id) ?? []) {
      stack.push(dep);
    }
  }

  const scopedEdges = propertyEdges.filter((e) => needed.has(e.fromId) && needed.has(e.toId));
  return topologicalOrder([...needed], scopedEdges);
}

/** Combined structural + property order for a full "run everything" pass. */
export function fullExecutionOrder(nodes) {
  const ids = nodes.map((n) => n.id);
  const edges = [...buildStructuralEdges(nodes), ...buildPropertyEdges(nodes)];
  return topologicalOrder(ids, edges);
}

/** Resolves every property of `node` by running each raw value through `evaluate`. */
export function resolveProperties(node, resolved, byPath, evaluate) {
  const accessor = (path) => {
    const target = byPath.get(normalizePath(path));
    return target ? resolved.get(target.id) : undefined;
  };
  const result = {};
  for (const [key, raw] of Object.entries(node.properties)) {
    result[key] = evaluate(raw ?? "", accessor);
  }
  return result;
}

/** Resolves a node's run-script text (which may itself contain `node(...)` references). */
export function resolveRunScript(node, resolved, byPath, evaluate) {
  const accessor = (path) => {
    const target = byPath.get(normalizePath(path));
    return target ? resolved.get(target.id) : undefined;
  };
  return evaluate(node.runScript ?? "", accessor);
}

/**
 * Resolves a folder node's on-disk directory name. Uses `node.folderName` as
 * a template (evaluated with the same `node('<path>')` accessor as
 * properties/run scripts, plus a `self` argument bound to the node's own
 * already-resolved properties), falling back to the path's last segment when
 * `folderName` is blank or evaluates to blank. File nodes always resolve to
 * their path's last segment (no custom naming).
 */
export function resolveFolderName(node, resolvedProperties, byPath, evaluate) {
  const fallback = lastSegment(node.path) || node.path;
  if (node.kind !== "folder") {
    return fallback;
  }
  const raw = (node.folderName ?? "").trim();
  const template = raw || fallback;
  const accessor = (path) => {
    const target = byPath.get(normalizePath(path));
    return target ? resolvedProperties.get(target.id) : undefined;
  };
  const self = resolvedProperties.get(node.id) ?? {};
  const evaluated = evaluate(template, accessor, self).trim();
  return evaluated || fallback;
}

/** Resolved on-disk directory name for every folder node in `nodes`. */
export function resolveAllFolderNames(nodes, resolvedProperties, byPath, evaluate) {
  const names = new Map();
  for (const node of nodes) {
    if (node.kind === "folder") {
      names.set(node.id, resolveFolderName(node, resolvedProperties, byPath, evaluate));
    }
  }
  return names;
}

/** Resolves each path segment of `node.path` to its on-disk name, substituting any ancestor folder's custom `folderName`. */
function resolvedSegments(node, byPath, resolvedFolderNames) {
  const segments = pathSegments(node.path);
  const result = [];
  let acc = "";
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment;
    const ancestor = byPath.get(acc);
    const name = ancestor && ancestor.kind === "folder" ? (resolvedFolderNames.get(ancestor.id) ?? segment) : segment;
    result.push(name);
  }
  return result;
}

/** Absolute on-disk path for `node`, honoring any custom `folderName` set on it or its ancestors. */
export function resolveAbsolutePathForNode(node, byPath, resolvedFolderNames, outputRoot) {
  const root = outputRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  const segments = resolvedSegments(node, byPath, resolvedFolderNames);
  return segments.length ? `${root}/${segments.join("/")}` : root;
}

/** Working directory to run a node's script in: the node itself for folders, its parent for files (both honoring custom folder names). */
export function resolveCwdForNode(node, byPath, resolvedFolderNames, outputRoot) {
  const root = outputRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  const segments = resolvedSegments(node, byPath, resolvedFolderNames);
  const dirSegments = node.kind === "folder" ? segments : segments.slice(0, -1);
  return dirSegments.length ? `${root}/${dirSegments.join("/")}` : root;
}

export function buildYamlPayload(node, resolvedProperties, outputRoot, absolutePath, folderName) {
  return {
    id: node.id,
    path: node.path,
    kind: node.kind,
    outputRoot: outputRoot ?? "",
    absolutePath,
    folderName: node.kind === "folder" ? (folderName ?? null) : null,
    properties: resolvedProperties,
  };
}

/** DFS tree order (roots and siblings sorted by their last path segment) for rendering a file-tree-like layout. */
export function orderedNodesForTree(nodes) {
  const childrenByParentKey = new Map();
  for (const node of nodes) {
    const key = parentPath(node.path) ?? "";
    childrenByParentKey.set(key, [...(childrenByParentKey.get(key) ?? []), node]);
  }
  for (const list of childrenByParentKey.values()) {
    list.sort((a, b) => lastSegment(a.path).localeCompare(lastSegment(b.path), "ja"));
  }

  const result = [];
  const visit = (key) => {
    for (const child of childrenByParentKey.get(key) ?? []) {
      result.push(child);
      visit(normalizePath(child.path));
    }
  };
  visit("");

  const visited = new Set(result.map((n) => n.id));
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      result.push(node);
    }
  }
  return result;
}
