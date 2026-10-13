/**
 * DEMO BACKEND — local development only (VITE_DEMO_MODE=true).
 * Fictional sample laps kept in browser memory. Nothing here is ever written
 * to the database, and the UI shows a "Demo data" banner whenever it is active.
 */
import type { Backend, LogLapInput, Snapshot, UpdateLapInput } from '../lib/backend';
import { deriveRecordHistory, fastestLap } from '../lib/records';
import type { AuditEntry, AuditSnapshot, Circuit, Lap, LogLapResult, Player, RecordEvent } from '../lib/types';

const PLAYERS: Player[] = [
  { id: 'demo-rag', slug: 'rag', name: 'Rag', colour_hex: '#35C878', display_order: 1 },
  { id: 'demo-adam', slug: 'adam', name: 'Adam', colour_hex: '#398BFF', display_order: 2 },
  { id: 'demo-ben', slug: 'ben', name: 'Ben', colour_hex: '#FF8A24', display_order: 3 }
];

// Mirrors the reference data in server/schema.ts for demo purposes.
const CIRCUIT_ROWS: [string, string, string, string, string, number | null][] = [
  ['albert-park', 'Albert Park Circuit', 'Albert Park', 'AUS', 'Australia', 76000],
  ['shanghai', 'Shanghai International Circuit', 'Shanghai', 'CHN', 'China', 91800],
  ['suzuka', 'Suzuka International Racing Course', 'Suzuka', 'JPN', 'Japan', 88900],
  ['bahrain', 'Bahrain International Circuit', 'Bahrain', 'BHR', 'Bahrain', 89600],
  ['jeddah', 'Jeddah Corniche Circuit', 'Jeddah', 'KSA', 'Saudi Arabia', 88400],
  ['miami', 'Miami International Autodrome', 'Miami', 'MIA', 'United States', 87600],
  ['imola', 'Autodromo Enzo e Dino Ferrari', 'Imola', 'IMO', 'Italy', 75000],
  ['monaco', 'Circuit de Monaco', 'Monaco', 'MON', 'Monaco', 71200],
  ['barcelona', 'Circuit de Barcelona-Catalunya', 'Barcelona', 'ESP', 'Spain', 72800],
  ['montreal', 'Circuit Gilles Villeneuve', 'Montréal', 'CAN', 'Canada', 72100],
  ['red-bull-ring', 'Red Bull Ring', 'Red Bull Ring', 'AUT', 'Austria', 64600],
  ['silverstone', 'Silverstone Circuit', 'Silverstone', 'GBR', 'Great Britain', 86800],
  ['spa', 'Circuit de Spa-Francorchamps', 'Spa', 'BEL', 'Belgium', 103500],
  ['hungaroring', 'Hungaroring', 'Hungaroring', 'HUN', 'Hungary', 76100],
  ['zandvoort', 'Circuit Zandvoort', 'Zandvoort', 'NED', 'Netherlands', 70900],
  ['monza', 'Autodromo Nazionale Monza', 'Monza', 'ITA', 'Italy', 80400],
  ['baku', 'Baku City Circuit', 'Baku', 'AZE', 'Azerbaijan', 102700],
  ['marina-bay', 'Marina Bay Street Circuit', 'Marina Bay', 'SGP', 'Singapore', 95100],
  ['cota', 'Circuit of the Americas', 'COTA', 'USA', 'United States', 93200],
  ['mexico-city', 'Autódromo Hermanos Rodríguez', 'Mexico City', 'MEX', 'Mexico', 76000],
  ['interlagos', 'Autódromo José Carlos Pace', 'Interlagos', 'BRA', 'Brazil', 70400],
  ['las-vegas', 'Las Vegas Strip Circuit', 'Las Vegas', 'LVG', 'United States', 92800],
  ['lusail', 'Lusail International Circuit', 'Lusail', 'QAT', 'Qatar', 80500],
  ['yas-marina', 'Yas Marina Circuit', 'Yas Marina', 'ABU', 'Abu Dhabi', 83500]
];

const CIRCUITS: Circuit[] = CIRCUIT_ROWS.map(([slug, name, short_name, code, country], i) => ({
  id: `demo-c-${slug}`, slug, name, short_name, code, country, display_order: i + 1, is_active: true
}));

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function buildLaps(): Lap[] {
  const rnd = seeded(25);
  const laps: Lap[] = [];
  const start = Date.parse('2026-08-01T19:00:00Z');
  let n = 0;
  CIRCUIT_ROWS.forEach(([slug, , , , , base], ci) => {
    if (base === null) return;
    PLAYERS.forEach((p, pi) => {
      // Skip a few player/circuit combinations so missing times show up.
      if ((ci + pi * 7) % 11 === 5) return;
      const attempts = 1 + Math.floor(rnd() * 4);
      let t = base + 300 + Math.floor(rnd() * 900);
      for (let a = 0; a < attempts; a++) {
        const when = start + Math.floor((ci * 1.7 + a * 3 + pi + rnd() * 2) * 86400000);
        if (when > Date.now()) continue;
        t = Math.max(base - 150, t - Math.floor(rnd() * 400) + (a > 0 && rnd() < 0.3 ? 250 : 0));
        n++;
        const iso = new Date(when).toISOString();
        laps.push({ id: `demo-lap-${String(n).padStart(4, '0')}`, player_id: p.id, circuit_id: `demo-c-${slug}`,
          lap_time_ms: t, recorded_at: iso, created_at: iso, notes: null });
      }
    });
  });
  return laps;
}

function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

export function demoBackend(): Backend {
  let laps = buildLaps();
  const deleted = new Map<string, Lap>();
  let events: RecordEvent[] = [];
  const audit: AuditEntry[] = [];
  const requestIds = new Map<string, LogLapResult>();
  const listeners = new Set<() => void>();
  let auditId = 0;

  const snap = (l: Lap): AuditSnapshot => ({ player_id: l.player_id, circuit_id: l.circuit_id, lap_time_ms: l.lap_time_ms,
    recorded_at: l.recorded_at, notes: l.notes, deleted_at: null });

  function rebuild(circuitId: string, reason: string) {
    const derived = deriveRecordHistory(laps.filter((l) => l.circuit_id === circuitId));
    const active = events.filter((e) => e.circuit_id === circuitId && !e.superseded_at).sort((a, b) => a.sequence - b.sequence);
    const isPrefix = active.every((e, i) => {
      const d = derived[i];
      return d && d.lap.id === e.new_lap_entry_id && d.lap.lap_time_ms === e.new_time_ms &&
        d.lap.recorded_at === e.achieved_at && (d.previous?.id ?? null) === e.previous_lap_entry_id;
    });
    const now = new Date().toISOString();
    let keep = active.length;
    if (!isPrefix) {
      events = events.map((e) => (e.circuit_id === circuitId && !e.superseded_at ? { ...e, superseded_at: now, superseded_reason: reason } : e));
      keep = 0;
    }
    for (const d of derived.slice(keep)) {
      events.push({
        id: uuid(), circuit_id: circuitId, sequence: d.sequence, event_type: d.type,
        previous_lap_entry_id: d.previous?.id ?? null, new_lap_entry_id: d.lap.id,
        previous_time_ms: d.previous?.lap_time_ms ?? null, new_time_ms: d.lap.lap_time_ms,
        previous_player_id: d.previous?.player_id ?? null, new_player_id: d.lap.player_id,
        achieved_at: d.lap.recorded_at, created_at: now, superseded_at: null, superseded_reason: null
      });
    }
  }

  CIRCUITS.forEach((c) => rebuild(c.id, 'initial load'));
  [...laps].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at)).slice(-25).forEach((l) => {
    audit.unshift({ id: ++auditId, lap_entry_id: l.id, action: 'create', outcome: null, at: l.recorded_at, before: null, after: snap(l) });
  });

  const notify = () => listeners.forEach((fn) => fn());
  const delay = () => new Promise((r) => setTimeout(r, 250));

  return {
    async load(): Promise<Snapshot> {
      await delay();
      return { players: PLAYERS, circuits: CIRCUITS, laps: [...laps], events: [...events], audit: [...audit] };
    },

    async logLap(i: LogLapInput) {
      await delay();
      const dup = requestIds.get(i.clientRequestId);
      if (dup) return { ...dup, duplicate: true };
      const here = laps.filter((l) => l.circuit_id === i.circuitId);
      const rec = fastestLap(here);
      const pb = fastestLap(here.filter((l) => l.player_id === i.playerId));
      const now = new Date().toISOString();
      const lap: Lap = { id: uuid(), player_id: i.playerId, circuit_id: i.circuitId, lap_time_ms: i.lapTimeMs,
        recorded_at: i.recordedAt, created_at: now, notes: i.notes };
      laps.push(lap);
      rebuild(i.circuitId, 'lap logged');
      const outcome = !rec || i.lapTimeMs < rec.lap_time_ms ? 'record'
        : i.lapTimeMs === rec.lap_time_ms ? 'tie_record'
        : !pb || i.lapTimeMs < pb.lap_time_ms ? 'pb' : 'lap';
      const result: LogLapResult = { lap_id: lap.id, outcome, previous_record_ms: rec?.lap_time_ms ?? null,
        previous_record_player_id: rec?.player_id ?? null, previous_pb_ms: pb?.lap_time_ms ?? null, duplicate: false };
      requestIds.set(i.clientRequestId, result);
      audit.unshift({ id: ++auditId, lap_entry_id: lap.id, action: 'create', outcome, at: now, before: null,
        after: { ...snap(lap), previous_record_ms: result.previous_record_ms, previous_record_player_id: result.previous_record_player_id } });
      notify();
      return result;
    },

    async updateLap(i: UpdateLapInput) {
      await delay();
      const old = laps.find((l) => l.id === i.lapId);
      if (!old) throw new Error('Lap not found.');
      const updated: Lap = { ...old, player_id: i.playerId, circuit_id: i.circuitId, lap_time_ms: i.lapTimeMs,
        recorded_at: i.recordedAt, notes: i.notes };
      laps = laps.map((l) => (l.id === i.lapId ? updated : l));
      rebuild(old.circuit_id, 'lap corrected');
      if (old.circuit_id !== i.circuitId) rebuild(i.circuitId, 'lap corrected');
      audit.unshift({ id: ++auditId, lap_entry_id: i.lapId, action: 'update', outcome: null, at: new Date().toISOString(),
        before: snap(old), after: snap(updated) });
      notify();
    },

    async deleteLap(lapId: string) {
      await delay();
      const old = laps.find((l) => l.id === lapId);
      if (!old) throw new Error('Lap not found.');
      laps = laps.filter((l) => l.id !== lapId);
      deleted.set(lapId, old);
      rebuild(old.circuit_id, 'lap deleted');
      audit.unshift({ id: ++auditId, lap_entry_id: lapId, action: 'delete', outcome: null, at: new Date().toISOString(),
        before: snap(old), after: { ...snap(old), deleted_at: new Date().toISOString() } });
      notify();
    },

    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    }
  };
}

