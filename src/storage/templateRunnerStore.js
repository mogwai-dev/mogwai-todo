import { newId } from "../domain/templateRunner.js";

const KEYS = {
  templates: "template-runner.v1.templates",
  nodes: "template-runner.v1.nodes",
  logs: "template-runner.v1.logs",
};

const MAX_LOG_ENTRIES = 200;

function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function loadTemplatesRaw() {
  return readJson(KEYS.templates, []);
}

function saveTemplates(templates) {
  writeJson(KEYS.templates, templates);
}

function loadNodesRaw() {
  return readJson(KEYS.nodes, []);
}

function saveNodesRaw(nodes) {
  writeJson(KEYS.nodes, nodes);
}

function loadLogsRaw() {
  return readJson(KEYS.logs, []);
}

function saveLogsRaw(logs) {
  writeJson(KEYS.logs, logs);
}

/** Ensures at least one template exists, creating a default one on first use. */
export function ensureDefaultTemplate() {
  const templates = loadTemplatesRaw();
  if (templates.length > 0) {
    return templates[0];
  }
  const template = {
    id: newId(),
    name: "テンプレート1",
    outputRoot: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  saveTemplates([template]);
  return template;
}

export function listTemplates() {
  return loadTemplatesRaw();
}

export function createTemplate(name) {
  const templates = loadTemplatesRaw();
  const template = {
    id: newId(),
    name: name.trim() || "無題テンプレート",
    outputRoot: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  saveTemplates([...templates, template]);
  return template;
}

export function renameTemplate(id, name) {
  const templates = loadTemplatesRaw().map((t) =>
    t.id === id ? { ...t, name: name.trim() || t.name, updatedAt: nowIso() } : t
  );
  saveTemplates(templates);
}

export function setTemplateOutputRoot(id, outputRoot) {
  const templates = loadTemplatesRaw().map((t) =>
    t.id === id ? { ...t, outputRoot, updatedAt: nowIso() } : t
  );
  saveTemplates(templates);
}

export function deleteTemplate(id) {
  saveTemplates(loadTemplatesRaw().filter((t) => t.id !== id));
  saveNodesRaw(loadNodesRaw().filter((n) => n.templateId !== id));
  saveLogsRaw(loadLogsRaw().filter((l) => l.templateId !== id));
}

export function listNodes(templateId) {
  return loadNodesRaw().filter((n) => n.templateId === templateId);
}

export function addNode(templateId, input) {
  const node = {
    id: newId(),
    templateId,
    path: input.path,
    kind: input.kind,
    folderName: "",
    properties: {},
    runScript: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  saveNodesRaw([...loadNodesRaw(), node]);
  return node;
}

export function updateNode(id, patch) {
  const nodes = loadNodesRaw().map((n) => (n.id === id ? { ...n, ...patch, updatedAt: nowIso() } : n));
  saveNodesRaw(nodes);
}

export function deleteNode(id) {
  saveNodesRaw(loadNodesRaw().filter((n) => n.id !== id));
}

export function appendLog(entry) {
  const logs = [...loadLogsRaw(), entry].slice(-MAX_LOG_ENTRIES);
  saveLogsRaw(logs);
}

export function listLogs(templateId) {
  return loadLogsRaw()
    .filter((l) => l.templateId === templateId)
    .slice()
    .reverse();
}

export function clearLogs(templateId) {
  saveLogsRaw(loadLogsRaw().filter((l) => l.templateId !== templateId));
}
