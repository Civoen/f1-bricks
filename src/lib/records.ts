/**
 * Record and personal-best rules. The API (server/api.ts) uses these same
 * functions to maintain record history, so the app and the database always agree.
 *
 *  1. The fastest lap is the lowest integer millisecond value.
 *  2. Laps are replayed in achievement order: recorded_at, then created_at,
 *     then id. This is also the tie-break: when two laps have identical times
 *     the one achieved first holds the record (or PB). An identical time
 *     never "beats" another.
 *  3. Missing times are absent, never zero.
 */
import type { Circuit, Lap, Player } from './types';

export function achievementOrder(a: Lap, b: Lap): number {
  if (a.recorded_at !== b.recorded_at) return Date.parse(a.recorded_at) - Date.parse(b.recorded_at);
  if (a.created_at !== b.created_at) return Date.parse(a.created_at) - Date.parse(b.created_at);
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Fastest lap; ties go to the lap achieved first. */
export function fastestLap(laps: readonly Lap[]): Lap | null {
  let best: Lap | null = null;
  for (const lap of laps) {
    if (!best || lap.lap_time_ms < best.lap_time_ms ||
        (lap.lap_time_ms === best.lap_time_ms && achievementOrder(lap, best) < 0)) {
      best = lap;
    }
  }
  return best;
}

export interface DerivedRecordEvent {
  sequence: number;
  type: 'initial' | 'broken';
  lap: Lap;
  previous: Lap | null;
  /** previous.lap_time_ms - lap.lap_time_ms, in ms (positive). */
  improvementMs: number | null;
}

/** Record history for one circuit's laps, oldest first. */
export function deriveRecordHistory(laps: readonly Lap[]): DerivedRecordEvent[] {
  const ordered = [...laps].sort(achievementOrder);
  const events: DerivedRecordEvent[] = [];
  let current: Lap | null = null;
  for (const lap of ordered) {
    if (!current || lap.lap_time_ms < current.lap_time_ms) {
      events.push({
        sequence: events.length + 1,
        type: current ? 'broken' : 'initial',
        lap,
        previous: current,
        improvementMs: current ? current.lap_time_ms - lap.lap_time_ms : null
      });
      current = lap;
    }
  }
  return events;
}

export interface LapAnnotation {
  /** Strictly faster than the player's earlier laps here (first lap counts). */
  pbAtTime: boolean;
  /** Improved on an existing PB (excludes a player's first lap at a circuit). */
  pbImprovement: boolean;
  /** Set a new circuit record when achieved. */
  recordAtTime: boolean;
}

/** Replays every lap to say whether it was a PB / record when it was set. */
export function annotateLaps(laps: readonly Lap[]): Map<string, LapAnnotation> {
  const out = new Map<string, LapAnnotation>();
  const ordered = [...laps].sort(achievementOrder);
  const circuitBest = new Map<string, number>();
  const playerBest = new Map<string, number>();
  for (const lap of ordered) {
    const pk = `${lap.player_id}|${lap.circuit_id}`;
    const prevPb = playerBest.get(pk);
    const prevRec = circuitBest.get(lap.circuit_id);
    const pbAtTime = prevPb === undefined || lap.lap_time_ms < prevPb;
    const recordAtTime = prevRec === undefined || lap.lap_time_ms < prevRec;
    out.set(lap.id, { pbAtTime, pbImprovement: prevPb !== undefined && lap.lap_time_ms < prevPb, recordAtTime });
    if (pbAtTime) playerBest.set(pk, lap.lap_time_ms);
    if (recordAtTime) circuitBest.set(lap.circuit_id, lap.lap_time_ms);
  }
  return out;
}

export interface Standing {
  player: Player;
  position: number;
  lap: Lap | null;
  /** Gap to the circuit leader in ms; 0 for the leader; null when no time. */
  gapMs: number | null;
  /** True when this time equals the leader's but was set later. */
  tiedWithLeader: boolean;
}

export interface CircuitSummary {
  circuit: Circuit;
  laps: Lap[];
  record: Lap | null;
  /** One entry per player, fastest first; players without a time last. */
  standings: Standing[];
  lapCount: number;
  playersWithTimes: number;
  allThreeSet: boolean;
  /** P1 to last-placed gap when at least two players have times. */
  spreadMs: number | null;
  history: DerivedRecordEvent[];
  lastRecordAt: string | null;
}

export function summariseCircuit(circuit: Circuit, circuitLaps: Lap[], players: readonly Player[]): CircuitSummary {
  const pbs = players.map((player) => ({
    player,
    lap: fastestLap(circuitLaps.filter((l) => l.player_id === player.id))
  }));
  const withTime = pbs
    .filter((p): p is { player: Player; lap: Lap } => p.lap !== null)
    .sort((a, b) => a.lap.lap_time_ms - b.lap.lap_time_ms || achievementOrder(a.lap, b.lap));
  const leader = withTime[0]?.lap ?? null;
  const standings: Standing[] = [
    ...withTime.map((p, i) => ({
      player: p.player,
      position: i + 1,
      lap: p.lap,
      gapMs: leader ? p.lap.lap_time_ms - leader.lap_time_ms : null,
      tiedWithLeader: i > 0 && leader !== null && p.lap.lap_time_ms === leader.lap_time_ms
    })),
    ...pbs
      .filter((p) => p.lap === null)
      .sort((a, b) => a.player.display_order - b.player.display_order)
      .map((p) => ({ player: p.player, position: 0, lap: null, gapMs: null, tiedWithLeader: false }))
  ];
  const history = deriveRecordHistory(circuitLaps);
  const last = withTime[withTime.length - 1];
  return {
    circuit,
    laps: circuitLaps,
    record: leader,
    standings,
    lapCount: circuitLaps.length,
    playersWithTimes: withTime.length,
    allThreeSet: withTime.length === players.length && players.length > 0,
    spreadMs: withTime.length >= 2 && leader && last ? last.lap.lap_time_ms - leader.lap_time_ms : null,
    history,
    lastRecordAt: history.length ? history[history.length - 1]!.lap.recorded_at : null
  };
}

export function summariseAll(circuits: readonly Circuit[], laps: readonly Lap[], players: readonly Player[]): CircuitSummary[] {
  const byCircuit = new Map<string, Lap[]>();
  for (const lap of laps) {
    const list = byCircuit.get(lap.circuit_id);
    if (list) list.push(lap);
    else byCircuit.set(lap.circuit_id, [lap]);
  }
  return [...circuits]
    .sort((a, b) => a.display_order - b.display_order)
    .map((c) => summariseCircuit(c, byCircuit.get(c.id) ?? [], players));
}

export interface PlayerStanding {
  player: Player;
  records: number;
  /** Share of circuits that have a record at all (0–1); null when none do. */
  share: number | null;
  secondPlaces: number;
  pbImprovements: number;
  position: number;
}

/**
 * Championship standings by current circuit records held.
 * Tie-break (documented in the UI): more second places, then the players'
 * fixed display order. Ties in records still share the same position number.
 */
export function championshipStandings(
  summaries: readonly CircuitSummary[],
  players: readonly Player[],
  annotations: Map<string, LapAnnotation>,
  laps: readonly Lap[],
  sinceIso?: string
): PlayerStanding[] {
  const withRecord = summaries.filter((s) => s.record).length;
  const since = sinceIso ? Date.parse(sinceIso) : -Infinity;
  const rows = players.map((player) => {
    const records = summaries.filter((s) => s.record?.player_id === player.id).length;
    const secondPlaces = summaries.filter((s) => s.standings[1]?.player.id === player.id && s.standings[1]?.lap).length;
    const pbImprovements = laps.filter(
      (l) => l.player_id === player.id && annotations.get(l.id)?.pbImprovement && Date.parse(l.recorded_at) >= since
    ).length;
    return { player, records, share: withRecord ? records / withRecord : null, secondPlaces, pbImprovements, position: 0 };
  });
  rows.sort((a, b) => b.records - a.records || b.secondPlaces - a.secondPlaces || a.player.display_order - b.player.display_order);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.position = prev && prev.records === r.records ? prev.position : i + 1;
  });
  return rows;
}

export interface HeadToHead {
  a: Player;
  b: Player;
  shared: number;
  aWins: number;
  bWins: number;
  ties: number;
  /** Mean absolute PB gap across shared circuits, ms (rounded). */
  avgGapMs: number | null;
  /** Mean of (a − b); negative means A is faster on average. */
  avgSignedMs: number | null;
}

/** Compares personal bests on circuits where BOTH players have a time. */
export function headToHead(summaries: readonly CircuitSummary[], a: Player, b: Player): HeadToHead {
  let shared = 0, aWins = 0, bWins = 0, ties = 0, absSum = 0, signedSum = 0;
  for (const s of summaries) {
    const pa = s.standings.find((x) => x.player.id === a.id)?.lap;
    const pb = s.standings.find((x) => x.player.id === b.id)?.lap;
    if (!pa || !pb) continue;
    shared++;
    const d = pa.lap_time_ms - pb.lap_time_ms;
    if (d < 0) aWins++;
    else if (d > 0) bWins++;
    else ties++;
    absSum += Math.abs(d);
    signedSum += d;
  }
  return {
    a, b, shared, aWins, bWins, ties,
    avgGapMs: shared ? Math.round(absSum / shared) : null,
    avgSignedMs: shared ? Math.round(signedSum / shared) : null
  };
}

/** A record is "under threat" when a rival's PB is within this many ms of it. */
export const THREAT_MS = 100;

export interface Threat {
  summary: CircuitSummary;
  holder: Standing;
  challenger: Standing;
  gapMs: number;
}

/** The closest rival to the record, if within THREAT_MS (a tie counts, at 0 ms). */
export function threatFor(summary: CircuitSummary, thresholdMs = THREAT_MS): Threat | null {
  const [first, second] = summary.standings;
  if (!first?.lap || !second?.lap || second.gapMs === null) return null;
  if (second.gapMs > thresholdMs) return null;
  return { summary, holder: first, challenger: second, gapMs: second.gapMs };
}

/** All records under threat, closest first. */
export function threats(summaries: readonly CircuitSummary[], thresholdMs = THREAT_MS): Threat[] {
  return summaries
    .map((s) => threatFor(s, thresholdMs))
    .filter((t): t is Threat => t !== null)
    .sort((a, b) => a.gapMs - b.gapMs || a.summary.circuit.display_order - b.summary.circuit.display_order);
}

/** Personal-best progression: one point each time a player improved. */
export function pbProgression(circuitLaps: readonly Lap[], playerId: string): Lap[] {
  const ordered = circuitLaps.filter((l) => l.player_id === playerId).sort(achievementOrder);
  const points: Lap[] = [];
  for (const lap of ordered) {
    const prev = points[points.length - 1];
    if (!prev || lap.lap_time_ms < prev.lap_time_ms) points.push(lap);
  }
  return points;
}

export type Verdict =
  | { kind: 'record'; previous: Lap | null; improvementMs: number | null }
  | { kind: 'tie_record'; holder: Lap }
  | { kind: 'pb'; previousPb: Lap | null; gapToRecordMs: number }
  | { kind: 'lap'; pb: Lap; gapToPbMs: number };

/** What a proposed lap would be against the current laps at a circuit. */
export function previewVerdict(circuitLaps: readonly Lap[], playerId: string, ms: number): Verdict {
  const record = fastestLap(circuitLaps);
  if (!record || ms < record.lap_time_ms) {
    return { kind: 'record', previous: record, improvementMs: record ? record.lap_time_ms - ms : null };
  }
  if (ms === record.lap_time_ms) return { kind: 'tie_record', holder: record };
  const pb = fastestLap(circuitLaps.filter((l) => l.player_id === playerId));
  if (!pb || ms < pb.lap_time_ms) return { kind: 'pb', previousPb: pb, gapToRecordMs: ms - record.lap_time_ms };
  return { kind: 'lap', pb, gapToPbMs: ms - pb.lap_time_ms };
}
