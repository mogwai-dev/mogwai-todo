export const CONTRIBUTION_WEEKS = 26;
export const CONTRIBUTION_DAYS = CONTRIBUTION_WEEKS * 7;
export const JST_OFFSET_HOURS = 9;
export const TODO_ROLLOVER_HOUR = 3;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayIsoDate(nowMs = Date.now()): string {
  const jstNow = nowMs + JST_OFFSET_HOURS * 60 * 60 * 1000;
  const businessNow = jstNow - TODO_ROLLOVER_HOUR * 60 * 60 * 1000;
  return new Date(businessNow).toISOString().slice(0, 10);
}

export function shiftIsoDate(date: string, offsetDays: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

export function sanitizeDate(input: string | null): string {
  if (!input) {
    return todayIsoDate();
  }
  return DATE_RE.test(input) ? input : todayIsoDate();
}

export function isEditableDate(date: string): boolean {
  const today = todayIsoDate();
  const yesterday = shiftIsoDate(today, -1);
  return date >= yesterday;
}

export function contributionRate(total: number, done: number): number {
  return total <= 0 ? 0 : done / total;
}

export function contributionLevel(total: number, done: number): 0 | 1 | 2 | 3 {
  if (total <= 0) {
    return 0;
  }
  const rate = done / total;
  if (rate === 1) {
    return 3;
  }
  if (rate < 0.5) {
    return 1;
  }
  return 2;
}

export function contributionDateRange(endDate: string): string[] {
  const startDate = shiftIsoDate(endDate, -(CONTRIBUTION_DAYS - 1));
  return Array.from({ length: CONTRIBUTION_DAYS }, (_, idx) => shiftIsoDate(startDate, idx));
}
