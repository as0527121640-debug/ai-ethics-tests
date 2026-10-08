import type { RunStatus } from '../engine/types';

export function fmtPop(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} מיליארד תושבים`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} מיליון תושבים`;
  return `${Math.round(n / 1e3)} אלף תושבים`;
}

/** Natural Earth stores GDP in millions of USD. */
export function fmtGdpMd(md: number): string {
  if (md >= 1e6) return `$${(md / 1e6).toFixed(1)} טריליון`;
  if (md >= 1e3) return `$${Math.round(md / 1e3)} מיליארד`;
  return `$${md} מיליון`;
}

export function fmtNum(n: number, digits = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtMinutes(min: number): string {
  if (min < 1) return 'פחות מדקה';
  if (min < 60) return `כ-${Math.ceil(min)} דקות`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `כ-${h} שעות ו-${m} דקות` : `כ-${h} שעות`;
}

export const STATUS_HE: Record<RunStatus, { label: string; bg: string; fg: string; dot: string }> = {
  running: { label: 'פועלת', bg: 'var(--good-bg)', fg: 'var(--good-ink)', dot: '#0ca30c' },
  paused: { label: 'מושהית', bg: 'var(--warn-bg)', fg: 'var(--warn-ink)', dot: '#ec835a' },
  done: { label: 'הסתיימה', bg: 'var(--info-bg)', fg: 'var(--info-ink)', dot: '#4f4d48' },
  stopped: { label: 'נעצרה', bg: 'var(--info-bg)', fg: 'var(--info-ink)', dot: '#898781' },
  error: { label: 'שגיאה', bg: 'var(--critical-bg)', fg: 'var(--critical-ink)', dot: '#d03b3b' },
};

export const UNIT_HE: Record<string, { one: string; many: string }> = {
  day: { one: 'יום', many: 'ימים' },
  week: { one: 'שבוע', many: 'שבועות' },
  month: { one: 'חודש', many: 'חודשים' },
  year: { one: 'שנה', many: 'שנים' },
};
