/**
 * F1 Bricks API: runs as a Cloudflare Pages Function (functions/api/[[route]].ts)
 * against a D1 database bound as `DB`.
 *
 *   GET    /api/data       everything the app shows (players, circuits, laps,
 *                          record history, recent audit trail)
 *   POST   /api/laps       log a lap
 *   PUT    /api/laps/:id   correct a lap
 *   DELETE /api/laps/:id   delete a lap (soft delete)
 *
 * RECORD RULES (shared with the app through src/lib/records.ts):
 *   * Laps are replayed in achievement order: recorded_at, then created_at, then id.
 *   * A lap takes the record only if it is STRICTLY faster than every earlier
 *     lap. Equal times never take a record: the earlier lap keeps it.
 *   * Every write saves the lap, its audit entry and the circuit's record
 *     history in ONE D1 batch (a transaction), so they can never disagree.
 *   * Concurrent writes at one circuit are caught by claiming the circuit's next
 *     revision number inside that batch; the loser re-reads and retries.
 */
import { formatLapTime, formatSeconds } from '../src/lib/laptime';
import { deriveRecordHistory, fastestLap } from '../src/lib/records';
import type { AuditEntry, AuditSnapshot, Circuit, Lap, LapOutcome, LogLapResult, Player, RecordEvent } from '../src/lib/types';
import { SCHEMA, SCHEMA_VERSION } from './schema';

// ---------------------------------------------------------------------------
// The slice of Cloudflare's D1 API this file uses (kept local so the project
// doesn't need Cloudflare's type package).
// ---------------------------------------------------------------------------
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<unknown[]>;
}
export interface Env {
  DB?: D1Like;
  /** Optional: a Discord webhook URL. When set, new records are posted there. */
  DISCORD_WEBHOOK_URL?: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Schema: created automatically the first time the API meets an empty database.
// ---------------------------------------------------------------------------
const schemaReady = new WeakMap<D1Like, Promise<void>>();

function ensureSchema(db: D1Like): Promise<void> {
  let p = schemaReady.get(db);
  if (!p) {
    p = (async () => {
      try {
        const r = await db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).first<{ value: string }>();
        if (r?.value === SCHEMA_VERSION) return;
      } catch {
        // No meta table yet: a brand-new database.
      }
      for (const sql of SCHEMA) await db.prepare(sql).run();
    })();
    p.catch(() => schemaReady.delete(db));
    schemaReady.set(db, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
const LAP_COLUMNS = 'id, player_id, circuit_id, lap_time_ms, recorded_at, created_at, notes';

async function loadSnapshot(db: D1Like) {
  const [players, circuits, laps, events, audit] = await Promise.all([
    db.prepare('SELECT id, slug, name, colour_hex, display_order FROM players ORDER BY display_order').all<Player>(),
    db.prepare(`SELECT id, slug, name, short_name, code, country, display_order, is_active
                FROM circuits WHERE is_active = 1 ORDER BY display_order`).all<Omit<Circuit, 'is_active'> & { is_active: number }>(),
    db.prepare(`SELECT ${LAP_COLUMNS} FROM lap_entries WHERE deleted_at IS NULL ORDER BY recorded_at, id`).all<Lap>(),
    db.prepare('SELECT * FROM record_events ORDER BY achieved_at, sequence').all<RecordEvent>(),
    db.prepare(`SELECT id, lap_entry_id, action, outcome, at, before, after FROM lap_audit ORDER BY id DESC LIMIT 60`)
      .all<Omit<AuditEntry, 'before' | 'after'> & { before: string | null; after: string | null }>()
  ]);
  return {
    players: players.results,
    circuits: circuits.results.map((c) => ({ ...c, is_active: c.is_active === 1 })),
    laps: laps.results,
    events: events.results,
    audit: audit.results.map((a) => ({
      ...a,
      before: a.before ? (JSON.parse(a.before) as AuditSnapshot) : null,
      after: a.after ? (JSON.parse(a.after) as AuditSnapshot) : null
    }))
  };
}

interface CircuitState {
  laps: Lap[];
  active: RecordEvent[];
  rev: number;
}

async function circuitState(db: D1Like, circuitId: string): Promise<CircuitState> {
  const [laps, active, rev] = await Promise.all([
    db.prepare(`SELECT ${LAP_COLUMNS} FROM lap_entries WHERE circuit_id = ? AND deleted_at IS NULL`).bind(circuitId).all<Lap>(),
    db.prepare('SELECT * FROM record_events WHERE circuit_id = ? AND superseded_at IS NULL ORDER BY sequence')
      .bind(circuitId).all<RecordEvent>(),
    db.prepare('SELECT COALESCE(MAX(rev), 0) AS rev FROM circuit_revisions WHERE circuit_id = ?').bind(circuitId).first<{ rev: number }>()
  ]);
  return { laps: laps.results, active: active.results, rev: rev?.rev ?? 0 };
}

const claimRevision = (db: D1Like, circuitId: string, st: CircuitState) =>
  db.prepare('INSERT INTO circuit_revisions (circuit_id, rev) VALUES (?, ?)').bind(circuitId, st.rev + 1);

// ---------------------------------------------------------------------------
// Record history rebuild for one circuit, given its laps AFTER the change.
//   * If the current active history is a prefix of the derived history (the
//     normal case: a new record was appended) only the new events are added.
//   * Otherwise (a correction or deletion changed the past) every active event
//     is marked superseded — kept, not deleted — and the full derived history
//     becomes the new active history.
// ---------------------------------------------------------------------------
function planRecordHistory(db: D1Like, circuitId: string, laps: Lap[], active: RecordEvent[], reason: string, now: string): D1Stmt[] {
  const derived = deriveRecordHistory(laps);
  const isPrefix = active.length <= derived.length && active.every((e, i) => {
    const d = derived[i];
    return !!d && d.sequence === e.sequence && d.lap.id === e.new_lap_entry_id && d.lap.lap_time_ms === e.new_time_ms &&
      d.lap.recorded_at === e.achieved_at && d.lap.player_id === e.new_player_id &&
      (d.previous?.id ?? null) === e.previous_lap_entry_id;
  });
  const stmts: D1Stmt[] = [];
  let keep = active.length;
  if (!isPrefix) {
    stmts.push(db.prepare(`UPDATE record_events SET superseded_at = ?, superseded_reason = ?
                           WHERE circuit_id = ? AND superseded_at IS NULL`).bind(now, reason, circuitId));
    keep = 0;
  }
  for (const d of derived.slice(keep)) {
    stmts.push(db.prepare(`INSERT INTO record_events (id, circuit_id, sequence, event_type, previous_lap_entry_id, new_lap_entry_id,
                             previous_time_ms, new_time_ms, previous_player_id, new_player_id, achieved_at, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), circuitId, d.sequence, d.type, d.previous?.id ?? null, d.lap.id,
        d.previous?.lap_time_ms ?? null, d.lap.lap_time_ms, d.previous?.player_id ?? null, d.lap.player_id,
        d.lap.recorded_at, now));
  }
  return stmts;
}

function isConflict(e: unknown): boolean {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_(PRIMARYKEY|UNIQUE)/i.test(String((e as Error)?.message ?? e));
}

/** Runs a read-then-write step, retrying if another write got in first. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isConflict(e)) throw e;
      if (attempt >= 4) throw new HttpError(409, 'Someone else saved a lap at the same moment. Try again.');
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
    }
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
interface LapInput {
  playerId: string;
  circuitId: string;
  lapTimeMs: number;
  recordedAt: string;
  notes: string | null;
}

function parseLapInput(body: Record<string, unknown>): LapInput {
  const { playerId, circuitId, lapTimeMs, recordedAt, notes } = body;
  if (typeof playerId !== 'string' || !playerId) throw new HttpError(400, 'Unknown player.');
  if (typeof circuitId !== 'string' || !circuitId) throw new HttpError(400, 'Unknown or inactive circuit.');
  if (typeof lapTimeMs !== 'number' || !Number.isInteger(lapTimeMs) || lapTimeMs <= 0 || lapTimeMs >= 3_600_000) {
    throw new HttpError(400, 'Lap time must be greater than zero and under one hour.');
  }
  const t = typeof recordedAt === 'string' ? Date.parse(recordedAt) : NaN;
  if (Number.isNaN(t)) throw new HttpError(400, 'The time the lap was set is required.');
  // Allow a little clock skew between devices, but not laps from the future.
  if (t > Date.now() + 10 * 60_000) throw new HttpError(400, 'A lap cannot be set in the future.');
  const n = typeof notes === 'string' ? notes.trim() : '';
  if (n.length > 500) throw new HttpError(400, 'Notes must be 500 characters or fewer.');
  return { playerId, circuitId, lapTimeMs, recordedAt: new Date(t).toISOString(), notes: n || null };
}

async function checkReferences(db: D1Like, i: LapInput) {
  const [p, c] = await Promise.all([
    db.prepare('SELECT 1 AS ok FROM players WHERE id = ?').bind(i.playerId).first(),
    db.prepare('SELECT 1 AS ok FROM circuits WHERE id = ? AND is_active = 1').bind(i.circuitId).first()
  ]);
  if (!p) throw new HttpError(400, 'Unknown player.');
  if (!c) throw new HttpError(400, 'Unknown or inactive circuit.');
}

const snapshotOf = (l: Lap, deletedAt: string | null = null): AuditSnapshot => ({
  player_id: l.player_id, circuit_id: l.circuit_id, lap_time_ms: l.lap_time_ms,
  recorded_at: l.recorded_at, notes: l.notes, deleted_at: deletedAt
});

const auditInsert = (db: D1Like, lapId: string, action: AuditEntry['action'], outcome: LapOutcome | null,
  before: AuditSnapshot | null, after: AuditSnapshot | null, at: string) =>
  db.prepare('INSERT INTO lap_audit (lap_entry_id, action, outcome, at, before, after) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(lapId, action, outcome, at, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);

async function getLiveLap(db: D1Like, id: string): Promise<Lap> {
  const lap = await db.prepare(`SELECT ${LAP_COLUMNS} FROM lap_entries WHERE id = ? AND deleted_at IS NULL`).bind(id).first<Lap>();
  if (!lap) throw new HttpError(404, 'Lap not found.');
  return lap;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
async function findDuplicate(db: D1Like, requestId: string): Promise<LogLapResult | null> {
  const row = await db.prepare(`SELECT a.lap_entry_id, a.outcome, a.after FROM lap_entries l
                                JOIN lap_audit a ON a.lap_entry_id = l.id AND a.action = 'create'
                                WHERE l.client_request_id = ?`).bind(requestId)
    .first<{ lap_entry_id: string; outcome: LapOutcome; after: string }>();
  if (!row) return null;
  const after = JSON.parse(row.after) as AuditSnapshot;
  return {
    lap_id: row.lap_entry_id, outcome: row.outcome,
    previous_record_ms: after.previous_record_ms ?? null,
    previous_record_player_id: after.previous_record_player_id ?? null,
    previous_pb_ms: after.previous_pb_ms ?? null,
    duplicate: true
  };
}

interface NewRecord {
  circuitId: string;
  lap: Lap;
  previous: Lap | null;
}

async function logLap(db: D1Like, body: Record<string, unknown>): Promise<{ result: LogLapResult; record: NewRecord | null }> {
  const input = parseLapInput(body);
  const requestId = typeof body.clientRequestId === 'string' && body.clientRequestId ? body.clientRequestId.slice(0, 64) : null;
  return withRetry(async () => {
    if (requestId) {
      const dup = await findDuplicate(db, requestId);
      if (dup) return { result: dup, record: null };
    }
    await checkReferences(db, input);
    const st = await circuitState(db, input.circuitId);
    const rec = fastestLap(st.laps);
    const pb = fastestLap(st.laps.filter((l) => l.player_id === input.playerId));
    const now = nowIso();
    const lap: Lap = {
      id: crypto.randomUUID(), player_id: input.playerId, circuit_id: input.circuitId,
      lap_time_ms: input.lapTimeMs, recorded_at: input.recordedAt, created_at: now, notes: input.notes
    };
    const outcome: LapOutcome = !rec || lap.lap_time_ms < rec.lap_time_ms ? 'record'
      : lap.lap_time_ms === rec.lap_time_ms ? 'tie_record'
      : !pb || lap.lap_time_ms < pb.lap_time_ms ? 'pb' : 'lap';
    const lapsAfter = [...st.laps, lap];
    await db.batch([
      claimRevision(db, input.circuitId, st),
      db.prepare(`INSERT INTO lap_entries (id, player_id, circuit_id, lap_time_ms, recorded_at, created_at, updated_at, notes, client_request_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(lap.id, lap.player_id, lap.circuit_id, lap.lap_time_ms, lap.recorded_at, now, now, lap.notes, requestId),
      ...planRecordHistory(db, input.circuitId, lapsAfter, st.active, 'lap logged', now),
      auditInsert(db, lap.id, 'create', outcome, null, {
        ...snapshotOf(lap),
        previous_record_ms: rec?.lap_time_ms ?? null,
        previous_record_player_id: rec?.player_id ?? null,
        previous_pb_ms: pb?.lap_time_ms ?? null
      }, now)
    ]);
    const event = deriveRecordHistory(lapsAfter).find((e) => e.lap.id === lap.id);
    return {
      result: {
        lap_id: lap.id, outcome,
        previous_record_ms: rec?.lap_time_ms ?? null,
        previous_record_player_id: rec?.player_id ?? null,
        previous_pb_ms: pb?.lap_time_ms ?? null,
        duplicate: false
      },
      record: outcome === 'record' && event ? { circuitId: input.circuitId, lap, previous: event.previous } : null
    };
  });
}

async function updateLap(db: D1Like, lapId: string, body: Record<string, unknown>) {
  const input = parseLapInput(body);
  await withRetry(async () => {
    const old = await getLiveLap(db, lapId);
    await checkReferences(db, input);
    const now = nowIso();
    const updated: Lap = { ...old, player_id: input.playerId, circuit_id: input.circuitId,
      lap_time_ms: input.lapTimeMs, recorded_at: input.recordedAt, notes: input.notes };
    const circuitIds = [...new Set([old.circuit_id, input.circuitId])];
    const states = await Promise.all(circuitIds.map((c) => circuitState(db, c)));
    await db.batch([
      ...circuitIds.map((c, i) => claimRevision(db, c, states[i]!)),
      db.prepare(`UPDATE lap_entries SET player_id = ?, circuit_id = ?, lap_time_ms = ?, recorded_at = ?, notes = ?, updated_at = ?
                  WHERE id = ? AND deleted_at IS NULL`)
        .bind(updated.player_id, updated.circuit_id, updated.lap_time_ms, updated.recorded_at, updated.notes, now, lapId),
      ...circuitIds.flatMap((c, i) => {
        const laps = states[i]!.laps.filter((l) => l.id !== lapId);
        if (c === updated.circuit_id) laps.push(updated);
        return planRecordHistory(db, c, laps, states[i]!.active, 'lap corrected', now);
      }),
      auditInsert(db, lapId, 'update', null, snapshotOf(old), snapshotOf(updated), now)
    ]);
  });
}

async function deleteLap(db: D1Like, lapId: string) {
  await withRetry(async () => {
    const old = await getLiveLap(db, lapId);
    const st = await circuitState(db, old.circuit_id);
    const now = nowIso();
    await db.batch([
      claimRevision(db, old.circuit_id, st),
      db.prepare('UPDATE lap_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').bind(now, now, lapId),
      ...planRecordHistory(db, old.circuit_id, st.laps.filter((l) => l.id !== lapId), st.active, 'lap deleted', now),
      auditInsert(db, lapId, 'delete', null, snapshotOf(old), snapshotOf(old, now), now)
    ]);
  });
}

// ---------------------------------------------------------------------------
// Discord record alert (optional)
// ---------------------------------------------------------------------------
export async function recordMessage(db: D1Like, rec: NewRecord, siteUrl: string) {
  const [c, np, pp] = await Promise.all([
    db.prepare('SELECT slug, short_name, country, display_order FROM circuits WHERE id = ?').bind(rec.circuitId)
      .first<{ slug: string; short_name: string; country: string | null; display_order: number }>(),
    db.prepare('SELECT name, colour_hex FROM players WHERE id = ?').bind(rec.lap.player_id).first<{ name: string; colour_hex: string }>(),
    rec.previous
      ? db.prepare('SELECT name FROM players WHERE id = ?').bind(rec.previous.player_id).first<{ name: string }>()
      : Promise.resolve(null)
  ]);
  if (!c || !np) return null;
  let description = `**${np.name}** sets **${formatLapTime(rec.lap.lap_time_ms)}**`;
  description += rec.previous
    ? `\nTakes it from **${pp?.name ?? '?'}** (${formatLapTime(rec.previous.lap_time_ms)}) by **${formatSeconds(rec.previous.lap_time_ms - rec.lap.lap_time_ms)}s**`
    : '\nFirst record at this circuit';
  return {
    username: 'F1 Bricks',
    embeds: [{
      title: `🏁 New record · ${c.short_name}`,
      description,
      color: parseInt(np.colour_hex.slice(1), 16),
      url: `${siteUrl.replace(/\/$/, '')}/circuits/${c.slug}`,
      footer: { text: `Round ${String(c.display_order).padStart(2, '0')} · ${c.country ?? ''}` },
      timestamp: rec.lap.recorded_at
    }]
  };
}

async function sendDiscord(db: D1Like, webhook: string, rec: NewRecord, siteUrl: string) {
  try {
    const body = await recordMessage(db, rec, siteUrl);
    if (!body) return;
    const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) console.warn(`Discord alert not sent: HTTP ${res.status}`);
  } catch (e) {
    console.warn('Discord alert not sent:', e);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function readJson(request: Request): Promise<Record<string, unknown>> {
  // Requiring JSON means other websites can't submit to this API from a
  // visitor's browser (that would need a CORS preflight, which is refused).
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) {
    throw new HttpError(415, 'Expected JSON.');
  }
  try {
    const b = await request.json();
    if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'Expected a JSON object.');
}

export async function handleApi(request: Request, env: Env, waitUntil: (p: Promise<unknown>) => void = () => {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const method = request.method.toUpperCase();
  try {
    const db = env.DB;
    if (!db) {
      throw new HttpError(503, 'The database isn’t connected yet. In Cloudflare: your Pages project → Settings → Bindings → add a D1 database binding named DB, then redeploy.');
    }
    await ensureSchema(db);

    if (path === 'data' && method === 'GET') return json(200, await loadSnapshot(db));

    if (path === 'laps' && method === 'POST') {
      const { result, record } = await logLap(db, await readJson(request));
      const webhook = env.DISCORD_WEBHOOK_URL?.trim();
      if (record && webhook) waitUntil(sendDiscord(db, webhook, record, url.origin));
      return json(200, result);
    }

    const m = /^laps\/([A-Za-z0-9-]{1,64})$/.exec(path);
    if (m && method === 'PUT') {
      await updateLap(db, m[1]!, await readJson(request));
      return json(200, { lap_id: m[1] });
    }
    if (m && method === 'DELETE') {
      await deleteLap(db, m[1]!);
      return json(200, { lap_id: m[1] });
    }
    return json(404, { error: 'Not found.' });
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: 'Something went wrong on the server. Try again.' });
  }
}
