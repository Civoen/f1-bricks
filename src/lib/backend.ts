/**
 * Data access. The app talks to a Backend; the real one calls this site's own
 * API (/api/*, a Cloudflare Pages Function backed by D1 — see server/api.ts).
 * The demo backend (VITE_DEMO_MODE=true, local development only) keeps
 * clearly-labelled sample data in memory.
 */
import type { AuditEntry, Circuit, Lap, LogLapResult, Player, RecordEvent } from './types';

export interface Snapshot {
  players: Player[];
  circuits: Circuit[];
  laps: Lap[];
  /** All record events, including superseded ones (for the corrections trail). */
  events: RecordEvent[];
  audit: AuditEntry[];
}

export interface LogLapInput {
  playerId: string;
  circuitId: string;
  lapTimeMs: number;
  recordedAt: string;
  notes: string | null;
  clientRequestId: string;
}

export interface UpdateLapInput {
  lapId: string;
  playerId: string;
  circuitId: string;
  lapTimeMs: number;
  recordedAt: string;
  notes: string | null;
}

export interface Backend {
  load(): Promise<Snapshot>;
  logLap(input: LogLapInput): Promise<LogLapResult>;
  updateLap(input: UpdateLapInput): Promise<void>;
  deleteLap(lapId: string): Promise<void>;
  /** Calls onChange when data may have changed on another device. Returns unsubscribe. */
  subscribe(onChange: () => void): () => void;
}

/** How often an open, visible page checks for laps logged on other devices. */
export const POLL_MS = 30_000;

/** Turns API and network errors into messages fit for the UI. */
export function friendlyError(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? String(err);
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(msg)) return 'Could not reach the server. Check your connection and try again.';
  return msg;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  });
  const type = res.headers.get('Content-Type') ?? '';
  if (!type.includes('application/json')) {
    // Usually local `npm run dev`, where the API (a Cloudflare Function) isn't running.
    throw new Error('The site’s API isn’t running here. Locally, use `npm run dev:demo` (sample data) or see the README.');
  }
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
  return data;
}

export function apiBackend(): Backend {
  return {
    load: () => call<Snapshot>('GET', 'data'),
    logLap: (i) => call<LogLapResult>('POST', 'laps', i),
    async updateLap(i) {
      const { lapId, ...rest } = i;
      await call('PUT', `laps/${encodeURIComponent(lapId)}`, rest);
    },
    async deleteLap(lapId) {
      await call('DELETE', `laps/${encodeURIComponent(lapId)}`);
    },
    subscribe(onChange) {
      // No push channel: refresh periodically while the page is on screen.
      // (The app also refreshes whenever it comes back into view.)
      const timer = setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) onChange();
      }, POLL_MS);
      return () => clearInterval(timer);
    }
  };
}
