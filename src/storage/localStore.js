import { contributionDateRange } from "../domain/dateLogic.js";
import { defaultHolidaySettings, holidayExclusionReasons, normalizeHolidaySettings, } from "../domain/holidayLogic.js";
const TODO_PREFIX = "todo.v1.items.";
const TODO_MEMO_KEY = "todo.v1.memo.singleton";
const TODO_HOLIDAY_SETTINGS_KEY = "todo.v1.holiday.settings";
const STORAGE_KEYS = {
    items: (date) => `${TODO_PREFIX}${date}`,
    memo: TODO_MEMO_KEY,
    holidaySettings: TODO_HOLIDAY_SETTINGS_KEY,
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
export function listTodosByDate(date) {
    const raw = readJson(STORAGE_KEYS.items(date), []);
    const list = Array.isArray(raw)
        ? raw.map((item) => normalizeTodoItem(item)).filter((item) => item !== null)
        : [];
    return [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function addTodo(date, text) {
    const items = listTodosByDate(date);
    const item = {
        id: crypto.randomUUID(),
        text,
        done: false,
        createdAt: new Date().toISOString(),
        note: "",
    };
    items.push(item);
    writeJson(STORAGE_KEYS.items(date), items);
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
        createdAt: raw.createdAt,
        note: typeof raw.note === "string" ? raw.note : "",
    };
}
