import { contributionDateRange, todayIsoDate } from "../domain/dateLogic.js";
import { defaultHolidaySettings, holidayExclusionReasons, normalizeHolidaySettings, } from "../domain/holidayLogic.js";
const TODO_PREFIX = "todo.v1.items.";
const TODO_MEMO_KEY = "todo.v1.memo.singleton";
const TODO_HOLIDAY_SETTINGS_KEY = "todo.v1.holiday.settings";
const TODO_DATE_KEY_RE = /^todo\.v1\.items\.(\d{4}-\d{2}-\d{2})$/;
const STORAGE_KEYS = {
    items: (date) => `${TODO_PREFIX}${date}`,
    memo: TODO_MEMO_KEY,
    holidaySettings: TODO_HOLIDAY_SETTINGS_KEY,
};
function sortTodos(items) {
    return [...items].sort((a, b) => {
        const orderA = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
        const orderB = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        return a.createdAt.localeCompare(b.createdAt);
    });
}
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
export function listTodosByDate(date) {
    const raw = readJson(STORAGE_KEYS.items(date), []);
    const list = Array.isArray(raw)
        ? raw.map((item) => normalizeTodoItem(item)).filter((item) => item !== null)
        : [];
    return sortTodos(list);
}
export function addTodo(date, text) {
    const items = listTodosByDate(date);
    const maxOrder = items.reduce((acc, item) => (typeof item.order === "number" ? Math.max(acc, item.order) : acc), -1);
    const item = {
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
export function moveTodo(date, id, direction) {
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
export function toggleTodoHold(date, id, onHold) {
    const items = listTodosByDate(date).map((item) => item.id === id ? { ...item, onHold } : item);
    writeJson(STORAGE_KEYS.items(date), items);
}
export function carryOverHeldTodos(targetDate = todayIsoDate()) {
    const todayItems = listTodosByDate(targetDate);
    const existingIds = new Set(todayItems.map((item) => item.id));
    let maxOrder = todayItems.reduce((acc, item) => (typeof item.order === "number" ? Math.max(acc, item.order) : acc), -1);
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
        const remain = fromItems.filter((item) => !(item.onHold && !item.done))
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
export function toggleTodo(date, id) {
    const items = listTodosByDate(date).map((item) => item.id === id ? { ...item, done: !item.done } : item);
    writeJson(STORAGE_KEYS.items(date), items);
}
export function deleteTodo(date, id) {
    const items = listTodosByDate(date).filter((item) => item.id !== id);
    writeJson(STORAGE_KEYS.items(date), items);
}
export function updateTodoNote(date, id, note) {
    const items = listTodosByDate(date).map((item) => item.id === id ? { ...item, note } : item);
    writeJson(STORAGE_KEYS.items(date), items);
}
export function getMemo() {
    return readJson(STORAGE_KEYS.memo, "");
}
export function saveMemo(text) {
    writeJson(STORAGE_KEYS.memo, text);
}
export function getHolidaySettings() {
    return normalizeHolidaySettings(readJson(STORAGE_KEYS.holidaySettings, null));
}
export function saveHolidaySettings(settings) {
    writeJson(STORAGE_KEYS.holidaySettings, settings);
}
export function listStatsByDate(date) {
    const items = listTodosByDate(date);
    const total = items.length;
    const done = items.filter((item) => item.done).length;
    return { total, done };
}
export function loadContribution(endDate, settings = defaultHolidaySettings()) {
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
function normalizeTodoItem(input) {
    if (!input || typeof input !== "object") {
        return null;
    }
    const raw = input;
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
