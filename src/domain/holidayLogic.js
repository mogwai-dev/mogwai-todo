import { sanitizeDate } from "./dateLogic.js";
const HOLIDAY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function defaultHolidaySettings() {
    return {
        disableWeekend: true,
        disablePublicHoliday: true,
        disableCompanyHoliday: true,
        companyHolidays: {},
        forcedHolidays: {},
        forcedWorkingDays: {},
    };
}
function normalizeHolidayMap(input) {
    const output = {};
    if (!input || typeof input !== "object") {
        return output;
    }
    for (const [date, enabled] of Object.entries(input)) {
        if (!HOLIDAY_DATE_RE.test(date)) {
            continue;
        }
        output[date] = Boolean(enabled);
    }
    return output;
}
export function normalizeHolidaySettings(input) {
    const fallback = defaultHolidaySettings();
    if (!input || typeof input !== "object") {
        return fallback;
    }
    const raw = input;
    const companyHolidays = normalizeHolidayMap(raw.companyHolidays);
    const forcedHolidays = normalizeHolidayMap(raw.forcedHolidays);
    const forcedWorkingDays = normalizeHolidayMap(raw.forcedWorkingDays);
    return {
        disableWeekend: raw.disableWeekend ?? fallback.disableWeekend,
        disablePublicHoliday: raw.disablePublicHoliday ?? fallback.disablePublicHoliday,
        disableCompanyHoliday: raw.disableCompanyHoliday ?? fallback.disableCompanyHoliday,
        companyHolidays,
        forcedHolidays,
        forcedWorkingDays,
    };
}
export function addCompanyHoliday(settings, date) {
    const normalizedDate = sanitizeDate(date);
    return {
        ...settings,
        companyHolidays: {
            ...settings.companyHolidays,
            [normalizedDate]: true,
        },
    };
}
export function removeCompanyHoliday(settings, date) {
    const normalizedDate = sanitizeDate(date);
    const next = { ...settings.companyHolidays };
    delete next[normalizedDate];
    return {
        ...settings,
        companyHolidays: next,
    };
}
export function setCompanyHolidayEnabled(settings, date, enabled) {
    const normalizedDate = sanitizeDate(date);
    return {
        ...settings,
        companyHolidays: {
            ...settings.companyHolidays,
            [normalizedDate]: enabled,
        },
    };
}
export function addForcedHoliday(settings, date) {
    const normalizedDate = sanitizeDate(date);
    const nextWorking = { ...settings.forcedWorkingDays };
    delete nextWorking[normalizedDate];
    return {
        ...settings,
        forcedHolidays: {
            ...settings.forcedHolidays,
            [normalizedDate]: true,
        },
        forcedWorkingDays: nextWorking,
    };
}
export function addForcedWorkingDay(settings, date) {
    const normalizedDate = sanitizeDate(date);
    const nextHoliday = { ...settings.forcedHolidays };
    delete nextHoliday[normalizedDate];
    return {
        ...settings,
        forcedWorkingDays: {
            ...settings.forcedWorkingDays,
            [normalizedDate]: true,
        },
        forcedHolidays: nextHoliday,
    };
}
export function removeForcedHoliday(settings, date) {
    const normalizedDate = sanitizeDate(date);
    const next = { ...settings.forcedHolidays };
    delete next[normalizedDate];
    return {
        ...settings,
        forcedHolidays: next,
    };
}
export function removeForcedWorkingDay(settings, date) {
    const normalizedDate = sanitizeDate(date);
    const next = { ...settings.forcedWorkingDays };
    delete next[normalizedDate];
    return {
        ...settings,
        forcedWorkingDays: next,
    };
}
export function setForcedHolidayEnabled(settings, date, enabled) {
    const normalizedDate = sanitizeDate(date);
    return {
        ...settings,
        forcedHolidays: {
            ...settings.forcedHolidays,
            [normalizedDate]: enabled,
        },
    };
}
export function setForcedWorkingDayEnabled(settings, date, enabled) {
    const normalizedDate = sanitizeDate(date);
    return {
        ...settings,
        forcedWorkingDays: {
            ...settings.forcedWorkingDays,
            [normalizedDate]: enabled,
        },
    };
}
export function holidayExclusionReasons(date, settings) {
    if (settings.forcedWorkingDays[date]) {
        return [];
    }
    const reasons = [];
    if (settings.forcedHolidays[date]) {
        reasons.push("Forced holiday");
    }
    if (settings.disableWeekend && isWeekendDate(date)) {
        reasons.push("Weekend");
    }
    if (settings.disablePublicHoliday && isJapanesePublicHoliday(date)) {
        reasons.push("Public holiday");
    }
    if (settings.disableCompanyHoliday && settings.companyHolidays[date]) {
        reasons.push("Company holiday");
    }
    if (settings.includeCompanyHoliday && settings.companyHolidays[date]) {
        return reasons.filter((reason) => reason !== "Company holiday");
    }
    return reasons;
}
function isWeekendDate(date) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
}
function isJapanesePublicHoliday(date) {
    const year = Number.parseInt(date.slice(0, 4), 10);
    return buildJapaneseHolidaySet(year).has(date);
}
function buildJapaneseHolidaySet(year) {
    const holidays = new Set();
    addFixedHolidays(holidays, year);
    addHappyMondayHolidays(holidays, year);
    addEquinoxHolidays(holidays, year);
    addSubstituteHolidays(holidays);
    addCitizenHolidays(holidays);
    return holidays;
}
function addFixedHolidays(target, year) {
    addDate(target, year, 1, 1); // New Year's Day
    addDate(target, year, 2, 11); // National Foundation Day
    if (year >= 2020) {
        addDate(target, year, 2, 23); // Emperor's Birthday
    }
    addDate(target, year, 4, 29); // Showa Day
    addDate(target, year, 5, 3); // Constitution Memorial Day
    addDate(target, year, 5, 4); // Greenery Day
    addDate(target, year, 5, 5); // Children's Day
    if (year >= 2016) {
        addDate(target, year, 8, 11); // Mountain Day
    }
    addDate(target, year, 11, 3); // Culture Day
    addDate(target, year, 11, 23); // Labor Thanksgiving Day
}
function addHappyMondayHolidays(target, year) {
    // Coming of Age Day: second Monday in January
    addDate(target, year, 1, nthWeekdayInMonth(year, 1, 1, 2));
    // Marine Day: third Monday in July
    addDate(target, year, 7, nthWeekdayInMonth(year, 7, 1, 3));
    // Respect for the Aged Day: third Monday in September
    addDate(target, year, 9, nthWeekdayInMonth(year, 9, 1, 3));
    // Sports Day: second Monday in October
    addDate(target, year, 10, nthWeekdayInMonth(year, 10, 1, 2));
}
function addEquinoxHolidays(target, year) {
    addDate(target, year, 3, vernalEquinoxDay(year));
    addDate(target, year, 9, autumnalEquinoxDay(year));
}
function addSubstituteHolidays(target) {
    const holidayDates = [...target].sort();
    for (const date of holidayDates) {
        const d = new Date(`${date}T00:00:00Z`);
        if (d.getUTCDay() !== 0) {
            continue;
        }
        do {
            d.setUTCDate(d.getUTCDate() + 1);
        } while (target.has(formatIsoDate(d)));
        target.add(formatIsoDate(d));
    }
}
function addCitizenHolidays(target) {
    const sorted = [...target].sort();
    if (sorted.length < 2) {
        return;
    }
    const first = new Date(`${sorted[0]}T00:00:00Z`);
    const last = new Date(`${sorted[sorted.length - 1]}T00:00:00Z`);
    const cursor = new Date(first);
    while (cursor <= last) {
        const current = formatIsoDate(cursor);
        if (!target.has(current)) {
            const prev = new Date(cursor);
            prev.setUTCDate(prev.getUTCDate() - 1);
            const next = new Date(cursor);
            next.setUTCDate(next.getUTCDate() + 1);
            if (target.has(formatIsoDate(prev)) && target.has(formatIsoDate(next))) {
                target.add(current);
            }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
}
function nthWeekdayInMonth(year, month, weekday, nth) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (7 + weekday - first.getUTCDay()) % 7;
    return 1 + offset + (nth - 1) * 7;
}
function vernalEquinoxDay(year) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function autumnalEquinoxDay(year) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function addDate(target, year, month, day) {
    target.add(formatIsoDate(new Date(Date.UTC(year, month - 1, day))));
}
function formatIsoDate(d) {
    return d.toISOString().slice(0, 10);
}
