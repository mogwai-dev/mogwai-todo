import { contributionDateRange, todayIsoDate } from "../domain/dateLogic.ts";
import {
  defaultHolidaySettings,
  holidayExclusionReasons,
  normalizeHolidaySettings,
  type HolidaySettings,
} from "../domain/holidayLogic.ts";

export type TodoItem = {
  id: string;
  text: string;
  done: boolean;
  onHold: boolean;
  createdAt: string;
  note: string;
  order?: number;
};

export type DayStats = {
  date: string;
  total: number;
  done: number;
  excluded: boolean;
  excludedReasons: string[];
};

const TODO_PREFIX = "todo.v1.items.";
const TODO_MEMO_KEY = "todo.v1.memo.singleton";
const TODO_HOLIDAY_SETTINGS_KEY = "todo.v1.holiday.settings";
const TODO_DATE_KEY_RE = /^todo\.v1\.items\.(\d{4}-\d{2}-\d{2})$/;
const STORAGE_KEYS = {
  items: (date: string) => `${TODO_PREFIX}${date}`,
  memo: TODO_MEMO_KEY,
  holidaySettings: TODO_HOLIDAY_SETTINGS_KEY,
};

function sortTodos(items: TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => {
    const orderA = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });
}

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

export function listTodosByDate(date: string): TodoItem[] {
  const raw = readJson<unknown>(STORAGE_KEYS.items(date), []);
  const list = Array.isArray(raw)
    ? raw
      .map((item) => normalizeTodoItem(item))
      .filter((item): item is TodoItem => item !== null)
    : [];
  return sortTodos(list);
}

export function addTodo(date: string, text: string): void {
  const items = listTodosByDate(date);
  const maxOrder = items.reduce((acc, item) =>
    typeof item.order === "number" ? Math.max(acc, item.order) : acc, -1);
  const item: TodoItem = {
    id: crypto.randomUUID(),
    text,
    done: false,
    onHold: false,
    createdAt: new Date().toISOString(),
    note: "",
    order: maxOrder + 1,
  };
  items.push(item);
  writeJson(STORAGE_KEYS.items(date), items);
}

export function moveTodo(date: string, id: string, direction: -1 | 1): void {
  const sorted = listTodosByDate(date);
  const fromIndex = sorted.findIndex((item) => item.id === id);
  const toIndex = fromIndex + direction;
  if (fromIndex < 0 || toIndex < 0 || toIndex >= sorted.length) {
    return;
  }
  const next = [...sorted];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  const normalized = next.map((item, index) => ({ ...item, order: index }));
  writeJson(STORAGE_KEYS.items(date), normalized);
}

export function toggleTodoHold(date: string, id: string, onHold: boolean): void {
  const items = listTodosByDate(date).map((item) =>
    item.id === id ? { ...item, onHold } : item
  );
  writeJson(STORAGE_KEYS.items(date), items);
}

export function carryOverHeldTodos(targetDate: string = todayIsoDate()): number {
  const todayItems = listTodosByDate(targetDate);
  const existingIds = new Set(todayItems.map((item) => item.id));
  let maxOrder = todayItems.reduce((acc, item) =>
    typeof item.order === "number" ? Math.max(acc, item.order) : acc, -1);
  let movedCount = 0;

  for (const key of Object.keys(localStorage)) {
    const match = TODO_DATE_KEY_RE.exec(key);
    if (!match) {
      continue;
    }
    const fromDate = match[1];
    if (fromDate >= targetDate) {
      continue;
    }

    const fromItems = listTodosByDate(fromDate);
    const carry = fromItems.filter((item) => item.onHold && !item.done);
    if (carry.length === 0) {
      continue;
    }

    const remain = fromItems
      .filter((item) => !(item.onHold && !item.done))
      .map((item, index) => ({ ...item, order: index }));
    writeJson(STORAGE_KEYS.items(fromDate), remain);

    for (const item of carry) {
      if (existingIds.has(item.id)) {
        continue;
      }
      maxOrder += 1;
      todayItems.push({ ...item, order: maxOrder });
      existingIds.add(item.id);
      movedCount += 1;
    }
  }

  if (movedCount > 0) {
    const normalized = sortTodos(todayItems).map((item, index) => ({ ...item, order: index }));
    writeJson(STORAGE_KEYS.items(targetDate), normalized);
  }

  return movedCount;
}

export function toggleTodo(date: string, id: string): void {
  const items = listTodosByDate(date).map((item) =>
    item.id === id ? { ...item, done: !item.done } : item
  );
  writeJson(STORAGE_KEYS.items(date), items);
}

export function deleteTodo(date: string, id: string): void {
  const items = listTodosByDate(date).filter((item) => item.id !== id);
  writeJson(STORAGE_KEYS.items(date), items);
}

export function updateTodoNote(date: string, id: string, note: string): void {
  const items = listTodosByDate(date).map((item) =>
    item.id === id ? { ...item, note } : item
  );
  writeJson(STORAGE_KEYS.items(date), items);
}

export function getMemo(): string {
  return readJson<string>(STORAGE_KEYS.memo, "");
}

export function saveMemo(text: string): void {
  writeJson(STORAGE_KEYS.memo, text);
}

export function getHolidaySettings(): HolidaySettings {
  return normalizeHolidaySettings(readJson<unknown>(STORAGE_KEYS.holidaySettings, null));
}

export function saveHolidaySettings(settings: HolidaySettings): void {
  writeJson(STORAGE_KEYS.holidaySettings, settings);
}

export function listStatsByDate(date: string): { total: number; done: number } {
  const items = listTodosByDate(date);
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  return { total, done };
}

export function loadContribution(
  endDate: string,
  settings: HolidaySettings = defaultHolidaySettings(),
): DayStats[] {
  return contributionDateRange(endDate).map((date: string) => {
    const stats = listStatsByDate(date);
    const excludedReasons = holidayExclusionReasons(date, settings);
    return {
      date,
      total: stats.total,
      done: stats.done,
      excluded: excludedReasons.length > 0,
      excludedReasons,
    };
  });
}

function normalizeTodoItem(input: unknown): TodoItem | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const raw = input as Partial<TodoItem>;
  if (typeof raw.id !== "string" || typeof raw.text !== "string" || typeof raw.createdAt !== "string") {
    return null;
  }

  return {
    id: raw.id,
    text: raw.text,
    done: Boolean(raw.done),
    onHold: Boolean(raw.onHold),
    createdAt: raw.createdAt,
    note: typeof raw.note === "string" ? raw.note : "",
    order: typeof raw.order === "number" ? raw.order : undefined,
  };
}
