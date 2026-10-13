/**
 * API + database tests: runs the real API (server/api.ts) and schema against
 * an in-process SQLite database (Node's built-in node:sqlite, the same engine
 * D1 uses) through a small stand-in for Cloudflare's D1 interface.
 */
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApi, type D1Like, type D1Stmt, type Env } from '../server/api';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
type Sqlite = InstanceType<typeof DatabaseSync>;

/** Minimal D1 look-alike over node:sqlite. Batches run in a transaction, like D1. */
function fakeD1(sqlite: Sqlite): D1Like {
  const tick = () => new Promise((r) => setTimeout(r, 0)); // let concurrent requests interleave
  const stmt = (sql: string, params: unknown[] = []): D1Stmt & { runSync(): void } => ({
    bind: (...v: unknown[]) => stmt(sql, v),
    async first<T>() {
      await tick();
      const r = sqlite.prepare(sql).get(...(params as never[]));
      return (r ? { ...r } : null) as T | null;
    },
    async all<T>() {
      await tick();
      return { results: sqlite.prepare(sql).all(...(params as never[])).map((r) => ({ ...r })) as T[] };
    },
    async run() {
      await tick();
      return sqlite.prepare(sql).run(...(params as never[]));
    },
    runSync() {
      sqlite.prepare(sql).run(...(params as never[]));
    }
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(stmts) {
      await tick();
      sqlite.exec('BEGIN');
      try {
        for (const s of stmts) (s as ReturnType<typeof stmt>).runSync();
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
      return [];
    }
  };
}

let sqlite: Sqlite;
let env: Env;
let pending: Promise<unknown>[];
let ids: { players: Record<string, string>; circuits: Record<string, string> };

async function api(method: string, path: string, body?: unknown) {
  const res = await handleApi(
    new Request(`https://f1-bricks.pages.dev/api/${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    env,
    (p) => pending.push(p)
  );
  return { status: res.status, body: (await res.json()) as any };
}

async function logLap(player: string, circuit: string, ms: number, recordedAt: string, requestId?: string) {
  const r = await api('POST', 'laps', {
    playerId: ids.players[player], circuitId: ids.circuits[circuit], lapTimeMs: ms, recordedAt, notes: null,
    clientRequestId: requestId ?? crypto.randomUUID()
  });
  if (r.status !== 200) throw new Error(r.body.error);
  return r.body as { lap_id: string; outcome: string; previous_record_ms: number | null; duplicate: boolean };
}

const updateLap = (lapId: string, player: string, circuit: string, ms: number, recordedAt: string, notes: string | null = null) =>
  api('PUT', `laps/${lapId}`, { playerId: ids.players[player], circuitId: ids.circuits[circuit], lapTimeMs: ms, recordedAt, notes });

const sql = <T>(q: string, ...p: unknown[]) => sqlite.prepare(q).all(...(p as never[])) as T[];

function activeEvents(circuit: string) {
  return sql<{ sequence: number; event_type: string; new_time_ms: number; previous_time_ms: number | null; new_player: string; previous_player: string | null }>(
    `SELECT e.sequence, e.event_type, e.new_time_ms, e.previous_time_ms, np.slug AS new_player, pp.slug AS previous_player
       FROM record_events e JOIN players np ON np.id = e.new_player_id LEFT JOIN players pp ON pp.id = e.previous_player_id
      WHERE e.circuit_id = ? AND e.superseded_at IS NULL ORDER BY e.sequence`, ids.circuits[circuit]
  ).map((r) => ({ ...r }));
}
const supersededCount = (circuit: string) =>
  sql<{ n: number }>('SELECT count(*) AS n FROM record_events WHERE circuit_id = ? AND superseded_at IS NOT NULL', ids.circuits[circuit])[0]!.n;
const lapCount = () => sql<{ n: number }>('SELECT count(*) AS n FROM lap_entries')[0]!.n;

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  env = { DB: fakeD1(sqlite) };
  pending = [];
  const snap = await api('GET', 'data'); // first request creates the schema
  expect(snap.status).toBe(200);
  ids = {
    players: Object.fromEntries(snap.body.players.map((p: any) => [p.slug, p.id])),
    circuits: Object.fromEntries(snap.body.circuits.map((c: any) => [c.slug, c.id]))
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

describe('setup', () => {
  it('creates the schema on first use with three players and 24 circuits in calendar order', async () => {
    const { body } = await api('GET', 'data');
    expect(body.players.map((p: any) => p.name)).toEqual(['Rag', 'Adam', 'Ben']);
    expect(body.circuits).toHaveLength(24);
    expect(body.circuits[0].slug).toBe('albert-park');
    expect(body.circuits[23].slug).toBe('yas-marina');
    expect(body.circuits[0].is_active).toBe(true);
    expect(body.laps).toEqual([]);
  });

  it('says how to fix it when the D1 binding is missing', async () => {
    env = {};
    const r = await api('GET', 'data');
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/binding named DB/);
  });

  it('only accepts JSON for writes and 404s unknown routes', async () => {
    const res = await handleApi(new Request('https://x.dev/api/laps', { method: 'POST', body: 'a=1',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), env);
    expect(res.status).toBe(415);
    expect((await api('GET', 'nope')).status).toBe(404);
    expect((await api('PATCH', 'laps/abc', {})).status).toBe(404);
  });
});

describe('logging laps and record history', () => {
  it('creates an initial record event for the first lap', async () => {
    const r = await logLap('rag', 'suzuka', 89402, '2026-10-02T20:00:00Z');
    expect(r.outcome).toBe('record');
    expect(r.previous_record_ms).toBeNull();
    expect(activeEvents('suzuka')).toEqual([
      { sequence: 1, event_type: 'initial', new_time_ms: 89402, previous_time_ms: null, new_player: 'rag', previous_player: null }
    ]);
  });

  it('keeps every record change visible: Rag → Adam → Ben', async () => {
    await logLap('rag', 'suzuka', 89402, '2026-10-02T20:00:00Z');
    const a = await logLap('adam', 'suzuka', 89117, '2026-10-09T20:00:00Z');
    const b = await logLap('ben', 'suzuka', 88903, '2026-10-12T20:00:00Z');
    expect(a.outcome).toBe('record');
    expect(b.outcome).toBe('record');
    expect(b.previous_record_ms).toBe(89117);
    expect(activeEvents('suzuka').map((e) => [e.new_player, e.previous_player, e.new_time_ms])).toEqual([
      ['rag', null, 89402], ['adam', 'rag', 89117], ['ben', 'adam', 88903]
    ]);
  });

  it('a slower lap is kept as history but never creates a record event', async () => {
    await logLap('rag', 'monza', 80611, '2026-10-01T20:00:00Z');
    expect((await logLap('adam', 'monza', 81000, '2026-10-02T20:00:00Z')).outcome).toBe('pb');
    expect((await logLap('adam', 'monza', 81200, '2026-10-03T20:00:00Z')).outcome).toBe('lap');
    expect(activeEvents('monza')).toHaveLength(1);
    expect(lapCount()).toBe(3);
  });

  it('an identical time ties the record but does not take it', async () => {
    await logLap('rag', 'spa', 103548, '2026-10-01T20:00:00Z');
    expect((await logLap('adam', 'spa', 103548, '2026-10-02T20:00:00Z')).outcome).toBe('tie_record');
    const ev = activeEvents('spa');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.new_player).toBe('rag');
  });

  it('is idempotent on the client request id (double clicks / retries)', async () => {
    const reqId = '11111111-2222-3333-4444-555555555555';
    const first = await logLap('ben', 'imola', 75044, '2026-10-06T20:00:00Z', reqId);
    const second = await logLap('ben', 'imola', 75044, '2026-10-06T20:00:00Z', reqId);
    expect(second.duplicate).toBe(true);
    expect(second.lap_id).toBe(first.lap_id);
    expect(second.outcome).toBe('record');
    expect(lapCount()).toBe(1);
    expect(activeEvents('imola')).toHaveLength(1);
  });

  it('rebuilds history when a faster lap is back-dated before existing records', async () => {
    await logLap('rag', 'baku', 102877, '2026-09-24T20:00:00Z');
    await logLap('ben', 'baku', 102715, '2026-09-29T20:00:00Z');
    await logLap('adam', 'baku', 102500, '2026-09-20T20:00:00Z'); // logged late, set first
    expect(activeEvents('baku').map((e) => e.new_player)).toEqual(['adam']);
    expect(supersededCount('baku')).toBe(2);
  });

  it('handles laps logged at the same circuit at the same moment', async () => {
    const results = await Promise.all([
      logLap('rag', 'zandvoort', 71000, '2026-10-01T20:00:00Z'),
      logLap('adam', 'zandvoort', 70900, '2026-10-01T20:01:00Z'),
      logLap('ben', 'zandvoort', 70800, '2026-10-01T20:02:00Z'),
      logLap('rag', 'zandvoort', 70700, '2026-10-01T20:03:00Z')
    ]);
    expect(results.every((r) => r.lap_id)).toBe(true);
    expect(lapCount()).toBe(4);
    expect(activeEvents('zandvoort').map((e) => [e.sequence, e.new_time_ms])).toEqual([
      [1, 71000], [2, 70900], [3, 70800], [4, 70700]
    ]);
  });

  it('rejects invalid input', async () => {
    await expect(logLap('rag', 'suzuka', 0, '2026-10-02T20:00:00Z')).rejects.toThrow(/greater than zero/);
    await expect(logLap('rag', 'suzuka', -5, '2026-10-02T20:00:00Z')).rejects.toThrow();
    await expect(logLap('rag', 'suzuka', 89000.5, '2026-10-02T20:00:00Z')).rejects.toThrow();
    await expect(logLap('rag', 'suzuka', 3_600_000, '2026-10-02T20:00:00Z')).rejects.toThrow(/under one hour/);
    await expect(logLap('rag', 'suzuka', 90000, '2999-01-01T00:00:00Z')).rejects.toThrow(/future/);
    await expect(logLap('rag', 'nowhere', 90000, '2026-10-02T20:00:00Z')).rejects.toThrow(/Unknown or inactive circuit/);
    const r = await api('POST', 'laps', { playerId: 'nobody', circuitId: ids.circuits.suzuka, lapTimeMs: 90000, recordedAt: '2026-10-02T20:00:00Z' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Unknown player.');
    expect(lapCount()).toBe(0);
  });

  it('returns laps, record history and the audit trail to the app', async () => {
    await logLap('rag', 'suzuka', 89402, '2026-10-02T20:00:00+01:00');
    const { body } = await api('GET', 'data');
    expect(body.laps).toHaveLength(1);
    expect(body.laps[0].recorded_at).toBe('2026-10-02T19:00:00.000Z');
    expect(body.events).toHaveLength(1);
    expect(body.audit[0].action).toBe('create');
    expect(body.audit[0].outcome).toBe('record');
    expect(body.audit[0].after.lap_time_ms).toBe(89402);
  });
});

describe('corrections and deletions', () => {
  it('deleting the current record restores the previous holder and keeps the original events', async () => {
    await logLap('rag', 'suzuka', 89402, '2026-10-02T20:00:00Z');
    await logLap('adam', 'suzuka', 89117, '2026-10-09T20:00:00Z');
    const ben = await logLap('ben', 'suzuka', 88903, '2026-10-12T20:00:00Z');
    expect((await api('DELETE', `laps/${ben.lap_id}`)).status).toBe(200);
    expect(activeEvents('suzuka').map((e) => e.new_player)).toEqual(['rag', 'adam']);
    expect(supersededCount('suzuka')).toBe(3);
    expect(sql<{ deleted_at: string | null }>('SELECT deleted_at FROM lap_entries WHERE id = ?', ben.lap_id)[0]!.deleted_at).not.toBeNull();
    expect(sql<{ action: string }>('SELECT action FROM lap_audit WHERE lap_entry_id = ? ORDER BY id', ben.lap_id).map((a) => a.action))
      .toEqual(['create', 'delete']);
    const { body } = await api('GET', 'data');
    expect(body.laps).toHaveLength(2);
  });

  it('correcting a mistyped record time recalculates the record', async () => {
    await logLap('rag', 'silverstone', 86871, '2026-10-02T20:00:00Z');
    const typo = await logLap('adam', 'silverstone', 76035, '2026-10-03T20:00:00Z'); // meant 1:27.035
    expect(activeEvents('silverstone').at(-1)!.new_player).toBe('adam');
    expect((await updateLap(typo.lap_id, 'adam', 'silverstone', 87035, '2026-10-03T20:00:00Z')).status).toBe(200);
    expect(activeEvents('silverstone').map((e) => [e.new_player, e.new_time_ms])).toEqual([['rag', 86871]]);
  });

  it('a correction that leaves history unchanged supersedes nothing', async () => {
    const r = await logLap('rag', 'monaco', 71204, '2026-09-25T20:00:00Z');
    await updateLap(r.lap_id, 'rag', 'monaco', 71204, '2026-09-25T20:00:00Z', 'Clean lap');
    expect(supersededCount('monaco')).toBe(0);
    expect(sql<{ notes: string }>('SELECT notes FROM lap_entries WHERE id = ?', r.lap_id)[0]!.notes).toBe('Clean lap');
  });

  it('moving a lap to another circuit rebuilds both circuits', async () => {
    const wrong = await logLap('ben', 'monza', 75000, '2026-10-03T20:00:00Z');
    await updateLap(wrong.lap_id, 'ben', 'imola', 75000, '2026-10-03T20:00:00Z', 'Was logged at Monza by mistake');
    expect(activeEvents('monza')).toHaveLength(0);
    expect(activeEvents('imola').map((e) => e.new_player)).toEqual(['ben']);
  });

  it('cannot edit or delete a lap once deleted', async () => {
    const r = await logLap('rag', 'monaco', 71204, '2026-09-25T20:00:00Z');
    await api('DELETE', `laps/${r.lap_id}`);
    const again = await api('DELETE', `laps/${r.lap_id}`);
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('Lap not found.');
    expect((await updateLap(r.lap_id, 'rag', 'monaco', 71000, '2026-09-25T20:00:00Z')).status).toBe(404);
  });
});

describe('Discord record alerts (optional)', () => {
  it('posts new records only, with the right message', async () => {
    const posts: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(null, { status: 204 });
    }));
    env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';
    await logLap('adam', 'suzuka', 89117, '2026-10-09T20:00:00Z');
    await logLap('ben', 'suzuka', 88903, '2026-10-12T20:00:00Z');
    await logLap('rag', 'suzuka', 89500, '2026-10-12T21:00:00Z'); // not a record: no post
    await Promise.all(pending);
    expect(posts).toHaveLength(2);
    expect(posts[0].body.embeds[0].description).toBe('**Adam** sets **1:29.117**\nFirst record at this circuit');
    const embed = posts[1].body.embeds[0];
    expect(posts[1].url).toBe('https://discord.com/api/webhooks/test');
    expect(embed.title).toBe('🏁 New record · Suzuka');
    expect(embed.description).toBe('**Ben** sets **1:28.903**\nTakes it from **Adam** (1:29.117) by **0.214s**');
    expect(embed.color).toBe(0x35c878);
    expect(embed.url).toBe('https://f1-bricks.pages.dev/circuits/suzuka');
    expect(embed.footer.text).toBe('Round 03 · Japan');
  });

  it('a failed post never stops a lap being saved, and nothing is sent without a webhook', async () => {
    const f = vi.fn(async () => { throw new Error('Discord is down'); });
    vi.stubGlobal('fetch', f);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await logLap('rag', 'monza', 80611, '2026-10-01T20:00:00Z');
    expect(f).not.toHaveBeenCalled();
    env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';
    const r = await logLap('ben', 'monza', 80000, '2026-10-02T20:00:00Z');
    await Promise.all(pending);
    expect(r.outcome).toBe('record');
    expect(f).toHaveBeenCalledTimes(1);
    expect(lapCount()).toBe(2);
  });
});
