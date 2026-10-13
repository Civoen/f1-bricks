import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, LoadingState } from '../components/States';
import { fmtDay, fmtShortDateTime, pct } from '../lib/format';
import { formatGap, formatLapTime, formatSeconds } from '../lib/laptime';
import { achievementOrder, championshipStandings, headToHead, THREAT_MS, threats } from '../lib/records';
import { TrackOutline } from '../components/TrackOutline';
import { useData } from '../state/data';

type Period = '7' | '30' | 'all';

export function Stats() {
  const { snapshot, loading, error, refresh, summaries, players, playerById, circuitById, annotations, activeEvents } = useData();
  const [period, setPeriod] = useState<Period>('30');

  const standings = useMemo(() => {
    const since = period === 'all' ? undefined : new Date(Date.now() - Number(period) * 86400000).toISOString();
    return championshipStandings(summaries, players, annotations, snapshot?.laps ?? [], since);
  }, [summaries, players, annotations, snapshot, period]);

  if (!snapshot && loading) return <LoadingState />;
  if (!snapshot) return <ErrorState message={error ?? 'Unknown error'} onRetry={() => void refresh()} />;

  const laps = snapshot.laps;
  const allThree = summaries.filter((s) => s.allThreeSet);
  const missing = summaries.filter((s) => !s.allThreeSet);
  const untouched = summaries.filter((s) => s.lapCount === 0).length;
  const closest = [...allThree].sort((a, b) => (a.spreadMs ?? 0) - (b.spreadMs ?? 0))[0];
  const widest = [...allThree].sort((a, b) => (b.spreadMs ?? 0) - (a.spreadMs ?? 0))[0];
  const lastImprovement = [...laps].filter((l) => annotations.get(l.id)?.pbAtTime).sort((a, b) => achievementOrder(b, a))[0];
  const recentRecords = [...activeEvents].sort((a, b) => Date.parse(b.achieved_at) - Date.parse(a.achieved_at)).slice(0, 8);
  const pairs = players.flatMap((a, i) => players.slice(i + 1).map((b) => headToHead(summaries, a, b)));
  const underThreat = threats(summaries);
  const leader = standings[0];
  const tiedLead = standings.filter((s) => s.records === leader?.records).length > 1;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Championship · current circuit records</div>
          <h1 className="page-title">Statistics</h1>
        </div>
        <div role="group" aria-label="Period for PB improvements" style={{ display: 'flex', gap: 6 }}>
          {(['7', '30', 'all'] as Period[]).map((p) => (
            <button key={p} type="button" className="pill" aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {p === 'all' ? 'All time' : `Last ${p} days`}
            </button>
          ))}
        </div>
      </div>

      <section className="standings" aria-label="Standings">
        {standings.map((s) => (
          <div key={s.player.id} className="standing" style={{ borderTopColor: s.player.colour_hex }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="display" style={{ fontWeight: 900, fontSize: 30, color: 'var(--muted)' }}>P{s.position}</span>
              {s.position === 1 && s.records > 0 && <span className="tag tag-pb">{tiedLead ? 'Joint leader' : 'Leader'}</span>}
            </div>
            <div className="display" style={{ fontWeight: 900, fontSize: 34, color: s.player.colour_hex, textTransform: 'uppercase' }}>{s.player.name}</div>
            <div className="big num">{s.records}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>records · {pct(s.share)} of circuits with a record</div>
            <div className="muted" style={{ fontSize: 13 }}>{s.secondPlaces} second places · {s.pbImprovements} PB improvement{s.pbImprovements === 1 ? '' : 's'} {period === 'all' ? 'all time' : `in ${period} days`}</div>
          </div>
        ))}
      </section>
      <p className="help" style={{ marginTop: -6, marginBottom: 16 }}>
        Ranked by current circuit records. Ties are broken by second places, then by the fixed driver order; equal record counts share a position.
      </p>

      <section className="kpis" aria-label="Key figures">
        <Kpi label="All three times set" value={`${allThree.length} / ${summaries.length}`} sub="circuits with a PB from every driver" />
        <Kpi label="Missing entries" value={String(missing.length)} sub={`${untouched} with no laps at all`} />
        <Kpi label="Lap entries" value={String(laps.length)} sub="every attempt, fast or slow" />
        <Kpi label="Most recently improved"
          value={lastImprovement ? circuitById.get(lastImprovement.circuit_id)?.short_name ?? '—' : '—'}
          sub={lastImprovement ? `${playerById.get(lastImprovement.player_id)?.name} · ${formatLapTime(lastImprovement.lap_time_ms)} · ${fmtDay(lastImprovement.recorded_at)}` : 'No laps yet'} />
        <Kpi label="Closest three-way fight"
          value={closest ? closest.circuit.short_name : '—'}
          sub={closest ? `P1 to P3 covered by ${formatSeconds(closest.spreadMs ?? 0)}s` : 'Needs a circuit with all three times'} />
        <Kpi label="Biggest P1–P3 gap"
          value={widest ? widest.circuit.short_name : '—'}
          sub={widest ? `${formatSeconds(widest.spreadMs ?? 0)}s between first and third` : 'Needs a circuit with all three times'} />
      </section>

      <section className="card" style={{ marginBottom: 16 }} aria-labelledby="threat-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 id="threat-title">Under threat</h2>
          <span className="help">Records with a rival within {formatSeconds(THREAT_MS)}s</span>
        </div>
        {underThreat.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No records are under threat right now. Every record holder has more than {formatSeconds(THREAT_MS)}s in hand.</p>
        ) : (
          <ul className="threat-list">
            {underThreat.map((t) => (
              <li key={t.summary.circuit.id}>
                <Link to={`/circuits/${t.summary.circuit.slug}`}>
                  <TrackOutline slug={t.summary.circuit.slug} colour={t.holder.player.colour_hex} strokeWidth={2} />
                  <span style={{ minWidth: 0 }}>
                    <span className="display" style={{ fontWeight: 800, fontSize: 20, textTransform: 'uppercase' }}>{t.summary.circuit.short_name}</span>
                    <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                      <span style={{ color: t.challenger.player.colour_hex, fontWeight: 700 }}>{t.challenger.player.name}</span>
                      {t.gapMs === 0 ? ' has matched ' : ' is chasing '}
                      <span style={{ color: t.holder.player.colour_hex, fontWeight: 700 }}>{t.holder.player.name}</span>’s {formatLapTime(t.holder.lap!.lap_time_ms)}
                    </span>
                  </span>
                  <span className="threat-gap">{t.gapMs === 0 ? 'TIED' : `+${formatSeconds(t.gapMs)}`}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="two-col">
        <section className="card" aria-labelledby="h2h-title">
          <h2 id="h2h-title">Head to head</h2>
          {pairs.map((h) => (
            <div key={`${h.a.id}-${h.b.id}`} className="h2h">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 700, color: h.a.colour_hex }}>{h.a.name} <span className="display" style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>{h.aWins}</span></span>
                <span className="mono muted" style={{ fontSize: 12, textAlign: 'center' }}>
                  {h.shared} shared{h.ties ? ` · ${h.ties} tied` : ''}{h.avgGapMs !== null ? ` · avg ${formatSeconds(h.avgGapMs)}s` : ''}
                </span>
                <span style={{ fontWeight: 700, color: h.b.colour_hex }}><span className="display" style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>{h.bWins}</span> {h.b.name}</span>
              </div>
              {h.shared > 0 ? (
                <div className="h2h-bar" aria-hidden="true">
                  {h.aWins > 0 && <i style={{ flex: h.aWins, background: h.a.colour_hex }} />}
                  {h.ties > 0 && <i style={{ flex: h.ties, background: 'var(--border)' }} />}
                  {h.bWins > 0 && <i style={{ flex: h.bWins, background: h.b.colour_hex }} />}
                </div>
              ) : <div className="help">No circuits where both have a time yet.</div>}
              {h.avgSignedMs !== null && h.avgSignedMs !== 0 && (
                <div className="help">On average {h.avgSignedMs < 0 ? h.a.name : h.b.name} is {formatSeconds(Math.abs(h.avgSignedMs))}s faster per shared circuit.</div>
              )}
            </div>
          ))}
          <p className="help" style={{ marginTop: 12 }}>
            Compares personal bests only on circuits where both drivers have a time; circuits missing either time are left out.
            “Avg” is the mean absolute gap between their PBs across those shared circuits.
          </p>
        </section>

        <section className="card" aria-labelledby="rr-title">
          <h2 id="rr-title">Recent records</h2>
          {recentRecords.length === 0 ? <p className="muted">No records yet.</p> : (
            <ul className="feed">
              {recentRecords.map((e) => {
                const np = playerById.get(e.new_player_id);
                const pp = e.previous_player_id ? playerById.get(e.previous_player_id) : undefined;
                const c = circuitById.get(e.circuit_id);
                return (
                  <li key={e.id}>
                    <span className="bar" style={{ background: np?.colour_hex }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{c ? <Link to={`/circuits/${c.slug}`} style={{ textDecoration: 'none' }}>{c.short_name}</Link> : '—'}</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        <span style={{ color: np?.colour_hex, fontWeight: 600 }}>{np?.name}</span>
                        {pp ? <> beat <span style={{ color: pp.colour_hex, fontWeight: 600 }}>{pp.name}</span>’s {formatLapTime(e.previous_time_ms!)}</> : ' set the first record'}
                        {' · '}{fmtDay(e.achieved_at)}
                      </div>
                    </div>
                    <span className="mono" style={{ fontWeight: 700 }}>{formatLapTime(e.new_time_ms)}</span>
                    <span className="mono muted" style={{ fontSize: 12, minWidth: 56, textAlign: 'right' }}>
                      {e.previous_time_ms !== null ? `−${formatSeconds(e.previous_time_ms - e.new_time_ms)}` : 'first'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="act-title">
        <h2 id="act-title">Recent activity</h2>
        <ActivityFeed />
      </section>

      <p className="help" style={{ marginTop: 24 }}>
        Times are stored in UTC and shown in your local time. Track outlines from bacinger/f1-circuits (MIT); sector markers are approximate.
        Not affiliated with Formula 1, the FIA or EA Sports.
      </p>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <div className="eyebrow">{label}</div>
      <div className="v">{value}</div>
      <div className="s">{sub}</div>
    </div>
  );
}

function ActivityFeed() {
  const { snapshot, playerById, circuitById, annotations } = useData();
  const items = (snapshot?.audit ?? []).slice(0, 20);
  if (!items.length) return <p className="muted">Nothing yet. Logged, corrected and deleted laps appear here.</p>;
  return (
    <ul className="feed">
      {items.map((a) => {
        const snap = a.after ?? a.before;
        if (!snap) return null;
        const p = playerById.get(snap.player_id);
        const c = circuitById.get(snap.circuit_id);
        const ann = annotations.get(a.lap_entry_id);
        let tag = <span className="tag tag-muted">Lap</span>;
        let detail = '';
        if (a.action === 'delete') {
          tag = <span className="tag tag-muted">Deleted</span>;
        } else if (a.action === 'update') {
          tag = <span className="tag tag-muted">Corrected</span>;
          if (a.before && a.after && a.before.lap_time_ms !== a.after.lap_time_ms) detail = `was ${formatLapTime(a.before.lap_time_ms)}`;
        } else {
          const outcome = a.outcome ?? (ann?.recordAtTime ? 'record' : ann?.pbAtTime ? 'pb' : 'lap');
          if (outcome === 'record') {
            tag = <span className="tag tag-record">Record</span>;
            if (a.after?.previous_record_ms) detail = `${formatGap(a.after.lap_time_ms - a.after.previous_record_ms)} on the record`;
          } else if (outcome === 'pb') {
            tag = <span className="tag tag-pb">PB</span>;
            if (a.after?.previous_pb_ms) detail = `${formatGap(a.after.lap_time_ms - a.after.previous_pb_ms)} on PB`;
          } else if (outcome === 'tie_record') {
            tag = <span className="tag tag-pb">Tied record</span>;
          }
        }
        return (
          <li key={a.id}>
            <span className="bar" style={{ background: p?.colour_hex ?? 'var(--border)' }} />
            <div style={{ minWidth: 0 }}>
              <div><span style={{ color: p?.colour_hex, fontWeight: 700 }}>{p?.name}</span> · {c?.short_name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{fmtShortDateTime(a.at)}{detail && ` · ${detail}`}</div>
            </div>
            {tag}
            <span className="mono" style={{ fontWeight: 600, textDecoration: a.action === 'delete' ? 'line-through' : undefined }}>
              {formatLapTime(snap.lap_time_ms)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
