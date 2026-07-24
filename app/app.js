import {
  CONTRIBUTION_WEEKS,
  isEditableDate,
  sanitizeDate,
  shiftIsoDate,
  todayIsoDate,
} from "/src/domain/dateLogic.js";
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
} from "/src/domain/holidayLogic.js";
import {
  addTodo,
  carryOverHeldTodos,
  deleteTodo,
  getHolidaySettings,
  getMemo,
  listTodosByDate,
  loadContribution,
  moveTodo,
  saveHolidaySettings,
  saveMemo,
  toggleTodoHold,
  toggleTodo,
  updateTodoNote,
} from "/src/storage/localStore.js";
import { initImpactGraph } from "/app/impactGraph.js";
import { initTemplateRunner } from "/app/templateRunner.js";

const TODO_VISIBLE_WORKING_DAYS = 3;

const state = {
  selectedDate: sanitizeDate(new URL(location.href).searchParams.get("date")),
  dataRevision: 0,
  holidaySettings: getHolidaySettings(),
  noteDrafts: {},
};

const refs = {
  dateInput: document.querySelector("#date-input"),
  todayBtn: document.querySelector("#today-btn"),
  status: document.querySelector("#status"),
  memo: document.querySelector("#memo"),
  days: document.querySelector("#days"),
  heatmap: document.querySelector("#heatmap"),
  tabTodo: document.querySelector("#tab-todo"),
  tabImpact: document.querySelector("#tab-impact"),
  tabTemplate: document.querySelector("#tab-template"),
  tabSettings: document.querySelector("#tab-settings"),
  viewTodo: document.querySelector("#view-todo"),
  viewImpact: document.querySelector("#view-impact"),
  viewTemplate: document.querySelector("#view-template"),
  viewSettings: document.querySelector("#view-settings"),
  disableWeekend: document.querySelector("#disable-weekend"),
  disablePublic: document.querySelector("#disable-public"),
  disableCompany: document.querySelector("#disable-company"),
  companyInput: document.querySelector("#company-input"),
  companyAdd: document.querySelector("#company-add"),
  companyList: document.querySelector("#company-list"),
  copySummary: document.querySelector("#copy-summary"),
  summaryOutput: document.querySelector("#summary-output"),
  forcedHolidayInput: document.querySelector("#forced-holiday-input"),
  forcedHolidayAdd: document.querySelector("#forced-holiday-add"),
  forcedHolidayList: document.querySelector("#forced-holiday-list"),
  forcedWorkingInput: document.querySelector("#forced-working-input"),
  forcedWorkingAdd: document.querySelector("#forced-working-add"),
  forcedWorkingList: document.querySelector("#forced-working-list"),
  engineLabel: document.querySelector("#engine-label"),
};

function setStatus(message = "") {
  refs.status.textContent = message;
}

function writeSelectedDate(date) {
  const url = new URL(location.href);
  url.searchParams.set("date", date);
  history.replaceState({}, "", url);
}

function recentWorkingDates(baseDate, count) {
  const dates = [];
  let offset = 0;
  while (dates.length < count && offset < 365) {
    const date = shiftIsoDate(baseDate, -offset);
    const excluded = holidayExclusionReasons(date, state.holidaySettings).length > 0;
    if (!excluded) {
      dates.push(date);
    }
    offset += 1;
  }
  return dates;
}

function formatDate(isoDate) {
  return isoDate.replaceAll("-", "/");
}

function contributionColor(day) {
  if (day.excluded) {
    return "#dbe2ea";
  }
  if (day.total <= 0) {
    return "#ebedf0";
  }
  const rate = Math.min(1, Math.max(0, day.done / day.total));
  const saturation = 35 + Math.round(rate * 40);
  const lightness = 90 - Math.round(rate * 48);
  return `hsl(120 ${saturation}% ${lightness}%)`;
}

function toContributionWeeks(days) {
  const normalized = days.map((d) => ({ ...d }));
  if (normalized.length === 0) {
    return [];
  }
  const leading = new Date(`${normalized[0].date}T00:00:00Z`).getUTCDay();
  const cells = Array.from({ length: leading }, () => null);
  cells.push(...normalized);
  const trailing = (7 - (cells.length % 7)) % 7;
  cells.push(...Array.from({ length: trailing }, () => null));
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function renderSummary() {
  const date = todayIsoDate();
  const todos = listTodosByDate(date);
  const done = todos.filter((item) => item.done).length;
  const held = todos.filter((item) => item.onHold && !item.done).length;
  const pending = todos.length - done;
  const pendingItems = todos
    .filter((item) => !item.done)
    .map((item) => `- ${item.text}${item.onHold ? " [保留]" : ""}`);

  refs.summaryOutput.textContent = [
    `${formatDate(date)} Todoサマリー`,
    `完了: ${done}/${todos.length}`,
    `未完了: ${pending}`,
    `保留: ${held}`,
    "",
    pendingItems.length > 0 ? "未完了一覧:" : "未完了Todoはありません。",
    ...pendingItems,
  ].join("\n");
}

function renderTodoDays() {
  refs.days.innerHTML = "";
  const visibleDates = recentWorkingDates(state.selectedDate, TODO_VISIBLE_WORKING_DAYS);

  for (const date of visibleDates) {
    const dayBlock = document.createElement("section");
    dayBlock.className = "day-block";
    const todos = listTodosByDate(date);
    const editable = isEditableDate(date);

    const dayHead = document.createElement("div");
    dayHead.className = "day-head";
    dayHead.innerHTML = `
      <strong>${formatDate(date)}</strong>
      <span class="tag">${editable ? "編集可" : "参照のみ"}</span>
    `;
    dayBlock.append(dayHead);

    if (date === state.selectedDate) {
      const createWrap = document.createElement("div");
      createWrap.className = "todo-create";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "新しいTodo";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "追加";
      button.disabled = !editable;
      button.addEventListener("click", () => {
        if (!editable) {
          setStatus("編集できるのは今日と昨日のみです。");
          return;
        }
        const text = input.value.trim();
        if (!text) {
          setStatus("Todoを入力してください。");
          return;
        }
        addTodo(date, text);
        input.value = "";
        refresh();
      });
      createWrap.append(input, button);
      dayBlock.append(createWrap);
    }

    const list = document.createElement("ul");
    list.className = "todo-list";

    for (const [index, item] of todos.entries()) {
      const li = document.createElement("li");
      li.className = "todo-item";

      const row = document.createElement("div");
      row.className = `todo-main ${item.done ? "done" : ""}`;

      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = `todo-btn done-toggle ${item.done ? "done" : "todo"}`;
      doneBtn.textContent = item.done ? "完了" : "未完";
      doneBtn.disabled = !editable;
      doneBtn.setAttribute("aria-pressed", item.done ? "true" : "false");
      doneBtn.addEventListener("click", () => {
        if (!editable) {
          setStatus("編集できるのは今日と昨日のみです。");
          return;
        }
        toggleTodo(date, item.id);
        refresh();
      });

      const label = document.createElement("label");
      label.textContent = item.text;

      const actions = document.createElement("div");
      actions.className = "todo-actions";

      const up = document.createElement("button");
      up.type = "button";
      up.className = "outline mini";
      up.textContent = "↑";
      up.disabled = !editable || index === 0;
      up.title = "上へ移動";
      up.addEventListener("click", () => {
        if (!editable) {
          setStatus("編集できるのは今日と昨日のみです。");
          return;
        }
        moveTodo(date, item.id, -1);
        refresh();
      });

      const down = document.createElement("button");
      down.type = "button";
      down.className = "outline mini";
      down.textContent = "↓";
      down.disabled = !editable || index === todos.length - 1;
      down.title = "下へ移動";
      down.addEventListener("click", () => {
        if (!editable) {
          setStatus("編集できるのは今日と昨日のみです。");
          return;
        }
        moveTodo(date, item.id, 1);
        refresh();
      });

      actions.append(up, down);

      const holdLabel = document.createElement("label");
      holdLabel.className = "todo-hold";
      const holdCheck = document.createElement("input");
      holdCheck.type = "checkbox";
      holdCheck.checked = Boolean(item.onHold);
      holdCheck.disabled = !editable;
      holdCheck.addEventListener("change", () => {
        if (!editable) {
          setStatus("編集できるのは今日と昨日のみです。");
          return;
        }
        toggleTodoHold(date, item.id, holdCheck.checked);
        refresh();
      });
      const holdText = document.createElement("span");
      holdText.textContent = "保留";
      holdLabel.append(holdCheck, holdText);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "todo-btn delete-btn";
      del.textContent = "削除";
      del.disabled = !editable;
      del.addEventListener("click", () => {
        if (!editable) {
          setStatus("編集できるのは今日と昨日のみです。");
          return;
        }
        deleteTodo(date, item.id);
        refresh();
      });

      row.append(doneBtn, label, actions, holdLabel, del);

      const noteWrap = document.createElement("div");
      noteWrap.className = "todo-note";
      const noteInput = document.createElement("input");
      noteInput.type = "text";
      noteInput.placeholder = "メモ";
      noteInput.value = state.noteDrafts[`${date}:${item.id}`] ?? item.note;
      noteInput.disabled = !editable;
      noteInput.addEventListener("input", (e) => {
        state.noteDrafts[`${date}:${item.id}`] = e.target.value;
      });

      const noteSave = document.createElement("button");
      noteSave.type = "button";
      noteSave.className = "outline";
      noteSave.textContent = "保存";
      noteSave.disabled = !editable;
      noteSave.addEventListener("click", () => {
        if (!editable) {
          setStatus("編集できるのは今日と昨日のみです。");
          return;
        }
        const nextNote = state.noteDrafts[`${date}:${item.id}`] ?? item.note;
        updateTodoNote(date, item.id, nextNote);
        refresh();
      });

      noteWrap.append(noteInput, noteSave);
      li.append(row, noteWrap);
      list.append(li);
    }

    if (todos.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "Todoはありません。";
      dayBlock.append(empty);
    } else {
      dayBlock.append(list);
    }

    refs.days.append(dayBlock);
  }
}

function renderHeatmap() {
  refs.heatmap.innerHTML = "";
  const stats = loadContribution(todayIsoDate(), state.holidaySettings);
  const weeks = toContributionWeeks(stats).slice(-CONTRIBUTION_WEEKS);
  const wrap = document.createElement("div");
  wrap.className = "grid-wrap";

  for (const week of weeks) {
    const weekCol = document.createElement("div");
    weekCol.className = "week";
    for (const day of week) {
      const cell = document.createElement("div");
      if (!day) {
        cell.className = "cell empty";
      } else {
        cell.className = "cell";
        cell.style.background = contributionColor(day);
        const suffix = day.excluded ? `除外: ${day.excludedReasons.join(",")}` : `${day.done}/${day.total}`;
        cell.title = `${day.date} ${suffix}`;
      }
      weekCol.append(cell);
    }
    wrap.append(weekCol);
  }

  refs.heatmap.append(wrap);
}

function renderDateList(listEl, entries, onToggle, onRemove) {
  listEl.innerHTML = "";
  if (entries.length === 0) {
    const li = document.createElement("li");
    li.textContent = "登録なし";
    listEl.append(li);
    return;
  }

  for (const [date, enabled] of entries) {
    const li = document.createElement("li");
    li.className = "date-row";

    const left = document.createElement("div");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled;
    checkbox.addEventListener("change", () => onToggle(date, checkbox.checked));
    const text = document.createElement("span");
    text.textContent = ` ${date}`;
    left.append(checkbox, text);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "outline";
    remove.textContent = "削除";
    remove.addEventListener("click", () => onRemove(date));

    li.append(left, remove);
    listEl.append(li);
  }
}

function renderSettings() {
  const s = state.holidaySettings;
  refs.disableWeekend.checked = s.disableWeekend;
  refs.disablePublic.checked = s.disablePublicHoliday;
  refs.disableCompany.checked = s.disableCompanyHoliday;

  const companyEntries = Object.entries(s.companyHolidays).sort(([a], [b]) => a.localeCompare(b));
  renderDateList(
    refs.companyList,
    companyEntries,
    (date, enabled) => {
      state.holidaySettings = setCompanyHolidayEnabled(state.holidaySettings, date, enabled);
      saveHolidaySettings(state.holidaySettings);
      refresh();
    },
    (date) => {
      state.holidaySettings = removeCompanyHoliday(state.holidaySettings, date);
      saveHolidaySettings(state.holidaySettings);
      refresh();
    },
  );

  const forcedHolidayEntries = Object.entries(s.forcedHolidays).sort(([a], [b]) => a.localeCompare(b));
  renderDateList(
    refs.forcedHolidayList,
    forcedHolidayEntries,
    (date, enabled) => {
      state.holidaySettings = setForcedHolidayEnabled(state.holidaySettings, date, enabled);
      saveHolidaySettings(state.holidaySettings);
      refresh();
    },
    (date) => {
      state.holidaySettings = removeForcedHoliday(state.holidaySettings, date);
      saveHolidaySettings(state.holidaySettings);
      refresh();
    },
  );

  const forcedWorkingEntries = Object.entries(s.forcedWorkingDays).sort(([a], [b]) => a.localeCompare(b));
  renderDateList(
    refs.forcedWorkingList,
    forcedWorkingEntries,
    (date, enabled) => {
      state.holidaySettings = setForcedWorkingDayEnabled(state.holidaySettings, date, enabled);
      saveHolidaySettings(state.holidaySettings);
      refresh();
    },
    (date) => {
      state.holidaySettings = removeForcedWorkingDay(state.holidaySettings, date);
      saveHolidaySettings(state.holidaySettings);
      refresh();
    },
  );
}

function setActiveTab(activeKey) {
  const tabs = {
    todo: [refs.tabTodo, refs.viewTodo],
    impact: [refs.tabImpact, refs.viewImpact],
    template: [refs.tabTemplate, refs.viewTemplate],
    settings: [refs.tabSettings, refs.viewSettings],
  };
  for (const [key, [tabEl, viewEl]] of Object.entries(tabs)) {
    const isActive = key === activeKey;
    tabEl.classList.toggle("active", isActive);
    viewEl.classList.toggle("active", isActive);
  }
}

function refresh() {
  const moved = carryOverHeldTodos(todayIsoDate());
  if (moved > 0) {
    setStatus(`保留Todoを${moved}件、今日に持ち越しました。`);
  }
  state.dataRevision += 1;
  refs.dateInput.value = state.selectedDate;
  refs.memo.value = getMemo();
  renderSummary();
  renderTodoDays();
  renderHeatmap();
  renderSettings();
  refs.engineLabel.textContent = "TypeScript Logic";
}

function bindEvents() {
  refs.dateInput.addEventListener("change", () => {
    state.selectedDate = sanitizeDate(refs.dateInput.value);
    writeSelectedDate(state.selectedDate);
    setStatus("");
    refresh();
  });

  refs.todayBtn.addEventListener("click", () => {
    state.selectedDate = todayIsoDate();
    writeSelectedDate(state.selectedDate);
    setStatus("");
    refresh();
  });

  refs.copySummary.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(refs.summaryOutput.textContent);
      setStatus("今日のサマリーをコピーしました。");
    } catch {
      setStatus("コピーできませんでした。テキストを選択してコピーしてください。");
    }
  });

  refs.memo.addEventListener("input", () => {
    saveMemo(refs.memo.value);
  });

  refs.tabTodo.addEventListener("click", () => setActiveTab("todo"));
  refs.tabImpact.addEventListener("click", () => setActiveTab("impact"));
  refs.tabTemplate.addEventListener("click", () => setActiveTab("template"));
  refs.tabSettings.addEventListener("click", () => setActiveTab("settings"));

  refs.disableWeekend.addEventListener("change", () => {
    state.holidaySettings = { ...state.holidaySettings, disableWeekend: refs.disableWeekend.checked };
    saveHolidaySettings(state.holidaySettings);
    refresh();
  });

  refs.disablePublic.addEventListener("change", () => {
    state.holidaySettings = { ...state.holidaySettings, disablePublicHoliday: refs.disablePublic.checked };
    saveHolidaySettings(state.holidaySettings);
    refresh();
  });

  refs.disableCompany.addEventListener("change", () => {
    state.holidaySettings = { ...state.holidaySettings, disableCompanyHoliday: refs.disableCompany.checked };
    saveHolidaySettings(state.holidaySettings);
    refresh();
  });

  refs.companyAdd.addEventListener("click", () => {
    state.holidaySettings = addCompanyHoliday(state.holidaySettings, refs.companyInput.value || todayIsoDate());
    saveHolidaySettings(state.holidaySettings);
    refresh();
  });

  refs.forcedHolidayAdd.addEventListener("click", () => {
    state.holidaySettings = addForcedHoliday(state.holidaySettings, refs.forcedHolidayInput.value || todayIsoDate());
    saveHolidaySettings(state.holidaySettings);
    refresh();
  });

  refs.forcedWorkingAdd.addEventListener("click", () => {
    state.holidaySettings = addForcedWorkingDay(state.holidaySettings, refs.forcedWorkingInput.value || todayIsoDate());
    saveHolidaySettings(state.holidaySettings);
    refresh();
  });
}

function initDefaults() {
  const today = todayIsoDate();
  refs.companyInput.value = today;
  refs.forcedHolidayInput.value = today;
  refs.forcedWorkingInput.value = today;
}

/**
 * Wires every ".impact-help-btn" ("?") button in the app to a single shared
 * popover that shows the button's `data-help` text - used for form fields
 * whose full description is too long to fit in a placeholder.
 */
function wireHelpButtons() {
  const popover = document.createElement("div");
  popover.className = "impact-help-popover";
  popover.setAttribute("role", "tooltip");
  popover.hidden = true;
  document.body.append(popover);

  let activeBtn = null;

  function closePopover() {
    popover.hidden = true;
    activeBtn?.classList.remove("active");
    activeBtn = null;
  }

  function openPopover(btn) {
    popover.textContent = btn.dataset.help ?? "";
    popover.hidden = false;
    const rect = btn.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${rect.left}px`;
    const popRect = popover.getBoundingClientRect();
    const maxLeft = window.innerWidth - popRect.width - 8;
    if (rect.left > maxLeft) {
      popover.style.left = `${Math.max(8, maxLeft)}px`;
    }
    const maxTop = window.innerHeight - popRect.height - 8;
    if (rect.bottom + 6 > maxTop) {
      popover.style.top = `${Math.max(8, rect.top - popRect.height - 6)}px`;
    }
    btn.classList.add("active");
    activeBtn = btn;
  }

  for (const btn of document.querySelectorAll(".impact-help-btn")) {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (activeBtn === btn) {
        closePopover();
      } else {
        openPopover(btn);
      }
    });
  }

  document.addEventListener("click", (event) => {
    if (!popover.hidden && !popover.contains(event.target)) {
      closePopover();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePopover();
    }
  });
}

bindEvents();
initDefaults();
refresh();
initImpactGraph();
initTemplateRunner();
wireHelpButtons();
