import { contributionDateRange } from "../domain/dateLogic";
import {
  defaultHolidaySettings,
  holidayExclusionReasons,
  normalizeHolidaySettings,
  type HolidaySettings,
} from "../domain/holidayLogic";

export type TodoItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  note: string;
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
const STORAGE_KEYS = {
  items: (date: string) => `${TODO_PREFIX}${date}`,
  memo: TODO_MEMO_KEY,
  holidaySettings: TODO_HOLIDAY_SETTINGS_KEY,
};

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
  return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function addTodo(date: string, text: string): void {
  const items = listTodosByDate(date);
  const item: TodoItem = {
    id: crypto.randomUUID(),
    text,
    done: false,
    createdAt: new Date().toISOString(),
    note: "",
  };
  items.push(item);
  writeJson(STORAGE_KEYS.items(date), items);
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
  return contributionDateRange(endDate).map((date) => {
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
    createdAt: raw.createdAt,
    note: typeof raw.note === "string" ? raw.note : "",
  };
}
