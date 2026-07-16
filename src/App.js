import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { CONTRIBUTION_WEEKS, isEditableDate, sanitizeDate, shiftIsoDate, todayIsoDate, } from "./domain/dateLogic";
import { contributionRateCore, rustEngineLabel, } from "./rust/bridge";
import { addCompanyHoliday, addForcedHoliday, addForcedWorkingDay, removeCompanyHoliday, removeForcedHoliday, removeForcedWorkingDay, setCompanyHolidayEnabled, setForcedHolidayEnabled, setForcedWorkingDayEnabled, } from "./domain/holidayLogic";
import { addTodo, deleteTodo, getHolidaySettings, getMemo, listTodosByDate, loadContribution, saveMemo, saveHolidaySettings, toggleTodo, } from "./storage/localStore";
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function toContributionWeeks(days) {
    const normalized = days.map((d) => ({
        date: d.date,
        total: d.total,
        done: d.done,
        rate: d.excluded ? 0 : contributionRateCore(d.total, d.done),
        excluded: d.excluded,
        excludedReasons: d.excludedReasons,
    }));
    const weeks = [];
    for (let i = 0; i < normalized.length; i += 7) {
        weeks.push(normalized.slice(i, i + 7));
    }
    return weeks;
}
function contributionColor(day) {
    if (day.excluded) {
        return "#dbe2ea";
    }
    if (day.total <= 0) {
        return "#ebedf0";
    }
    // Achievement rate is done / total; lower rate should appear lighter.
    const achievementRate = Math.min(1, Math.max(0, day.rate));
    const saturation = 35 + Math.round(achievementRate * 40);
    const lightness = 90 - Math.round(achievementRate * 48);
    return `hsl(120 ${saturation}% ${lightness}%)`;
}
function readSelectedDate() {
    const url = new URL(window.location.href);
    return sanitizeDate(url.searchParams.get("date"));
}
function writeSelectedDate(date) {
    const url = new URL(window.location.href);
    url.searchParams.set("date", date);
    window.history.replaceState({}, "", url);
}
export default function App() {
    const [activeTab, setActiveTab] = useState("todos");
    const [selectedDate, setSelectedDate] = useState(() => readSelectedDate());
    const [newTodoText, setNewTodoText] = useState("");
    const [memoText, setMemoText] = useState(() => getMemo());
    const [message, setMessage] = useState(null);
    const [dataRevision, setDataRevision] = useState(0);
    const [holidaySettings, setHolidaySettings] = useState(() => getHolidaySettings());
    const [companyHolidayInput, setCompanyHolidayInput] = useState(() => todayIsoDate());
    const days = useMemo(() => {
        return [0, -1, -2].map((offset) => {
            const date = shiftIsoDate(selectedDate, offset);
            return {
                date,
                todos: listTodosByDate(date),
            };
        });
    }, [selectedDate, dataRevision]);
    const contributionWeeks = useMemo(() => {
        const endDate = todayIsoDate();
        return toContributionWeeks(loadContribution(endDate, holidaySettings));
    }, [dataRevision, holidaySettings]);
    const companyHolidayDates = useMemo(() => {
        return Object.keys(holidaySettings.companyHolidays).sort((a, b) => a.localeCompare(b));
    }, [holidaySettings]);
    const forcedHolidayDates = useMemo(() => {
        return Object.entries(holidaySettings.forcedHolidays)
            .filter(([, enabled]) => enabled)
            .map(([date]) => date)
            .sort((a, b) => a.localeCompare(b));
    }, [holidaySettings]);
    const forcedWorkingDates = useMemo(() => {
        return Object.entries(holidaySettings.forcedWorkingDays)
            .filter(([, enabled]) => enabled)
            .map(([date]) => date)
            .sort((a, b) => a.localeCompare(b));
    }, [holidaySettings]);
    const memoRows = useMemo(() => {
        const lineCount = memoText.split(/\r?\n/).length;
        return Math.max(4, Math.min(16, lineCount));
    }, [memoText]);
    const editable = isEditableDate(selectedDate);
    const onChangeDate = (date) => {
        const sanitized = sanitizeDate(date);
        setSelectedDate(sanitized);
        writeSelectedDate(sanitized);
        setMessage(null);
    };
    const onAddTodo = () => {
        if (!editable) {
            setMessage("You can only edit today/yesterday todos.");
            return;
        }
        const text = newTodoText.trim();
        if (!text) {
            setMessage("Please enter a todo.");
            return;
        }
        addTodo(selectedDate, text);
        setNewTodoText("");
        setMessage(null);
        setDataRevision((prev) => prev + 1);
    };
    const onToggleTodo = (date, id) => {
        if (!isEditableDate(date)) {
            setMessage("You can only edit today/yesterday todos.");
            return;
        }
        toggleTodo(date, id);
        setMessage(null);
        setDataRevision((prev) => prev + 1);
    };
    const onDeleteTodo = (date, id) => {
        if (!isEditableDate(date)) {
            setMessage("You can only edit today/yesterday todos.");
            return;
        }
        deleteTodo(date, id);
        setMessage(null);
        setDataRevision((prev) => prev + 1);
    };
    const onSaveMemo = () => {
        saveMemo(memoText.trim());
        setMemoText(getMemo());
        setMessage("Memo saved.");
    };
    const updateHolidaySettings = (next) => {
        setHolidaySettings(next);
        saveHolidaySettings(next);
        setMessage(null);
    };
    const onToggleHolidayFlag = (key) => {
        updateHolidaySettings({
            ...holidaySettings,
            [key]: !holidaySettings[key],
        });
    };
    const onAddCompanyHoliday = () => {
        const date = sanitizeDate(companyHolidayInput);
        const next = addCompanyHoliday(holidaySettings, date);
        updateHolidaySettings(next);
        setCompanyHolidayInput(date);
        setMessage(`Company holiday added: ${date}`);
    };
    const onToggleCompanyHoliday = (date, enabled) => {
        const next = setCompanyHolidayEnabled(holidaySettings, date, enabled);
        updateHolidaySettings(next);
    };
    const onDeleteCompanyHoliday = (date) => {
        const next = removeCompanyHoliday(holidaySettings, date);
        updateHolidaySettings(next);
    };
    const onAddForcedHoliday = () => {
        const date = sanitizeDate(companyHolidayInput);
        const next = addForcedHoliday(holidaySettings, date);
        updateHolidaySettings(next);
        setCompanyHolidayInput(date);
        setMessage(`Forced holiday added: ${date}`);
    };
    const onAddForcedWorkingDay = () => {
        const date = sanitizeDate(companyHolidayInput);
        const next = addForcedWorkingDay(holidaySettings, date);
        updateHolidaySettings(next);
        setCompanyHolidayInput(date);
        setMessage(`Forced working day added: ${date}`);
    };
    const onToggleForcedHoliday = (date, enabled) => {
        const next = setForcedHolidayEnabled(holidaySettings, date, enabled);
        updateHolidaySettings(next);
    };
    const onToggleForcedWorkingDay = (date, enabled) => {
        const next = setForcedWorkingDayEnabled(holidaySettings, date, enabled);
        updateHolidaySettings(next);
    };
    const onDeleteForcedHoliday = (date) => {
        const next = removeForcedHoliday(holidaySettings, date);
        updateHolidaySettings(next);
    };
    const onDeleteForcedWorkingDay = (date) => {
        const next = removeForcedWorkingDay(holidaySettings, date);
        updateHolidaySettings(next);
    };
    return (_jsxs("main", { className: "container", children: [_jsxs("header", { className: "header", children: [_jsx("h1", { children: "Todo Desktop" }), _jsx("p", { className: "muted", children: "Local-only todo app with JST 03:00 day rollover and singleton memo." }), _jsxs("p", { className: "muted", children: ["Core engine: ", rustEngineLabel()] })] }), _jsx("section", { className: "panel controls", children: _jsxs("label", { children: ["Date", _jsx("input", { type: "date", value: selectedDate, onChange: (e) => onChangeDate(e.target.value) })] }) }), _jsx("section", { className: "panel tabs-panel", children: _jsxs("div", { className: "tabs", role: "tablist", "aria-label": "Main sections", children: [_jsx("button", { type: "button", role: "tab", "aria-selected": activeTab === "todos", className: `tab-btn${activeTab === "todos" ? " active" : ""}`, onClick: () => setActiveTab("todos"), children: "Todos" }), _jsx("button", { type: "button", role: "tab", "aria-selected": activeTab === "holidays", className: `tab-btn${activeTab === "holidays" ? " active" : ""}`, onClick: () => setActiveTab("holidays"), children: "Holiday Rules" })] }) }), message && _jsx("p", { className: "message", children: message }), activeTab === "todos" && (_jsxs(_Fragment, { children: [_jsxs("section", { className: "panel", children: [_jsx("h2", { children: "Memo (singleton)" }), _jsx("textarea", { rows: memoRows, value: memoText, placeholder: "Shared memo for all dates", onChange: (e) => setMemoText(e.target.value) }), _jsx("div", { children: _jsx("button", { type: "button", onClick: onSaveMemo, children: "Save memo" }) })] }), _jsxs("section", { className: "panel", children: [_jsx("h2", { children: "Add Todo" }), _jsxs("div", { className: "row", children: [_jsx("input", { type: "text", value: newTodoText, placeholder: `${selectedDate} todo`, onChange: (e) => setNewTodoText(e.target.value) }), _jsx("button", { type: "button", onClick: onAddTodo, children: "Add" })] })] }), days.map((day) => (_jsxs("section", { className: "panel", children: [_jsxs("h2", { children: [day.date, day.date === selectedDate ? " (selected)" : ""] }), day.todos.length === 0 && _jsx("p", { className: "muted", children: "No todos." }), day.todos.length > 0 && (_jsx("ul", { className: "todo-list", children: day.todos.map((todo) => (_jsxs("li", { children: [_jsx("span", { className: todo.done ? "done" : "", children: todo.text }), _jsxs("div", { className: "row", children: [_jsx("button", { type: "button", onClick: () => onToggleTodo(day.date, todo.id), children: todo.done ? "Undo" : "Done" }), _jsx("button", { type: "button", onClick: () => onDeleteTodo(day.date, todo.id), children: "Delete" })] })] }, `${day.date}:${todo.id}`))) }))] }, day.date))), _jsxs("section", { className: "panel", children: [_jsxs("h2", { children: ["Contribution (", CONTRIBUTION_WEEKS, " weeks)"] }), _jsxs("div", { className: "contrib-wrap", children: [_jsxs("div", { className: "weekday-col", children: [_jsx("span", { children: "Sun" }), _jsx("span", { children: "Tue" }), _jsx("span", { children: "Thu" }), _jsx("span", { children: "Sat" })] }), _jsx("div", { className: "weeks-grid", children: contributionWeeks.map((week) => (_jsx("div", { className: "week", children: week.map((day) => (_jsx("button", { type: "button", className: `cell${day.excluded ? " excluded" : ""}`, style: { backgroundColor: contributionColor(day) }, title: day.excluded
                                                    ? `${day.date} (${WEEKDAY_LABELS[new Date(`${day.date}T00:00:00Z`).getUTCDay()]}) excluded: ${day.excludedReasons.join(", ")}`
                                                    : `${day.date} (${WEEKDAY_LABELS[new Date(`${day.date}T00:00:00Z`).getUTCDay()]}) ${day.done}/${day.total} (${Math.round(day.rate * 100)}%)`, onClick: () => onChangeDate(day.date) }, day.date))) }, week[0]?.date ?? "week"))) })] })] })] })), activeTab === "holidays" && (_jsxs("section", { className: "panel", children: [_jsx("h2", { children: "Holiday Rules (Contribution exclusion)" }), _jsxs("div", { className: "checkbox-grid", children: [_jsxs("label", { className: "check-item", children: [_jsx("input", { type: "checkbox", checked: holidaySettings.disableWeekend, onChange: () => onToggleHolidayFlag("disableWeekend") }), "Exclude weekends"] }), _jsxs("label", { className: "check-item", children: [_jsx("input", { type: "checkbox", checked: holidaySettings.disablePublicHoliday, onChange: () => onToggleHolidayFlag("disablePublicHoliday") }), "Exclude Japanese public holidays"] }), _jsxs("label", { className: "check-item", children: [_jsx("input", { type: "checkbox", checked: holidaySettings.disableCompanyHoliday, onChange: () => onToggleHolidayFlag("disableCompanyHoliday") }), "Exclude company holidays"] }), _jsxs("label", { className: "check-item", children: [_jsx("input", { type: "checkbox", checked: holidaySettings.includeCompanyHoliday, onChange: () => onToggleHolidayFlag("includeCompanyHoliday") }), "Include company holidays (final override)"] })] }), _jsxs("div", { className: "row holiday-add-row", children: [_jsx("input", { type: "date", value: companyHolidayInput, onChange: (e) => setCompanyHolidayInput(sanitizeDate(e.target.value)) }), _jsx("button", { type: "button", onClick: onAddCompanyHoliday, children: "Add company holiday" }), _jsx("button", { type: "button", onClick: onAddForcedHoliday, children: "Add forced holiday" }), _jsx("button", { type: "button", onClick: onAddForcedWorkingDay, children: "Add forced working day" })] }), companyHolidayDates.length === 0 && (_jsx("p", { className: "muted", children: "No company holidays configured." })), companyHolidayDates.length > 0 && (_jsx("ul", { className: "holiday-list", children: companyHolidayDates.map((date) => (_jsxs("li", { children: [_jsxs("label", { className: "check-item", children: [_jsx("input", { type: "checkbox", checked: Boolean(holidaySettings.companyHolidays[date]), onChange: (e) => onToggleCompanyHoliday(date, e.target.checked) }), date] }), _jsx("button", { type: "button", onClick: () => onDeleteCompanyHoliday(date), children: "Remove" })] }, date))) })), _jsx("h3", { children: "Forced Holiday Dates" }), forcedHolidayDates.length === 0 && (_jsx("p", { className: "muted", children: "No forced holiday dates." })), forcedHolidayDates.length > 0 && (_jsx("ul", { className: "holiday-list", children: forcedHolidayDates.map((date) => (_jsxs("li", { children: [_jsxs("label", { className: "check-item", children: [_jsx("input", { type: "checkbox", checked: Boolean(holidaySettings.forcedHolidays[date]), onChange: (e) => onToggleForcedHoliday(date, e.target.checked) }), date] }), _jsx("button", { type: "button", onClick: () => onDeleteForcedHoliday(date), children: "Remove" })] }, `forced-holiday:${date}`))) })), _jsx("h3", { children: "Forced Working Day Dates" }), forcedWorkingDates.length === 0 && (_jsx("p", { className: "muted", children: "No forced working day dates." })), forcedWorkingDates.length > 0 && (_jsx("ul", { className: "holiday-list", children: forcedWorkingDates.map((date) => (_jsxs("li", { children: [_jsxs("label", { className: "check-item", children: [_jsx("input", { type: "checkbox", checked: Boolean(holidaySettings.forcedWorkingDays[date]), onChange: (e) => onToggleForcedWorkingDay(date, e.target.checked) }), date] }), _jsx("button", { type: "button", onClick: () => onDeleteForcedWorkingDay(date), children: "Remove" })] }, `forced-working:${date}`))) }))] }))] }));
}
