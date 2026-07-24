import {
  buildPropertyEdges,
  buildStructuralEdges,
  buildYamlPayload,
  fullExecutionOrder,
  lastSegment,
  newId,
  nodesById,
  nodesByPath,
  normalizePath,
  parentPath,
  pathDepth,
  resolveAbsolutePathForNode,
  resolveAllFolderNames,
  resolveCwdForNode,
  resolveProperties,
  resolveRunScript,
  topologicalOrder,
  orderedNodesForTree,
} from "/src/domain/templateRunner.js";
import {
  addNode,
  appendLog,
  clearLogs,
  createTemplate,
  deleteNode,
  deleteTemplate,
  ensureDefaultTemplate,
  listLogs,
  listNodes,
  listTemplates,
  renameTemplate,
  setTemplateOutputRoot,
  updateNode,
} from "/src/storage/templateRunnerStore.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const EDITOR_TABS = ["node", "run", "log"];
const NODE_HEIGHT = 36;
const NODE_MIN_WIDTH = 90;
const NODE_MAX_WIDTH = 220;
const NODE_CHAR_WIDTH = 13;
const NODE_PADDING_X = 24;
const ROW_HEIGHT = 46;
const INDENT = 150;
const MARGIN_X = 30;
const MARGIN_Y = 26;

let refs = null;

const state = {
  templates: [],
  activeTemplateId: null,
  nodes: [],
  selectedNodeId: null,
  editingNodeId: null,
  propertyDraft: [],
};

function q(id) {
  return document.querySelector(`#${id}`);
}

function invoke(cmd, args) {
  const tauri = globalThis.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== "function") {
    return Promise.reject(new Error("Tauri APIが利用できません（デスクトップアプリ上でのみ実行できます）。"));
  }
  return tauri.core.invoke(cmd, args);
}

function setRunStatus(message = "") {
  refs.runStatus.textContent = message;
}

/**
 * Evaluates `${...}` expressions in a template string. Two accessors are
 * injected — `node(path)` for another node's resolved properties, and `self`
 * (an object) for the current node's own already-resolved properties. There
 * is no true sandboxing beyond that, so this is meant for scripts the user
 * themselves authored (a local automation tool), not for evaluating
 * untrusted input.
 */
function evaluateTemplate(raw, accessor, self = {}) {
  if (!raw) {
    return "";
  }
  return raw.replace(/\$\{([^}]*)\}/g, (_, expr) => {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function("node", "self", `"use strict"; return (${expr});`);
      const value = fn(accessor, self);
      return value === undefined || value === null ? "" : String(value);
    } catch (err) {
      return `#ERROR:${err.message}#`;
    }
  });
}

function currentTemplate() {
  return state.templates.find((t) => t.id === state.activeTemplateId) ?? null;
}

function currentSelectedNode() {
  return state.nodes.find((n) => n.id === state.selectedNodeId) ?? null;
}

function fitNodeLabel(name) {
  const maxChars = Math.max(1, Math.floor((NODE_MAX_WIDTH - NODE_PADDING_X) / NODE_CHAR_WIDTH));
  if (name.length <= maxChars) {
    return name;
  }
  return `${name.slice(0, Math.max(1, maxChars - 1))}…`;
}

function nodeBoxWidth(label) {
  const width = label.length * NODE_CHAR_WIDTH + NODE_PADDING_X;
  return Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, width));
}

function boxBoundaryPoint(center, halfW, halfH, dx, dy) {
  if (dx === 0 && dy === 0) {
    return center;
  }
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

function drawEdge(svg, from, to, className) {
  if (!from || !to) {
    return;
  }
  const c1 = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const c2 = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const start = boxBoundaryPoint(c1, from.w / 2, from.h / 2, dx, dy);
  const end = boxBoundaryPoint(c2, to.w / 2, to.h / 2, -dx, -dy);

  svg.appendChild(svgEl("line", { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: className }));

  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const size = 7;
  const p1 = { x: end.x - size * Math.cos(angle - Math.PI / 6), y: end.y - size * Math.sin(angle - Math.PI / 6) };
  const p2 = { x: end.x - size * Math.cos(angle + Math.PI / 6), y: end.y - size * Math.sin(angle + Math.PI / 6) };
  svg.appendChild(
    svgEl("polygon", { points: `${end.x},${end.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`, class: `${className}-arrow` }),
  );
}

function drawNode(svg, node, pos) {
  const classes = [
    "template-node",
    `template-node-${node.kind}`,
    node.id === state.selectedNodeId ? "selected" : "",
  ].filter(Boolean).join(" ");

  const group = svgEl("g", { class: classes, transform: `translate(${pos.x}, ${pos.y})` });
  group.style.cursor = "pointer";

  group.appendChild(svgEl("rect", { width: pos.w, height: pos.h, rx: 6 }));

  const label = svgEl("text", { x: pos.w / 2, y: pos.h / 2 + 4, "text-anchor": "middle" });
  label.textContent = `${node.kind === "folder" ? "📁" : "📄"} ${fitNodeLabel(lastSegment(node.path) || node.path)}`;
  group.appendChild(label);

  const titleEl = svgEl("title");
  titleEl.textContent = node.path;
  group.appendChild(titleEl);

  group.addEventListener("click", () => selectNode(node.id));
  svg.appendChild(group);
}

function renderCanvas() {
  const svg = refs.svg;
  svg.innerHTML = "";

  const ordered = orderedNodesForTree(state.nodes);
  const positions = new Map();
  ordered.forEach((node, index) => {
    const depth = Math.max(0, pathDepth(node.path) - 1);
    const x = MARGIN_X + depth * INDENT;
    const y = MARGIN_Y + index * ROW_HEIGHT;
    const w = nodeBoxWidth(fitNodeLabel(lastSegment(node.path) || node.path));
    positions.set(node.id, { x, y, w, h: NODE_HEIGHT });
  });

  for (const edge of buildStructuralEdges(state.nodes)) {
    drawEdge(svg, positions.get(edge.fromId), positions.get(edge.toId), "template-edge-structural");
  }
  for (const edge of buildPropertyEdges(state.nodes)) {
    drawEdge(svg, positions.get(edge.fromId), positions.get(edge.toId), "template-edge-property");
  }
  for (const node of ordered) {
    drawNode(svg, node, positions.get(node.id));
  }

  const height = Math.max(360, MARGIN_Y * 2 + ordered.length * ROW_HEIGHT);
  svg.setAttribute("viewBox", `0 0 1400 ${height}`);
}

function renderTemplateSelect() {
  refs.templateSelect.innerHTML = "";
  for (const t of state.templates) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    opt.selected = t.id === state.activeTemplateId;
    refs.templateSelect.appendChild(opt);
  }
}

function renderOutputRoot() {
  const template = currentTemplate();
  refs.outputRootPath.textContent = template?.outputRoot || "未設定";
}

function renderNodeList() {
  refs.nodeList.innerHTML = "";
  const ordered = orderedNodesForTree(state.nodes);
  for (const node of ordered) {
    const depth = Math.max(0, pathDepth(node.path) - 1);
    const li = document.createElement("li");
    li.className = "impact-item";

    const main = document.createElement("div");
    main.className = "impact-item-main";

    const label = document.createElement("button");
    label.type = "button";
    label.className = "impact-item-label";
    label.style.paddingLeft = `${4 + depth * 14}px`;
    label.textContent = `${node.kind === "folder" ? "📁" : "📄"} ${lastSegment(node.path) || node.path}`;
    label.addEventListener("click", () => selectNode(node.id));

    main.appendChild(label);
    li.appendChild(main);
    refs.nodeList.appendChild(li);
  }
}

function renderPropertyRows() {
  refs.propertiesContainer.innerHTML = "";
  state.propertyDraft.forEach((row, index) => {
    const rowEl = document.createElement("div");
    rowEl.className = "template-property-row";

    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.placeholder = "キー";
    keyInput.value = row.key;
    keyInput.addEventListener("input", () => {
      state.propertyDraft[index].key = keyInput.value;
    });

    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.placeholder = "値（${node('他のパス').キー} で参照可）";
    valueInput.value = row.value;
    valueInput.addEventListener("input", () => {
      state.propertyDraft[index].value = valueInput.value;
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "outline";
    removeBtn.textContent = "削除";
    removeBtn.addEventListener("click", () => {
      state.propertyDraft.splice(index, 1);
      renderPropertyRows();
    });

    rowEl.append(keyInput, valueInput, removeBtn);
    refs.propertiesContainer.appendChild(rowEl);
  });
}

function loadNodeIntoForm(node) {
  state.editingNodeId = node.id;
  refs.nodePath.value = node.path;
  refs.nodeKind.value = node.kind;
  refs.nodeFolderName.value = node.folderName ?? "";
  refs.nodeRunScript.value = node.runScript;
  state.propertyDraft = Object.entries(node.properties).map(([key, value]) => ({ key, value }));
  renderPropertyRows();
  updateFolderNameVisibility();
}

function clearForm() {
  state.editingNodeId = null;
  refs.nodePath.value = "";
  refs.nodeKind.value = "folder";
  refs.nodeFolderName.value = "";
  refs.nodeRunScript.value = "";
  state.propertyDraft = [];
  renderPropertyRows();
  updateFolderNameVisibility();
}

function updateFolderNameVisibility() {
  refs.nodeFolderNameWrap.style.display = refs.nodeKind.value === "folder" ? "" : "none";
}

function collectPropertiesFromDraft() {
  const properties = {};
  for (const row of state.propertyDraft) {
    const key = row.key.trim();
    if (key) {
      properties[key] = row.value ?? "";
    }
  }
  return properties;
}

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  const node = state.nodes.find((n) => n.id === nodeId);
  if (node) {
    loadNodeIntoForm(node);
  }
  setEditorTab("node");
  renderAll();
  refreshYamlPreview();
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

/**
 * Resolves every node's properties (in property-dependency topological
 * order) and, from that, every folder node's on-disk folder name. Folder
 * names never affect property-resolution order themselves — they're
 * computed only after all properties are known — so this two-phase
 * approach can't introduce spurious cycles from folder-name references.
 */
function computeResolvedAll() {
  const byId = nodesById(state.nodes);
  const byPath = nodesByPath(state.nodes);
  const propertyEdges = buildPropertyEdges(state.nodes);
  const order = topologicalOrder(state.nodes.map((n) => n.id), propertyEdges);
  if (!order.ok) {
    throw new Error(`プロパティ参照が循環しています: ${order.cycle.join(", ")}`);
  }
  const resolvedProperties = new Map();
  for (const id of order.order) {
    const node = byId.get(id);
    if (!node) {
      continue;
    }
    resolvedProperties.set(id, resolveProperties(node, resolvedProperties, byPath, evaluateTemplate));
  }
  const resolvedFolderNames = resolveAllFolderNames(state.nodes, resolvedProperties, byPath, evaluateTemplate);
  return { byPath, resolvedProperties, resolvedFolderNames };
}

// ---------------------------------------------------------------------------
// Text export (Taskfile / Makefile) - for later diff/comparison in Git, not
// necessarily meant to be run as-is (see the "?" help text next to the
// export buttons for caveats).
// ---------------------------------------------------------------------------

/** Every node's direct dependency node-ids (structural parent + property references), keyed by node id. */
function buildDependencyMap(nodes) {
  const byId = nodesById(nodes);
  const edges = [...buildStructuralEdges(nodes), ...buildPropertyEdges(nodes)];
  const deps = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const edge of edges) {
    if (deps.has(edge.toId) && byId.has(edge.fromId)) {
      deps.get(edge.toId).add(edge.fromId);
    }
  }
  return deps;
}

function requireExportableTemplate() {
  const template = currentTemplate();
  if (!template) {
    throw new Error("テンプレートが選択されていません。");
  }
  if (!template.outputRoot) {
    throw new Error("先に出力先フォルダを選択してください。");
  }
  return template;
}

async function buildTaskfileText() {
  const template = requireExportableTemplate();
  const { byPath, resolvedProperties, resolvedFolderNames } = computeResolvedAll();
  const depsMap = buildDependencyMap(state.nodes);
  const byId = nodesById(state.nodes);
  const tasks = {};
  for (const node of orderedNodesForTree(state.nodes)) {
    const cwd = resolveCwdForNode(node, byPath, resolvedFolderNames, template.outputRoot);
    const command = resolveRunScript(node, resolvedProperties, byPath, evaluateTemplate).trim();
    const deps = [...(depsMap.get(node.id) ?? [])]
      .map((id) => byId.get(id)?.path)
      .filter((path) => Boolean(path))
      .sort((a, b) => a.localeCompare(b, "ja"));
    tasks[node.path] = {
      dir: cwd,
      ...(deps.length ? { deps } : {}),
      cmds: [command || `echo "(no run script) ${node.path}"`],
    };
  }
  return await invoke("tr_render_yaml", { value: { version: "3", tasks } });
}

/** Escapes a node path for use as a Make target/prerequisite name (spaces would otherwise split it into multiple targets). */
function sanitizeMakeTarget(path) {
  return path.replaceAll(" ", "\\ ");
}

function buildMakefileText() {
  const template = requireExportableTemplate();
  const { byPath, resolvedProperties, resolvedFolderNames } = computeResolvedAll();
  const depsMap = buildDependencyMap(state.nodes);
  const byId = nodesById(state.nodes);
  const ordered = orderedNodesForTree(state.nodes);

  const lines = [
    "# Auto-generated by Template Runner - for text diff/comparison, not guaranteed runnable as-is.",
    "# Node paths are used as .PHONY targets (they are not real Make file-timestamp targets).",
    `.PHONY: ${ordered.map((n) => sanitizeMakeTarget(n.path)).join(" ")}`,
    "",
  ];
  for (const node of ordered) {
    const cwd = resolveCwdForNode(node, byPath, resolvedFolderNames, template.outputRoot);
    const command = resolveRunScript(node, resolvedProperties, byPath, evaluateTemplate).trim();
    const deps = [...(depsMap.get(node.id) ?? [])]
      .map((id) => byId.get(id)?.path)
      .filter((path) => Boolean(path))
      .sort((a, b) => a.localeCompare(b, "ja"))
      .map(sanitizeMakeTarget);
    lines.push(`${sanitizeMakeTarget(node.path)}:${deps.length ? ` ${deps.join(" ")}` : ""}`);
    lines.push(command ? `\tcd "${cwd}" && ${command}` : `\t@echo "(no run script) ${node.path}"`);
    lines.push("");
  }
  return lines.join("\n");
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

async function handleExportTaskfile() {
  try {
    const text = await buildTaskfileText();
    triggerDownload("Taskfile.yml", text, "text/yaml");
    setRunStatus("Taskfileを書き出しました。");
  } catch (err) {
    setRunStatus(`❌ ${err.message}`);
  }
}

function handleExportMakefile() {
  try {
    const text = buildMakefileText();
    triggerDownload("Makefile", text, "text/plain");
    setRunStatus("Makefile（比較用）を書き出しました。");
  } catch (err) {
    setRunStatus(`❌ ${err.message}`);
  }
}

async function refreshYamlPreview() {
  const node = currentSelectedNode();
  refs.runNodeLabel.textContent = node ? node.path : "-";
  if (!node) {
    refs.yamlPreview.textContent = "";
    return;
  }
  try {
    const { byPath, resolvedProperties, resolvedFolderNames } = computeResolvedAll();
    const template = currentTemplate();
    const outputRoot = template?.outputRoot ?? null;
    const absolutePath = outputRoot
      ? resolveAbsolutePathForNode(node, byPath, resolvedFolderNames, outputRoot)
      : node.path;
    const payload = buildYamlPayload(
      node,
      resolvedProperties.get(node.id) ?? {},
      outputRoot,
      absolutePath,
      resolvedFolderNames.get(node.id) ?? null,
    );
    const yamlText = await invoke("tr_render_yaml", { value: payload });
    refs.yamlPreview.textContent = yamlText;
  } catch (err) {
    refs.yamlPreview.textContent = `エラー: ${err.message}`;
  }
}

function renderLogList() {
  const template = currentTemplate();
  refs.logList.innerHTML = "";
  if (!template) {
    return;
  }
  for (const entry of listLogs(template.id)) {
    const li = document.createElement("li");
    li.className = `template-log-item ${entry.ok ? "ok" : "error"}`;
    const head = document.createElement("div");
    head.className = "template-log-head";
    head.textContent = `${entry.ok ? "✅" : "❌"} ${entry.nodePath} (code: ${entry.exitCode ?? "-"})`;
    const meta = document.createElement("div");
    meta.className = "muted template-log-meta";
    meta.textContent = `${entry.startedAt} — ${entry.command || "(スキップ: ランスクリプト未設定)"}`;
    li.appendChild(head);
    li.appendChild(meta);
    if (entry.stdout) {
      const stdout = document.createElement("pre");
      stdout.className = "template-log-output";
      stdout.textContent = entry.stdout;
      li.appendChild(stdout);
    }
    if (entry.stderr) {
      const stderr = document.createElement("pre");
      stderr.className = "template-log-output template-log-output-error";
      stderr.textContent = entry.stderr;
      li.appendChild(stderr);
    }
    refs.logList.appendChild(li);
  }
}

async function runNode(nodeId) {
  const template = currentTemplate();
  if (!template || !template.outputRoot) {
    setRunStatus("先に出力先フォルダを選択してください。");
    return;
  }
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return;
  }

  let byPath;
  let resolvedProperties;
  let resolvedFolderNames;
  try {
    ({ byPath, resolvedProperties, resolvedFolderNames } = computeResolvedAll());
  } catch (err) {
    setRunStatus(`❌ ${err.message}`);
    return;
  }
  const command = resolveRunScript(node, resolvedProperties, byPath, evaluateTemplate).trim();
  const startedAt = new Date().toISOString();

  if (!command) {
    appendLog({
      id: newId(),
      templateId: template.id,
      nodeId: node.id,
      nodePath: node.path,
      command: "",
      ok: true,
      exitCode: null,
      stdout: "",
      stderr: "",
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    renderLogList();
    return;
  }

  const props = resolvedProperties.get(node.id) ?? {};
  const absPath = resolveAbsolutePathForNode(node, byPath, resolvedFolderNames, template.outputRoot);
  const cwd = resolveCwdForNode(node, byPath, resolvedFolderNames, template.outputRoot);
  const payload = buildYamlPayload(node, props, template.outputRoot, absPath, resolvedFolderNames.get(node.id) ?? null);

  try {
    const yamlText = await invoke("tr_render_yaml", { value: payload });
    const yamlPath = `${cwd}/.template-runner/${node.id}.yaml`;
    await invoke("tr_write_text_file", { path: yamlPath, contents: yamlText });

    const env = {
      TR_NODE_ID: node.id,
      TR_NODE_PATH: node.path,
      TR_NODE_KIND: node.kind,
      TR_NODE_ABS_PATH: absPath,
      TR_NODE_FOLDER_NAME: node.kind === "folder" ? (resolvedFolderNames.get(node.id) ?? "") : "",
      TR_OUTPUT_ROOT: template.outputRoot,
      TR_PROPS_YAML_PATH: yamlPath,
    };
    const result = await invoke("tr_run_script", { cwd, command, env });
    appendLog({
      id: newId(),
      templateId: template.id,
      nodeId: node.id,
      nodePath: node.path,
      command,
      ok: result.ok,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    setRunStatus(
      result.ok ? `✅ ${node.path} を実行しました。` : `❌ ${node.path} の実行に失敗しました（code ${result.exitCode}）。`,
    );
  } catch (err) {
    appendLog({
      id: newId(),
      templateId: template.id,
      nodeId: node.id,
      nodePath: node.path,
      command,
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: String(err.message ?? err),
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    setRunStatus(`❌ ${node.path} の実行でエラー: ${err.message}`);
  }
  renderLogList();
}

async function runAll() {
  const order = fullExecutionOrder(state.nodes);
  if (!order.ok) {
    setRunStatus("依存関係が循環しています。全体実行できません。");
    return;
  }
  setRunStatus("全体実行中…");
  for (const id of order.order) {
    await runNode(id);
  }
  setRunStatus("全体実行が完了しました。");
}

function loadNodes() {
  state.nodes = state.activeTemplateId ? listNodes(state.activeTemplateId) : [];
  if (!state.nodes.some((n) => n.id === state.selectedNodeId)) {
    state.selectedNodeId = null;
  }
}

function renderAll() {
  renderTemplateSelect();
  renderOutputRoot();
  renderCanvas();
  renderNodeList();
  renderLogList();
  refreshYamlPreview();
}

function bindEvents() {
  for (const name of EDITOR_TABS) {
    refs.editorTabs[name].addEventListener("click", () => setEditorTab(name));
  }

  refs.editorToggle.addEventListener("click", () => {
    setEditorCollapsed(!refs.editorContainer.classList.contains("collapsed"));
  });

  refs.templateSelect.addEventListener("change", () => {
    state.activeTemplateId = refs.templateSelect.value;
    clearForm();
    loadNodes();
    renderAll();
  });

  refs.templateAdd.addEventListener("click", () => {
    const name = refs.templateNameInput.value.trim();
    if (!name) {
      setRunStatus("テンプレート名を入力してください。");
      return;
    }
    const template = createTemplate(name);
    refs.templateNameInput.value = "";
    state.templates = listTemplates();
    state.activeTemplateId = template.id;
    clearForm();
    loadNodes();
    renderAll();
  });

  refs.templateRename.addEventListener("click", () => {
    const name = refs.templateNameInput.value.trim();
    if (!name || !state.activeTemplateId) {
      return;
    }
    renameTemplate(state.activeTemplateId, name);
    refs.templateNameInput.value = "";
    state.templates = listTemplates();
    renderAll();
  });

  refs.templateDelete.addEventListener("click", () => {
    if (!state.activeTemplateId) {
      return;
    }
    if (state.templates.length <= 1) {
      setRunStatus("最後のテンプレートは削除できません。");
      return;
    }
    deleteTemplate(state.activeTemplateId);
    state.templates = listTemplates();
    state.activeTemplateId = state.templates[0]?.id ?? null;
    clearForm();
    loadNodes();
    renderAll();
  });

  refs.pickRootBtn.addEventListener("click", async () => {
    if (!state.activeTemplateId) {
      return;
    }
    try {
      const picked = await invoke("tr_pick_folder");
      if (picked) {
        setTemplateOutputRoot(state.activeTemplateId, picked);
        state.templates = listTemplates();
        renderAll();
      }
    } catch (err) {
      setRunStatus(`フォルダ選択でエラー: ${err.message}`);
    }
  });

  refs.propertyAdd.addEventListener("click", () => {
    state.propertyDraft.push({ key: "", value: "" });
    renderPropertyRows();
  });

  refs.nodeKind.addEventListener("change", () => {
    updateFolderNameVisibility();
  });

  refs.nodeSave.addEventListener("click", () => {
    if (!state.activeTemplateId) {
      setRunStatus("テンプレートを選択してください。");
      return;
    }
    const path = normalizePath(refs.nodePath.value);
    if (!path) {
      setRunStatus("パスを入力してください。");
      return;
    }
    const kind = refs.nodeKind.value === "file" ? "file" : "folder";
    const folderName = kind === "folder" ? refs.nodeFolderName.value : "";
    const properties = collectPropertiesFromDraft();
    const runScript = refs.nodeRunScript.value;

    if (state.editingNodeId) {
      updateNode(state.editingNodeId, { path, kind, folderName, properties, runScript });
      state.selectedNodeId = state.editingNodeId;
    } else {
      const created = addNode(state.activeTemplateId, { path, kind });
      updateNode(created.id, { folderName, properties, runScript });
      state.editingNodeId = created.id;
      state.selectedNodeId = created.id;
    }
    loadNodes();
    renderAll();
    setRunStatus("保存しました。");
  });

  refs.nodeDelete.addEventListener("click", () => {
    if (!state.editingNodeId) {
      return;
    }
    deleteNode(state.editingNodeId);
    clearForm();
    loadNodes();
    renderAll();
  });

  refs.nodeCancel.addEventListener("click", () => {
    clearForm();
    renderCanvas();
  });

  refs.runNodeBtn.addEventListener("click", async () => {
    const node = currentSelectedNode();
    if (!node) {
      setRunStatus("ノードを選択してください。");
      return;
    }
    await runNode(node.id);
    renderAll();
  });

  refs.runAllBtn.addEventListener("click", async () => {
    await runAll();
    renderAll();
  });

  refs.exportTaskfile.addEventListener("click", handleExportTaskfile);
  refs.exportMakefile.addEventListener("click", handleExportMakefile);

  refs.logClear.addEventListener("click", () => {
    if (!state.activeTemplateId) {
      return;
    }
    clearLogs(state.activeTemplateId);
    renderLogList();
  });
}

export function initTemplateRunner() {
  refs = {
    templateSelect: q("template-select"),
    templateNameInput: q("template-name-input"),
    templateAdd: q("template-add"),
    templateRename: q("template-rename"),
    templateDelete: q("template-delete"),
    outputRootPath: q("template-output-root-path"),
    pickRootBtn: q("template-pick-root"),
    svg: q("template-svg"),
    editorContainer: q("template-editor"),
    editorToggle: q("template-editor-toggle"),
    editorTabs: {
      node: q("template-editor-tab-node"),
      run: q("template-editor-tab-run"),
      log: q("template-editor-tab-log"),
    },
    editorPanels: {
      node: q("template-editor-panel-node"),
      run: q("template-editor-panel-run"),
      log: q("template-editor-panel-log"),
    },
    nodePath: q("template-node-path"),
    nodeKind: q("template-node-kind"),
    nodeFolderNameWrap: q("template-node-folder-name-wrap"),
    nodeFolderName: q("template-node-folder-name"),
    propertiesContainer: q("template-node-properties"),
    propertyAdd: q("template-node-property-add"),
    nodeRunScript: q("template-node-run-script"),
    nodeSave: q("template-node-save"),
    nodeDelete: q("template-node-delete"),
    nodeCancel: q("template-node-cancel"),
    nodeList: q("template-node-list"),
    runNodeLabel: q("template-run-node-label"),
    runNodeBtn: q("template-run-node"),
    runAllBtn: q("template-run-all"),
    exportTaskfile: q("template-export-taskfile"),
    exportMakefile: q("template-export-makefile"),
    yamlPreview: q("template-yaml-preview"),
    runStatus: q("template-run-status"),
    logList: q("template-log-list"),
    logClear: q("template-log-clear"),
  };

  bindEvents();

  const template = ensureDefaultTemplate();
  state.templates = listTemplates();
  state.activeTemplateId = template.id;
  clearForm();
  loadNodes();
  renderAll();
}
