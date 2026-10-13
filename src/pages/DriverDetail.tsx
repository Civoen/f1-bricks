import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { TrackOutline } from '../components/TrackOutline';
import { fmtDate, fmtDay } from '../lib/format';
import { formatGap, formatLapTime, formatSeconds } from '../lib/laptime';
import { achievementOrder, threatFor, type CircuitSummary, type Standing } from '../lib/records';
import type { Player } from '../lib/types';
import { useData } from '../state/data';

const REACH_MS = 250;
const DAY = 86_400_000;

interface Row {
  s: CircuitSummary;
  me: Standing | undefined;
  /** I hold the record: my margin over the next driver (null if nobody else has a time). */
  leadMs: number | null;
  /** Someone else holds it: how far I am off it. */
  gapMs: number | null;
}

type Sort = 'calendar' | 'strongest' | 'weakest';

export function DriverDetail() {
  const { slug } = useParams();
  const { snapshot, loading, error, refresh, players, summaries, standings, activeEvents, annotations, playerById, circuitById } = useData();
  const [sort, setSort] = useState<Sort>('calendar');

  if (!snapshot && loading) return <LoadingState />;
  if (!snapshot) return <ErrorState message={error ?? 'Unknown error'} onRetry={() => void refresh()} />;
  const player = players.find((p) => p.slug === slug);
  if (!player) return <div className="page"><EmptyState title="Driver not found" action={false}><Link to="/stats">Back to statistics</Link></EmptyState></div>;

  const champ = standings.find((s) => s.player.id === player.id);
  const rows: Row[] = summaries.map((s) => {
    const me = s.standings.find((st) => st.player.id === player.id);
    const held = Boolean(me?.lap && me.position === 1);
    const next = s.standings.find((st) => st.player.id !== player.id && st.lap);
    return {
      s, me,
      leadMs: held && me?.lap && next?.lap ? next.lap.lap_time_ms - me.lap.lap_time_ms : null,
      gapMs: !held && me?.lap ? me.gapMs ?? null : null
    };
  });

  const held = rows.filter((r) => r.me?.lap && r.me.position === 1);
  const chasing = rows.filter((r) => r.gapMs !== null);
  const avgGap = chasing.length ? Math.round(chasing.reduce((t, r) => t + (r.gapMs ?? 0), 0) / chasing.length) : null;
  const strongest = [...held].filter((r) => r.leadMs !== null).sort((a, b) => b.leadMs! - a.leadMs!)[0];
  const weakest = [...chasing].sort((a, b) => b.gapMs! - a.gapMs!)[0];
  const myLaps = snapshot.laps.filter((l) => l.player_id === player.id);
  const monthAgo = Date.now() - 30 * DAY;
  const recentPbs = myLaps.filter((l) => annotations.get(l.id)?.pbImprovement && Date.parse(l.recorded_at) >= monthAgo).length;
  const recentLaps = [...myLaps].sort((a, b) => achievementOrder(b, a)).slice(0, 10);

  // Nemesis: who has taken the most of this driver's records (current history).
  const takenBy = new Map<string, number>();
  for (const e of activeEvents) {
    if (e.previous_player_id === player.id && e.new_player_id !== player.id) takenBy.set(e.new_player_id, (takenBy.get(e.new_player_id) ?? 0) + 1);
  }
  const nemesisEntry = [...takenBy.entries()].sort((a, b) => b[1] - a[1])[0];
  const nemesis: Player | undefined = nemesisEntry ? playerById.get(nemesisEntry[0]) : undefined;

  const withinReach = chasing.filter((r) => r.gapMs! <= REACH_MS).sort((a, b) => a.gapMs! - b.gapMs!).slice(0, 6);
  const toDefend = held
    .map((r) => ({ r, t: threatFor(r.s) }))
    .filter((x) => x.t && x.t.challenger.player.id !== player.id)
    .sort((a, b) => a.t!.gapMs - b.t!.gapMs);

  const sorted = [...rows];
  if (sort === 'strongest') sorted.sort((a, b) => rank(b) - rank(a));
  if (sort === 'weakest') sorted.sort((a, b) => rank(a) - rank(b));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Driver · {champ ? `P${champ.position} in the championship` : 'Championship'}</div>
          <h1 className="page-title" style={{ color: player.colour_hex }}>{player.name}</h1>
        </div>
        <div role="group" aria-label="Other drivers" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {players.map((p) => (
            <Link key={p.id} to={`/drivers/${p.slug}`} className="pill" aria-current={p.id === player.id ? 'page' : undefined}
              aria-pressed={p.id === player.id} style={{ textDecoration: 'none' }}>
              <span className="dot" style={{ background: p.colour_hex, marginRight: 6 }} />{p.name}
            </Link>
          ))}
          <Link to={`/log?driver=${player.slug}`} className="btn btn-primary btn-sm" style={{ marginLeft: 6 }}>LOG A LAP</Link>
        </div>
      </div>

      <section className="kpis" aria-label={`${player.name} in numbers`}>
        <Kpi label="Records held" value={`${held.length} / ${summaries.length}`} sub={champ ? `${champ.secondPlaces} second places` : ''} />
        <Kpi label="Average gap" value={avgGap === null ? '—' : `+${formatSeconds(avgGap)}`} sub="to the record, where it isn’t yours" />
        <Kpi label="Strongest" value={strongest ? strongest.s.circuit.short_name : '—'}
          sub={strongest ? `leads by ${formatSeconds(strongest.leadMs!)}s` : 'no record with a rival time yet'} />
        <Kpi label="Most to find" value={weakest ? weakest.s.circuit.short_name : '—'}
          sub={weakest ? `${formatSeconds(weakest.gapMs!)}s off the record` : 'holds every record'} />
        <Kpi label="Nemesis" value={nemesis ? nemesis.name : '—'}
          sub={nemesis ? `has taken ${nemesisEntry![1]} of ${player.name}’s records` : 'nobody has taken a record yet'} colour={nemesis?.colour_hex} />
        <Kpi label="Form" value={String(recentPbs)} sub={`PB improvement${recentPbs === 1 ? '' : 's'} in 30 days · ${myLaps.length} laps logged`} />
      </section>

      <div className="two-col" style={{ marginBottom: 16 }}>
        <section className="card" aria-labelledby="reach-title">
          <h2 id="reach-title">Within reach</h2>
          {withinReach.length === 0 ? <p className="muted" style={{ margin: 0 }}>No records within {formatSeconds(REACH_MS)}s right now.</p> : (
            <ul className="threat-list">
              {withinReach.map(({ s, gapMs }) => {
                const holder = s.record ? playerById.get(s.record.player_id) : undefined;
                return (
                  <li key={s.circuit.id}>
                    <Link to={`/log?circuit=${s.circuit.slug}&driver=${player.slug}`} title={`Log a lap at ${s.circuit.short_name}`}>
                      <TrackOutline slug={s.circuit.slug} colour={player.colour_hex} />
                      <div>
                        <div className="threat-name">{s.circuit.short_name}</div>
                        <div className="muted" style={{ fontSize: 13 }}>
                          <span style={{ color: holder?.colour_hex, fontWeight: 700 }}>{holder?.name}</span>’s {s.record ? formatLapTime(s.record.lap_time_ms) : ''}
                        </div>
                      </div>
                      <div className="threat-gap" style={{ color: 'var(--text)' }}>{formatGap(gapMs!)}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="defend-title">
          <h2 id="defend-title">Records to defend</h2>
          {toDefend.length === 0 ? <p className="muted" style={{ margin: 0 }}>None of {player.name}’s records are under threat.</p> : (
            <ul className="threat-list">
              {toDefend.map(({ r, t }) => (
                <li key={r.s.circuit.id}>
                  <Link to={`/circuits/${r.s.circuit.slug}`}>
                    <TrackOutline slug={r.s.circuit.slug} colour={player.colour_hex} />
                    <div>
                      <div className="threat-name">{r.s.circuit.short_name}</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        <span style={{ color: t!.challenger.player.colour_hex, fontWeight: 700 }}>{t!.challenger.player.name}</span> is {t!.gapMs === 0 ? 'level on time' : 'chasing'}
                      </div>
                    </div>
                    <div className="threat-gap">{t!.gapMs === 0 ? 'TIED' : formatGap(t!.gapMs)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="pbs-title" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 id="pbs-title">Every circuit</h2>
          <div role="group" aria-label="Sort" style={{ display: 'flex', gap: 6 }}>
            {([['calendar', 'Calendar'], ['strongest', 'Strongest first'], ['weakest', 'Weakest first']] as [Sort, string][]).map(([k, label]) => (
              <button key={k} type="button" className="pill" aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
          <table className="table driver-table">
            <thead>
              <tr><th scope="col">Rnd</th><th scope="col">Circuit</th><th scope="col">PB</th><th scope="col">Pos</th><th scope="col">Lead / gap</th><th scope="col">Set</th><th scope="col"><span className="sr-only">Log</span></th></tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const holder = r.s.record ? playerById.get(r.s.record.player_id) : undefined;
                const mine = r.me?.position === 1 && r.me.lap;
                return (
                  <tr key={r.s.circuit.id}>
                    <td><span className="rnd" style={holder ? { background: holder.colour_hex, borderColor: holder.colour_hex, color: '#0A0A0C' } : undefined}>{String(r.s.circuit.display_order).padStart(2, '0')}</span></td>
                    <td>
                      <Link to={`/circuits/${r.s.circuit.slug}`} className="driver-circuit">
                        <TrackOutline slug={r.s.circuit.slug} colour={mine ? player.colour_hex : '#4A4A52'} />
                        <span>{r.s.circuit.short_name}</span>
                      </Link>
                    </td>
                    <td className="t">{r.me?.lap ? formatLapTime(r.me.lap.lap_time_ms) : <span className="muted">No time</span>}</td>
                    <td className="mono">{r.me?.lap ? <span style={{ color: mine ? player.colour_hex : undefined, fontWeight: 700 }}>P{r.me.position}</span> : '—'}</td>
                    <td className="mono">
                      {mine ? (r.leadMs !== null ? <span style={{ color: player.colour_hex }}>−{formatSeconds(r.leadMs)}</span> : <span className="muted">only time</span>)
                        : r.gapMs !== null ? <>{formatGap(r.gapMs)} <span className="muted" style={{ fontSize: 12 }}>to {holder?.name}</span></> : ''}
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>{r.me?.lap ? fmtDate(r.me.lap.recorded_at) : ''}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Link to={`/log?circuit=${r.s.circuit.slug}&driver=${player.slug}`} className="btn btn-sm" aria-label={`Log a lap at ${r.s.circuit.short_name}`}>Log</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="recent-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 id="recent-title">Recent laps</h2>
          <Link to={`/history?player=${player.slug}`} className="muted" style={{ fontSize: 13 }}>All {myLaps.length} laps →</Link>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th scope="col">Set</th><th scope="col">Circuit</th><th scope="col">Time</th><th scope="col">Result</th></tr></thead>
            <tbody>
              {recentLaps.map((l) => {
                const a = annotations.get(l.id);
                const c = circuitById.get(l.circuit_id);
                return (
                  <tr key={l.id}>
                    <td className="muted" style={{ fontSize: 13 }}>{fmtDay(l.recorded_at)}</td>
                    <td>{c ? <Link to={`/circuits/${c.slug}`}>{c.short_name}</Link> : '—'}</td>
                    <td className="t">{formatLapTime(l.lap_time_ms)}</td>
                    <td>{a?.recordAtTime ? <span className="tag tag-record">Record</span> : a?.pbAtTime ? <span className="tag tag-pb">PB</span> : <span className="muted" style={{ fontSize: 13 }}>Lap</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Higher is better for the driver: big leads first, then small gaps. */
function rank(r: Row): number {
  if (r.leadMs !== null) return 1_000_000 + r.leadMs;
  if (r.me?.lap && r.me.position === 1) return 1_000_000;
  if (r.gapMs !== null) return -r.gapMs;
  return -1_000_000;
}

function Kpi({ label, value, sub, colour }: { label: string; value: string; sub: string; colour?: string }) {
  return (
    <div className="kpi">
      <div className="eyebrow">{label}</div>
      <div className="v" style={{ color: colour }}>{value}</div>
      <div className="s">{sub}</div>
    </div>
  );
}
