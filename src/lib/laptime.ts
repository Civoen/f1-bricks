/**
 * Lap-time parsing and formatting. Lap times are always integer milliseconds;
 * no floating-point arithmetic is used, so comparisons and gaps are exact.
 */

/** Upper bound matching the database constraint: rejects mistyped extra digits. */
export const MAX_LAP_MS = 60 * 60 * 1000;

export type ParseResult = { ok: true; ms: number } | { ok: false; error: string };

/**
 * Accepts:
 *   "1:10.482"  → 70 482 ms   (m:ss.mmm)
 *   "01:10.482" → 70 482 ms
 *   "58.123"    → 58 123 ms   (ss.mmm, for sub-minute laps)
 *   "1:10.48"   → 70 480 ms   (fewer than three decimal places are padded)
 *   "1:10.4"    → 70 400 ms
 * Rejects anything else rather than guessing (e.g. "1:70.000", "1.10.482",
 * "-1:10.000", "1:10", "abc", more than three decimal places).
 */
export function parseLapTime(input: string): ParseResult {
  const s = input.trim();
  if (s === '') return { ok: false, error: 'Enter a lap time, e.g. 1:28.750' };

  const withMinutes = /^(\d{1,2}):(\d{2})\.(\d{1,3})$/.exec(s);
  const secondsOnly = /^(\d{1,2})\.(\d{1,3})$/.exec(s);
  let minutes: number;
  let seconds: number;
  let fraction: string;
  if (withMinutes) {
    minutes = Number(withMinutes[1]);
    seconds = Number(withMinutes[2]);
    fraction = withMinutes[3]!;
  } else if (secondsOnly) {
    minutes = 0;
    seconds = Number(secondsOnly[1]);
    fraction = secondsOnly[2]!;
  } else {
    return { ok: false, error: 'Use minutes:seconds.thousandths, e.g. 1:28.750' };
  }
  if (seconds > 59) return { ok: false, error: 'Seconds must be between 00 and 59' };
  const millis = Number(fraction.padEnd(3, '0'));
  const ms = minutes * 60_000 + seconds * 1000 + millis;
  if (ms <= 0) return { ok: false, error: 'A lap time must be greater than zero' };
  if (ms >= MAX_LAP_MS) return { ok: false, error: 'A lap time must be under one hour' };
  return { ok: true, ms };
}

/**
 * Live input mask: keeps only digits and lays them out as m:ss.mmm while you
 * type, so "128750" (or a pasted "1:28.750") becomes "1:28.750".
 *   "1" → "1", "12" → "1:2", "128" → "1:28", "1287" → "1:28.7", "128750" → "1:28.750"
 */
export function maskLapTimeInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 6);
  if (d.length <= 1) return d;
  if (d.length <= 3) return `${d[0]}:${d.slice(1)}`;
  return `${d[0]}:${d.slice(1, 3)}.${d.slice(3)}`;
}

/** True once the masked input has all six digits (m:ss.mmm). */
export function isCompleteLapTimeInput(masked: string): boolean {
  return /^\d:\d{2}\.\d{3}$/.test(masked);
}

/** 70482 → "1:10.482"; 58123 → "0:58.123". */
export function formatLapTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0) throw new RangeError(`Invalid lap time: ${ms}`);
  const minutes = Math.floor(ms / 60_000);
  const rest = ms - minutes * 60_000;
  const seconds = Math.floor(rest / 1000);
  const millis = rest - seconds * 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Absolute gap in seconds with millisecond precision: 214 → "0.214", 61234 → "61.234". */
export function formatSeconds(ms: number): string {
  const abs = Math.abs(ms);
  const whole = Math.floor(abs / 1000);
  return `${whole}.${String(abs - whole * 1000).padStart(3, '0')}`;
}

/** Signed gap: 214 → "+0.214", -214 → "−0.214", 0 → "±0.000". */
export function formatGap(ms: number): string {
  if (ms === 0) return '±0.000';
  return `${ms > 0 ? '+' : '−'}${formatSeconds(ms)}`;
}

/** Negative when a is faster than b. */
export function compareLapTimes(a: number, b: number): number {
  return a - b;
}
