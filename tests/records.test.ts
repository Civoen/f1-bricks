import { describe, expect, it } from 'vitest';
import {
  annotateLaps,
  championshipStandings,
  deriveRecordHistory,
  fastestLap,
  headToHead,
  pbProgression,
  previewVerdict,
  summariseAll,
  summariseCircuit,
  threatFor,
  threats
} from '../src/lib/records';
import type { Circuit, Lap, Player } from '../src/lib/types';

const RAG: Player = { id: 'p-rag', slug: 'rag', name: 'Rag', colour_hex: '#35C878', display_order: 1 };
const ADAM: Player = { id: 'p-adam', slug: 'adam', name: 'Adam', colour_hex: '#398BFF', display_order: 2 };
const BEN: Player = { id: 'p-ben', slug: 'ben', name: 'Ben', colour_hex: '#FF8A24', display_order: 3 };
const PLAYERS = [RAG, ADAM, BEN];

const circuit = (slug: string, order: number): Circuit => ({
  id: `c-${slug}`, slug, name: slug, short_name: slug, code: slug.slice(0, 3).toUpperCase(),
  country: null, display_order: order, is_active: true
});
const SUZUKA = circuit('suzuka', 3);
const MONZA = circuit('monza', 16);
const MIAMI = circuit('miami', 6);

let n = 0;
function lap(player: Player, c: Circuit, ms: number, recordedAt: string, createdAt = recordedAt): Lap {
  n++;
  return { id: `lap-${String(n).padStart(4, '0')}`, player_id: player.id, circuit_id: c.id, lap_time_ms: ms,
    recorded_at: recordedAt, created_at: createdAt, notes: null };
}

describe('personal bests and circuit records', () => {
  const laps = [
    lap(RAG, SUZUKA, 89402, '2026-10-02T20:00:00Z'),
    lap(ADAM, SUZUKA, 89500, '2026-10-03T20:00:00Z'),
    lap(ADAM, SUZUKA, 89117, '2026-10-09T20:00:00Z'),
    lap(ADAM, SUZUKA, 89300, '2026-10-10T20:00:00Z')
  ];

  it('takes the lowest integer millisecond value', () => {
    expect(fastestLap(laps)?.lap_time_ms).toBe(89117);
    expect(fastestLap([])).toBeNull();
  });

  it('calculates PBs independently per player and circuit, with missing times kept missing', () => {
    const s = summariseCircuit(SUZUKA, laps, PLAYERS);
    expect(s.record?.player_id).toBe(ADAM.id);
    expect(s.standings.map((x) => [x.player.slug, x.lap?.lap_time_ms ?? null, x.gapMs, x.position])).toEqual([
      ['adam', 89117, 0, 1],
      ['rag', 89402, 285, 2],
      ['ben', null, null, 0]
    ]);
    expect(s.allThreeSet).toBe(false);
    expect(s.playersWithTimes).toBe(2);
    expect(s.spreadMs).toBe(285);
    expect(s.lapCount).toBe(4);
  });

  it('a circuit with no laps has no record and no zero times', () => {
    const s = summariseCircuit(MIAMI, [], PLAYERS);
    expect(s.record).toBeNull();
    expect(s.standings.every((x) => x.lap === null && x.gapMs === null)).toBe(true);
    expect(s.spreadMs).toBeNull();
  });
});

describe('record history', () => {
  it('first lap creates the initial record; later faster laps break it in order', () => {
    const laps = [
      lap(RAG, SUZUKA, 89402, '2026-10-02T20:00:00Z'),
      lap(ADAM, SUZUKA, 89117, '2026-10-09T20:00:00Z'),
      lap(RAG, SUZUKA, 89200, '2026-10-10T20:00:00Z'), // slower: no event
      lap(BEN, SUZUKA, 88903, '2026-10-12T20:00:00Z')
    ];
    const h = deriveRecordHistory(laps);
    expect(h.map((e) => [e.type, e.lap.player_id, e.previous?.player_id ?? null, e.improvementMs])).toEqual([
      ['initial', RAG.id, null, null],
      ['broken', ADAM.id, RAG.id, 285],
      ['broken', BEN.id, ADAM.id, 214]
    ]);
  });

  it('uses achievement time, not entry time, to order events', () => {
    const laps = [
      lap(RAG, MONZA, 80700, '2026-10-05T20:00:00Z', '2026-10-05T20:01:00Z'),
      // Entered later but achieved earlier and faster.
      lap(ADAM, MONZA, 80500, '2026-10-01T20:00:00Z', '2026-10-06T09:00:00Z')
    ];
    const h = deriveRecordHistory(laps);
    expect(h).toHaveLength(1);
    expect(h[0]!.lap.player_id).toBe(ADAM.id);
  });

  it('identical times never take a record; the earlier lap keeps it', () => {
    const laps = [
      lap(RAG, MONZA, 80611, '2026-10-01T20:00:00Z'),
      lap(ADAM, MONZA, 80611, '2026-10-02T20:00:00Z')
    ];
    expect(deriveRecordHistory(laps)).toHaveLength(1);
    const s = summariseCircuit(MONZA, laps, PLAYERS);
    expect(s.record?.player_id).toBe(RAG.id);
    expect(s.standings[1]!.tiedWithLeader).toBe(true);
    expect(s.standings[1]!.gapMs).toBe(0);
  });

  it('a correction or deletion produces a consistent recalculated history', () => {
    const r = lap(RAG, SUZUKA, 89402, '2026-10-02T20:00:00Z');
    const a = lap(ADAM, SUZUKA, 89117, '2026-10-09T20:00:00Z');
    const b = lap(BEN, SUZUKA, 88903, '2026-10-12T20:00:00Z');
    // Delete Ben's lap
    expect(deriveRecordHistory([r, a]).map((e) => e.lap.player_id)).toEqual([RAG.id, ADAM.id]);
    // Correct Adam's lap to a slower time
    const corrected = { ...a, lap_time_ms: 89600 };
    expect(deriveRecordHistory([r, corrected, b]).map((e) => e.lap.player_id)).toEqual([RAG.id, BEN.id]);
  });

  it('a repeated identical submission does not create an extra record event', () => {
    const first = lap(BEN, MONZA, 80000, '2026-10-01T20:00:00Z');
    const repeat = lap(BEN, MONZA, 80000, '2026-10-01T20:00:00Z');
    expect(deriveRecordHistory([first, repeat])).toHaveLength(1);
  });
});

describe('lap annotations', () => {
  it('marks PB-at-the-time and record-at-the-time laps', () => {
    const l1 = lap(RAG, SUZUKA, 89402, '2026-10-02T20:00:00Z');
    const l2 = lap(RAG, SUZUKA, 89500, '2026-10-03T20:00:00Z');
    const l3 = lap(ADAM, SUZUKA, 89450, '2026-10-04T20:00:00Z');
    const l4 = lap(RAG, SUZUKA, 89300, '2026-10-05T20:00:00Z');
    const a = annotateLaps([l4, l3, l2, l1]);
    expect(a.get(l1.id)).toEqual({ pbAtTime: true, pbImprovement: false, recordAtTime: true });
    expect(a.get(l2.id)).toEqual({ pbAtTime: false, pbImprovement: false, recordAtTime: false });
    expect(a.get(l3.id)).toEqual({ pbAtTime: true, pbImprovement: false, recordAtTime: false });
    expect(a.get(l4.id)).toEqual({ pbAtTime: true, pbImprovement: true, recordAtTime: true });
  });
});

describe('standings and head to head', () => {
  const laps = [
    lap(RAG, SUZUKA, 89402, '2026-10-02T20:00:00Z'),
    lap(ADAM, SUZUKA, 89117, '2026-10-09T20:00:00Z'),
    lap(BEN, SUZUKA, 88903, '2026-10-12T20:00:00Z'),
    lap(RAG, MONZA, 80611, '2026-10-01T20:00:00Z'),
    lap(ADAM, MONZA, 80488, '2026-10-04T20:00:00Z'),
    lap(ADAM, MONZA, 80400, '2026-10-05T20:00:00Z')
  ];
  const summaries = summariseAll([MIAMI, MONZA, SUZUKA], laps, PLAYERS);

  it('orders summaries by calendar order', () => {
    expect(summaries.map((s) => s.circuit.slug)).toEqual(['suzuka', 'miami', 'monza']);
  });

  it('counts records held and breaks ties transparently', () => {
    const st = championshipStandings(summaries, PLAYERS, annotateLaps(laps), laps);
    expect(st.map((s) => [s.player.slug, s.records, s.position])).toEqual([
      ['adam', 1, 1],
      ['ben', 1, 1], // same records → same position; Adam listed first on second places
      ['rag', 0, 3]
    ]);
    expect(st[0]!.secondPlaces).toBe(1);
    expect(st[0]!.share).toBe(0.5);
    expect(st[0]!.pbImprovements).toBe(1);
  });

  it('compares only circuits where both players have times', () => {
    const h = headToHead(summaries, RAG, BEN);
    expect(h).toMatchObject({ shared: 1, aWins: 0, bWins: 1, ties: 0, avgGapMs: 499, avgSignedMs: 499 });
    const ra = headToHead(summaries, RAG, ADAM);
    expect(ra).toMatchObject({ shared: 2, aWins: 0, bWins: 2, avgGapMs: Math.round((285 + 211) / 2) });
  });

  it('builds PB progression with only improving points', () => {
    const p = pbProgression(laps.filter((l) => l.circuit_id === MONZA.id), ADAM.id);
    expect(p.map((l) => l.lap_time_ms)).toEqual([80488, 80400]);
  });
});

describe('under threat', () => {
  it('flags records with a rival within 0.100s, closest first, and ignores missing times', () => {
    const laps = [
      lap(RAG, SUZUKA, 89000, '2026-10-01T20:00:00Z'),
      lap(ADAM, SUZUKA, 89042, '2026-10-02T20:00:00Z'),
      lap(RAG, MONZA, 80000, '2026-10-01T20:00:00Z'),
      lap(BEN, MONZA, 80101, '2026-10-02T20:00:00Z'),
      lap(BEN, MIAMI, 90000, '2026-10-02T20:00:00Z')
    ];
    const t = threats(summariseAll([SUZUKA, MONZA, MIAMI], laps, PLAYERS));
    expect(t.map((x) => [x.summary.circuit.slug, x.challenger.player.slug, x.gapMs])).toEqual([['suzuka', 'adam', 42]]);
  });

  it('counts an identical time as the closest possible threat', () => {
    const laps = [lap(RAG, MONZA, 80000, '2026-10-01T20:00:00Z'), lap(BEN, MONZA, 80000, '2026-10-02T20:00:00Z')];
    expect(threatFor(summariseCircuit(MONZA, laps, PLAYERS))?.gapMs).toBe(0);
  });
});

describe('previewVerdict', () => {
  const laps = [
    lap(RAG, SUZUKA, 89402, '2026-10-02T20:00:00Z'),
    lap(ADAM, SUZUKA, 89117, '2026-10-09T20:00:00Z')
  ];
  it('classifies a proposed time', () => {
    expect(previewVerdict(laps, RAG.id, 89000)).toMatchObject({ kind: 'record', improvementMs: 117 });
    expect(previewVerdict(laps, RAG.id, 89117)).toMatchObject({ kind: 'tie_record' });
    expect(previewVerdict(laps, RAG.id, 89300)).toMatchObject({ kind: 'pb', gapToRecordMs: 183 });
    expect(previewVerdict(laps, RAG.id, 89500)).toMatchObject({ kind: 'lap', gapToPbMs: 98 });
    expect(previewVerdict(laps, BEN.id, 90000)).toMatchObject({ kind: 'pb', previousPb: null });
    expect(previewVerdict([], BEN.id, 90000)).toMatchObject({ kind: 'record', previous: null });
  });
});
