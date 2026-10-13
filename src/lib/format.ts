/**
 * Date display. All timestamps are stored as UTC (timestamptz) and always
 * shown in the viewer's own time zone, using the same formats everywhere.
 */
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function fmtDay(iso: string): string {
  return dayMonth.format(new Date(iso));
}

export function fmtDate(iso: string): string {
  return dayMonthYear.format(new Date(iso));
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${dayMonthYear.format(d)} · ${time.format(d)}`;
}

export function fmtShortDateTime(iso: string): string {
  const d = new Date(iso);
  return `${dayMonth.format(d)} · ${time.format(d)}`;
}

/** "2026-10-13T12:17" in local time, for <input type="datetime-local">. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local datetime-input value → ISO string with offset (UTC). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function relativeDays(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return fmtDate(iso);
}

export function round2(n: number): string {
  return String(n).padStart(2, '0');
}

export function pct(fraction: number | null): string {
  return fraction === null ? '—' : `${Math.round(fraction * 100)}%`;
}

/** Size class for big circuit names so long names shrink instead of breaking mid-word. */
export function heroNameClass(name: string): string {
  if (name.length <= 7) return 'hero-name';
  if (name.length <= 10) return 'hero-name long';
  return 'hero-name xlong';
}
