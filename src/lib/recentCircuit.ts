/**
 * Remembers the circuit last opened on this device, so the home page can
 * feature it. Kept in this browser only; failures (private mode, blocked
 * storage) are ignored.
 */
const KEY = 'f1-bricks:last-viewed-circuit';

export interface Viewed {
  slug: string;
  at: string;
}

export function markViewed(slug: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ slug, at: new Date().toISOString() } satisfies Viewed));
  } catch {
    // storage unavailable
  }
}

export function lastViewed(): Viewed | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Viewed | null;
    return v && typeof v.slug === 'string' && typeof v.at === 'string' ? v : null;
  } catch {
    return null;
  }
}
