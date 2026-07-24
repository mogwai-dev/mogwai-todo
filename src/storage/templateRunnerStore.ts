import { newId, type ExecutionLogEntry, type Template, type TemplateNode } from "../domain/templateRunner.ts";

const KEYS = {
  templates: "template-runner.v1.templates",
  nodes: "template-runner.v1.nodes",
  logs: "template-runner.v1.logs",
};

const MAX_LOG_ENTRIES = 200;

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function loadTemplatesRaw(): Template[] {
  return readJson<Template[]>(KEYS.templates, []);
}

function saveTemplates(templates: Template[]): void {
  writeJson(KEYS.templates, templates);
}

function loadNodesRaw(): TemplateNode[] {
  return readJson<TemplateNode[]>(KEYS.nodes, []);
}

function saveNodesRaw(nodes: TemplateNode[]): void {
  writeJson(KEYS.nodes, nodes);
}

function loadLogsRaw(): ExecutionLogEntry[] {
  return readJson<ExecutionLogEntry[]>(KEYS.logs, []);
}

function saveLogsRaw(logs: ExecutionLogEntry[]): void {
  writeJson(KEYS.logs, logs);
}

/** Ensures at least one template exists, creating a default one on first use. */
export function ensureDefaultTemplate(): Template {
  const templates = loadTemplatesRaw();
  if (templates.length > 0) {
    return templates[0];
  }
  const template: Template = {
    id: newId(),
    name: "テンプレート1",
    outputRoot: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  saveTemplates([template]);
  return template;
}

export function listTemplates(): Template[] {
  return loadTemplatesRaw();
}

export function createTemplate(name: string): Template {
  const templates = loadTemplatesRaw();
  const template: Template = {
    id: newId(),
    name: name.trim() || "無題テンプレート",
    outputRoot: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  saveTemplates([...templates, template]);
  return template;
}

export function renameTemplate(id: string, name: string): void {
  const templates = loadTemplatesRaw().map((t) =>
    t.id === id ? { ...t, name: name.trim() || t.name, updatedAt: nowIso() } : t
  );
  saveTemplates(templates);
}

export function setTemplateOutputRoot(id: string, outputRoot: string | null): void {
  const templates = loadTemplatesRaw().map((t) =>
    t.id === id ? { ...t, outputRoot, updatedAt: nowIso() } : t
  );
  saveTemplates(templates);
}

export function deleteTemplate(id: string): void {
  saveTemplates(loadTemplatesRaw().filter((t) => t.id !== id));
  saveNodesRaw(loadNodesRaw().filter((n) => n.templateId !== id));
  saveLogsRaw(loadLogsRaw().filter((l) => l.templateId !== id));
}

export function listNodes(templateId: string): TemplateNode[] {
  return loadNodesRaw().filter((n) => n.templateId === templateId);
}

export function addNode(
  templateId: string,
  input: { path: string; kind: "folder" | "file" },
): TemplateNode {
  const node: TemplateNode = {
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

export function updateNode(
  id: string,
  patch: Partial<Pick<TemplateNode, "path" | "kind" | "folderName" | "properties" | "runScript">>,
): void {
  const nodes = loadNodesRaw().map((n) => (n.id === id ? { ...n, ...patch, updatedAt: nowIso() } : n));
  saveNodesRaw(nodes);
}

export function deleteNode(id: string): void {
  saveNodesRaw(loadNodesRaw().filter((n) => n.id !== id));
}

export function appendLog(entry: ExecutionLogEntry): void {
  const logs = [...loadLogsRaw(), entry].slice(-MAX_LOG_ENTRIES);
  saveLogsRaw(logs);
}

export function listLogs(templateId: string): ExecutionLogEntry[] {
  return loadLogsRaw()
    .filter((l) => l.templateId === templateId)
    .slice()
    .reverse();
}

export function clearLogs(templateId: string): void {
  saveLogsRaw(loadLogsRaw().filter((l) => l.templateId !== templateId));
}
