import { useMemo, useState } from "react";
import {
  CONTRIBUTION_WEEKS,
  isEditableDate,
  sanitizeDate,
  shiftIsoDate,
  todayIsoDate,
} from "./domain/dateLogic";
import {
  contributionRateCore,
  rustEngineLabel,
} from "./rust/bridge";
import {
  addCompanyHoliday,
  addForcedHoliday,
  addForcedWorkingDay,
  holidayExclusionReasons,
  removeCompanyHoliday,
  removeForcedHoliday,
  removeForcedWorkingDay,
  setCompanyHolidayEnabled,
  setForcedHolidayEnabled,
  setForcedWorkingDayEnabled,
  type HolidaySettings,
} from "./domain/holidayLogic";
import {
  addTodo,
  deleteTodo,
  getHolidaySettings,
  getMemo,
  listTodosByDate,
  loadContribution,
  saveMemo,
  saveHolidaySettings,
  toggleTodo,
  updateTodoNote,
  type DayStats,
  type TodoItem,
} from "./storage/localStore";

type ContributionDay = {
  date: string;
  total: number;
  done: number;
  rate: number;
  excluded: boolean;
  excludedReasons: string[];
};

type ContributionCell = ContributionDay | null;

type TodoDay = {
  date: string;
  todos: TodoItem[];
};

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const TODO_VISIBLE_WORKING_DAYS = 3;

function formatExclusionReason(reason: string): string {
  switch (reason) {
    case "Weekend":
      return "週末";
    case "Public holiday":
      return "祝日";
    case "Company holiday":
      return "会社休日";
    case "Forced holiday":
      return "強制休日";
    default:
      return reason;
  }
}

function utcWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function toContributionWeeks(days: DayStats[]): ContributionCell[][] {
  const normalized: ContributionDay[] = days.map((d) => ({
    date: d.date,
    total: d.total,
    done: d.done,
    rate: d.excluded ? 0 : contributionRateCore(d.total, d.done),
    excluded: d.excluded,
    excludedReasons: d.excludedReasons,
  }));

  if (normalized.length === 0) {
    return [];
  }

  const cells: ContributionCell[] = [];
  const leadingEmptyCount = utcWeekday(normalized[0].date);
  for (let i = 0; i < leadingEmptyCount; i += 1) {
    cells.push(null);
  }

  cells.push(...normalized);

  const trailingEmptyCount = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailingEmptyCount; i += 1) {
    cells.push(null);
  }

  const weeks: ContributionCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function contributionColor(day: ContributionDay): string {
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

function readSelectedDate(): string {
  const url = new URL(window.location.href);
  return sanitizeDate(url.searchParams.get("date"));
}

function writeSelectedDate(date: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("date", date);
  window.history.replaceState({}, "", url);
}

function formatDisplayDate(isoDate: string): string {
  return isoDate.replace(/-/g, "/");
}

function recentWorkingDates(baseDate: string, count: number, settings: HolidaySettings): string[] {
  const dates: string[] = [];
  let offset = 0;

  while (dates.length < count && offset < 365) {
    const date = shiftIsoDate(baseDate, -offset);
    const excluded = holidayExclusionReasons(date, settings).length > 0;
    if (!excluded) {
      dates.push(date);
    }
    offset += 1;
  }

  return dates;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"todo" | "settings">("todo");
  const [selectedDate, setSelectedDate] = useState<string>(() => readSelectedDate());
  const [newTodoText, setNewTodoText] = useState("");
  const [memoText, setMemoText] = useState(() => getMemo());
  const [todoNoteDrafts, setTodoNoteDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const [holidaySettings, setHolidaySettings] = useState<HolidaySettings>(() => getHolidaySettings());
  const [companyHolidayInput, setCompanyHolidayInput] = useState(() => todayIsoDate());

  const days: TodoDay[] = useMemo(() => {
    const visibleDates = recentWorkingDates(selectedDate, TODO_VISIBLE_WORKING_DAYS, holidaySettings);
    return visibleDates.map((date) => {
      return {
        date,
        todos: listTodosByDate(date),
      };
    });
  }, [selectedDate, dataRevision, holidaySettings]);

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

  const onChangeDate = (date: string) => {
    const sanitized = sanitizeDate(date);
    setSelectedDate(sanitized);
    writeSelectedDate(sanitized);
    setMessage(null);
  };

  const onAddTodo = () => {
    if (!editable) {
      setMessage("編集できるのは今日と昨日のTodoのみです。");
      return;
    }
    const text = newTodoText.trim();
    if (!text) {
      setMessage("Todoを入力してください。");
      return;
    }
    addTodo(selectedDate, text);
    setNewTodoText("");
    setMessage(null);
    setDataRevision((prev) => prev + 1);
  };

  const onToggleTodo = (date: string, id: string) => {
    if (!isEditableDate(date)) {
      setMessage("編集できるのは今日と昨日のTodoのみです。");
      return;
    }
    toggleTodo(date, id);
    setMessage(null);
    setDataRevision((prev) => prev + 1);
  };

  const onDeleteTodo = (date: string, id: string) => {
    if (!isEditableDate(date)) {
      setMessage("編集できるのは今日と昨日のTodoのみです。");
      return;
    }
    deleteTodo(date, id);
    setMessage(null);
    setDataRevision((prev) => prev + 1);
  };

  const onChangeTodoNoteDraft = (date: string, id: string, note: string) => {
    const key = `${date}:${id}`;
    setTodoNoteDrafts((prev) => ({
      ...prev,
      [key]: note,
    }));
  };

  const onSaveTodoNote = (date: string, id: string, fallbackNote: string) => {
    if (!isEditableDate(date)) {
      setMessage("編集できるのは今日と昨日のTodoのみです。");
      return;
    }

    const key = `${date}:${id}`;
    const note = todoNoteDrafts[key] ?? fallbackNote;
    updateTodoNote(date, id, note);
    setTodoNoteDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setMessage("Todoメモを保存しました。");
    setDataRevision((prev) => prev + 1);
  };

  const onSaveMemo = () => {
    saveMemo(memoText.trim());
    setMemoText(getMemo());
    setMessage("メモを保存しました。");
  };

  const updateHolidaySettings = (next: HolidaySettings) => {
    setHolidaySettings(next);
    saveHolidaySettings(next);
    setMessage(null);
  };

  const onToggleHolidayFlag = (
    key: "disableWeekend" | "disablePublicHoliday" | "disableCompanyHoliday",
  ) => {
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
    setMessage(`会社休日を追加: ${formatDisplayDate(date)}`);
  };

  const onToggleCompanyHoliday = (date: string, enabled: boolean) => {
    const next = setCompanyHolidayEnabled(holidaySettings, date, enabled);
    updateHolidaySettings(next);
  };

  const onDeleteCompanyHoliday = (date: string) => {
    const next = removeCompanyHoliday(holidaySettings, date);
    updateHolidaySettings(next);
  };

  const onAddForcedHoliday = () => {
    const date = sanitizeDate(companyHolidayInput);
    const next = addForcedHoliday(holidaySettings, date);
    updateHolidaySettings(next);
    setCompanyHolidayInput(date);
    setMessage(`強制休日を追加: ${formatDisplayDate(date)}`);
  };

  const onAddForcedWorkingDay = () => {
    const date = sanitizeDate(companyHolidayInput);
    const next = addForcedWorkingDay(holidaySettings, date);
    updateHolidaySettings(next);
    setCompanyHolidayInput(date);
    setMessage(`強制稼働日を追加: ${formatDisplayDate(date)}`);
  };

  const onToggleForcedHoliday = (date: string, enabled: boolean) => {
    const next = setForcedHolidayEnabled(holidaySettings, date, enabled);
    updateHolidaySettings(next);
  };

  const onToggleForcedWorkingDay = (date: string, enabled: boolean) => {
    const next = setForcedWorkingDayEnabled(holidaySettings, date, enabled);
    updateHolidaySettings(next);
  };

  const onDeleteForcedHoliday = (date: string) => {
    const next = removeForcedHoliday(holidaySettings, date);
    updateHolidaySettings(next);
  };

  const onDeleteForcedWorkingDay = (date: string) => {
    const next = removeForcedWorkingDay(holidaySettings, date);
    updateHolidaySettings(next);
  };

  return (
    <main className="container">
      <header className="header">
        <h1>Todo Desktop</h1>
        <p className="muted">
          ローカル専用Todoアプリ（JST 03:00 日付切替・単一メモ）。
        </p>
        <p className="muted">計算エンジン: {rustEngineLabel()}</p>
      </header>

      <section className="panel tabs-panel">
        <div className="tabs" role="tablist" aria-label="Main sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "todo"}
            className={`tab-btn${activeTab === "todo" ? " active" : ""}`}
            onClick={() => setActiveTab("todo")}
          >
            Todo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "settings"}
            className={`tab-btn${activeTab === "settings" ? " active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            設定
          </button>
        </div>
      </section>

      {message && <p className="message">{message}</p>}

      {activeTab === "todo" && (
        <>
          <section className="panel controls">
            <label>
              日付
              <p className="muted date-format">表示: {formatDisplayDate(selectedDate)}</p>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => onChangeDate(e.target.value)}
              />
            </label>
          </section>

          <section className="panel">
            <h2>メモ（単一）</h2>
            <textarea
              rows={memoRows}
              value={memoText}
              placeholder="全日付共通のメモ"
              onChange={(e) => setMemoText(e.target.value)}
            />
            <div>
              <button type="button" onClick={onSaveMemo}>メモを保存</button>
            </div>
          </section>

          <section className="panel">
            <h2>Todo追加</h2>
            <div className="row">
              <input
                type="text"
                value={newTodoText}
                placeholder={`${formatDisplayDate(selectedDate)} todo`}
                onChange={(e) => setNewTodoText(e.target.value)}
              />
              <button type="button" onClick={onAddTodo}>追加</button>
            </div>
          </section>

          {days.map((day) => (
            <section className="panel" key={day.date}>
              <h2>{formatDisplayDate(day.date)}{day.date === selectedDate ? "（選択中）" : ""}</h2>
              {day.todos.length === 0 && <p className="muted">Todoはありません。</p>}
              {day.todos.length > 0 && (
                <ul className="todo-list">
                  {day.todos.map((todo) => (
                    <li key={`${day.date}:${todo.id}`}>
                      <div className="todo-main">
                        <span className={todo.done ? "done" : ""}>{todo.text}</span>
                        <div className="row">
                          <button type="button" onClick={() => onToggleTodo(day.date, todo.id)}>
                            {todo.done ? "未完了に戻す" : "完了"}
                          </button>
                          <button type="button" onClick={() => onDeleteTodo(day.date, todo.id)}>
                            削除
                          </button>
                        </div>
                      </div>

                      <div className="todo-note">
                        <textarea
                          rows={2}
                          placeholder="Todoメモ"
                          value={todoNoteDrafts[`${day.date}:${todo.id}`] ?? todo.note}
                          onChange={(e) => onChangeTodoNoteDraft(day.date, todo.id, e.target.value)}
                        />
                        <div className="row">
                          <button
                            type="button"
                            onClick={() => onSaveTodoNote(day.date, todo.id, todo.note)}
                          >
                            メモ保存
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

        </>
      )}

      {activeTab === "settings" && (
        <section className="panel">
          <h2>休日ルール（コントリビューション除外）</h2>
          <div className="checkbox-grid">
            <label className="check-item">
              <input
                type="checkbox"
                checked={holidaySettings.disableWeekend}
                onChange={() => onToggleHolidayFlag("disableWeekend")}
              />
              週末を除外
            </label>
            <label className="check-item">
              <input
                type="checkbox"
                checked={holidaySettings.disablePublicHoliday}
                onChange={() => onToggleHolidayFlag("disablePublicHoliday")}
              />
              日本の祝日を除外
            </label>
            <label className="check-item">
              <input
                type="checkbox"
                checked={holidaySettings.disableCompanyHoliday}
                onChange={() => onToggleHolidayFlag("disableCompanyHoliday")}
              />
              会社休日を除外
            </label>
          </div>

          <div className="row holiday-add-row">
            <input
              type="date"
              value={companyHolidayInput}
              onChange={(e) => setCompanyHolidayInput(sanitizeDate(e.target.value))}
            />
            <button type="button" onClick={onAddCompanyHoliday}>会社休日を追加</button>
            <button type="button" onClick={onAddForcedHoliday}>強制休日を追加</button>
            <button type="button" onClick={onAddForcedWorkingDay}>強制稼働日を追加</button>
          </div>

          {companyHolidayDates.length === 0 && (
            <p className="muted">会社休日は未設定です。</p>
          )}
          {companyHolidayDates.length > 0 && (
            <ul className="holiday-list">
              {companyHolidayDates.map((date) => (
                <li key={date}>
                  <label className="check-item">
                    <input
                      type="checkbox"
                      checked={Boolean(holidaySettings.companyHolidays[date])}
                      onChange={(e) => onToggleCompanyHoliday(date, e.target.checked)}
                    />
                    {formatDisplayDate(date)}
                  </label>
                  <button type="button" onClick={() => onDeleteCompanyHoliday(date)}>削除</button>
                </li>
              ))}
            </ul>
          )}

          <h3>強制休日の日付</h3>
          {forcedHolidayDates.length === 0 && (
            <p className="muted">強制休日の日付はありません。</p>
          )}
          {forcedHolidayDates.length > 0 && (
            <ul className="holiday-list">
              {forcedHolidayDates.map((date) => (
                <li key={`forced-holiday:${date}`}>
                  <label className="check-item">
                    <input
                      type="checkbox"
                      checked={Boolean(holidaySettings.forcedHolidays[date])}
                      onChange={(e) => onToggleForcedHoliday(date, e.target.checked)}
                    />
                    {formatDisplayDate(date)}
                  </label>
                  <button type="button" onClick={() => onDeleteForcedHoliday(date)}>削除</button>
                </li>
              ))}
            </ul>
          )}

          <h3>強制稼働日の日付</h3>
          {forcedWorkingDates.length === 0 && (
            <p className="muted">強制稼働日の日付はありません。</p>
          )}
          {forcedWorkingDates.length > 0 && (
            <ul className="holiday-list">
              {forcedWorkingDates.map((date) => (
                <li key={`forced-working:${date}`}>
                  <label className="check-item">
                    <input
                      type="checkbox"
                      checked={Boolean(holidaySettings.forcedWorkingDays[date])}
                      onChange={(e) => onToggleForcedWorkingDay(date, e.target.checked)}
                    />
                    {formatDisplayDate(date)}
                  </label>
                  <button type="button" onClick={() => onDeleteForcedWorkingDay(date)}>削除</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="panel">
        <h2>コントリビューション（{CONTRIBUTION_WEEKS}週）</h2>
        <div className="contrib-wrap">
          <div className="weekday-col">
            <span>日</span>
            <span>火</span>
            <span>木</span>
            <span>土</span>
          </div>
          <div className="weeks-grid">
            {contributionWeeks.map((week, weekIndex) => (
              <div className="week" key={`week-${weekIndex}`}>
                {week.map((day, dayIndex) => {
                  if (!day) {
                    return <div key={`empty-${weekIndex}-${dayIndex}`} className="cell placeholder" aria-hidden="true" />;
                  }

                  const weekday = WEEKDAY_LABELS[utcWeekday(day.date)];
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={`cell${day.excluded ? " excluded" : ""}`}
                      style={{ backgroundColor: contributionColor(day) }}
                      title={
                        day.excluded
                          ? `${formatDisplayDate(day.date)}（${weekday}）除外: ${day.excludedReasons.map(formatExclusionReason).join(", ")}`
                          : `${formatDisplayDate(day.date)} (${weekday}) ${day.done}/${day.total} (${Math.round(day.rate * 100)}%)`
                      }
                      onClick={() => onChangeDate(day.date)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
