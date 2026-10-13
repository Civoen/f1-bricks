import { Link, useParams } from 'react-router-dom';
import { ProgressionChart } from '../components/ProgressionChart';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { TrackOutline } from '../components/TrackOutline';
import { fmtDate, fmtDateTime } from '../lib/format';
import { heroNameClass } from '../lib/format';
import { formatLapTime, formatSeconds } from '../lib/laptime';
import { achievementOrder, threatFor } from '../lib/records';
import { ShareRecordButton } from '../components/ShareRecordButton';
import type { RecordEvent } from '../lib/types';
import { useData } from '../state/data';

export function CircuitDetail() {
  const { slug } = useParams();
  const { snapshot, loading, error, refresh, circuitBySlug, summaryById, players, playerById, annotations } = useData();

  if (!snapshot && loading) return <LoadingState />;
  if (!snapshot) return <ErrorState message={error ?? 'Unknown error'} onRetry={() => void refresh()} />;
  const circuit = slug ? circuitBySlug.get(slug) : undefined;
  if (!circuit) return <div className="page"><EmptyState title="Circuit not found" action={false}><Link to="/circuits">Back to all circuits</Link></EmptyState></div>;
  const s = summaryById.get(circuit.id)!;

  const holder = s.record ? playerById.get(s.record.player_id) : undefined;
  const threat = threatFor(s);
  const last = s.history[s.history.length - 1];
  const prevHolder = last?.previous ? playerById.get(last.previous.player_id) : undefined;
  const events = snapshot.events.filter((e) => e.circuit_id === circuit.id);
  const active = events.filter((e) => !e.superseded_at).sort((a, b) => a.sequence - b.sequence);
  const superseded = events.filter((e) => e.superseded_at).sort((a, b) => Date.parse(b.superseded_at!) - Date.parse(a.superseded_at!) || a.sequence - b.sequence);
  const recent = [...s.laps].sort((a, b) => achievementOrder(b, a)).slice(0, 10);

  return (
    <div className="page">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <Link to="/circuits" className="muted" style={{ fontSize: 13, textDecoration: 'none' }}>← All circuits</Link>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ShareRecordButton summary={s} />
          <Link to={`/log?circuit=${circuit.slug}`} className="btn btn-primary">LOG A LAP HERE</Link>
        </div>
      </div>

      <section className="detail-hero">
        <div>
          <div className="eyebrow-red">Round {String(circuit.display_order).padStart(2, '0')} · {circuit.country}</div>
          <h1 className={heroNameClass(circuit.short_name)}>{circuit.short_name}</h1>
          <div className="muted" style={{ marginTop: 6 }}>{circuit.name}</div>
          <div style={{ marginTop: 28 }}>
            <div className="eyebrow">Circuit record</div>
            {s.record && holder ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                  <div className="hero-record-time">{formatLapTime(s.record.lap_time_ms)}</div>
                  <span className="hero-holder" style={{ color: holder.colour_hex }}>{holder.name}</span>
                </div>
                {threat && (
                  <div style={{ marginTop: 10 }}>
                    <span className="threat-tag">Under threat</span>{' '}
                    <span className="muted" style={{ fontSize: 14 }}>
                      {threat.challenger.player.name} is {threat.gapMs === 0 ? 'level on time' : `${formatSeconds(threat.gapMs)}s away`}
                    </span>
                  </div>
                )}
                <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                  Set {fmtDateTime(s.record.recorded_at)}
                  {last?.previous && last.improvementMs !== null
                    ? <> · {'−'}{formatSeconds(last.improvementMs)} on <span style={{ color: prevHolder?.colour_hex, fontWeight: 700 }}>{prevHolder?.name}</span>’s {formatLapTime(last.previous.lap_time_ms)}</>
                    : ' · first record at this circuit'}
                </div>
              </>
            ) : (
              <div className="muted" style={{ fontSize: 16, marginTop: 6 }}>No laps yet. Nobody has set a time here.</div>
            )}
          </div>
        </div>
        <TrackOutline slug={circuit.slug} colour={holder?.colour_hex ?? '#4A4A52'} detailed title={`${circuit.short_name} track layout`} />
      </section>

      <div className="two-col">
        <section className="card" aria-labelledby="pb-title">
          <h2 id="pb-title">Personal bests</h2>
          <table className="table">
            <thead><tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col">PB</th><th scope="col">Gap</th><th scope="col">Set</th></tr></thead>
            <tbody>
              {s.standings.map((st) => (
                <tr key={st.player.id}>
                  <td className="mono muted">{st.lap ? `P${st.position}` : '—'}</td>
                  <td><span className="player-name" style={{ color: st.player.colour_hex }}>{st.player.name}</span></td>
                  <td className="t" style={{ color: st.lap ? undefined : 'var(--muted)', fontWeight: st.lap ? 700 : 400 }}>{st.lap ? formatLapTime(st.lap.lap_time_ms) : 'No time set'}</td>
                  <td className="mono">
                    {!st.lap ? '' : st.position === 1 ? 'Leader'
                      : st.tiedWithLeader ? <span title="Identical time, set later">+0.000 (tie)</span>
                      : <>+{formatSeconds(st.gapMs ?? 0)} <span className="muted" style={{ fontSize: 11 }}>({st.gapMs} ms)</span></>}
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>{st.lap ? fmtDate(st.lap.recorded_at) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="help" style={{ marginTop: 10 }}>Identical times: the lap set first holds the position.</p>
        </section>

        <section className="card" aria-labelledby="timeline-title">
          <h2 id="timeline-title">Record timeline</h2>
          {active.length === 0 ? <p className="muted">No records yet.</p> : (
            <ol className="timeline">
              {active.map((e) => timelineItem(e))}
            </ol>
          )}
          {superseded.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
                Corrected history ({superseded.length} earlier event{superseded.length === 1 ? '' : 's'} replaced after edits or deletions)
              </summary>
              <ol className="timeline" style={{ marginTop: 8 }}>
                {superseded.map((e) => timelineItem(e))}
              </ol>
            </details>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="prog-title">
        <h2 id="prog-title">PB progression</h2>
        <ProgressionChart laps={s.laps} players={players} />
      </section>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="recent-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 id="recent-title">Recent laps</h2>
          <Link to={`/history?circuit=${circuit.slug}`} className="muted" style={{ fontSize: 13 }}>All {s.lapCount} laps →</Link>
        </div>
        {recent.length === 0 ? <p className="muted">No laps logged here yet.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th scope="col">Set</th><th scope="col">Driver</th><th scope="col">Time</th><th scope="col">At the time</th></tr></thead>
              <tbody>
                {recent.map((l) => {
                  const p = playerById.get(l.player_id);
                  const a = annotations.get(l.id);
                  return (
                    <tr key={l.id}>
                      <td className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDateTime(l.recorded_at)}</td>
                      <td><span className="player-name" style={{ color: p?.colour_hex }}>{p?.name}</span></td>
                      <td className="t">{formatLapTime(l.lap_time_ms)}</td>
                      <td>{a?.recordAtTime ? <span className="tag tag-record">Record</span> : a?.pbAtTime ? <span className="tag tag-pb">PB</span> : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );

  function timelineItem(e: RecordEvent) {
    const np = playerById.get(e.new_player_id);
    const pp = e.previous_player_id ? playerById.get(e.previous_player_id) : undefined;
    return (
      <li key={e.id} className={e.superseded_at ? "superseded" : undefined}>
        <span className="node" style={{ background: np?.colour_hex }} aria-hidden="true" />
        <div>
          <div style={{ fontWeight: 600 }}>
            <span style={{ color: np?.colour_hex }}>{np?.name}</span>
            {e.event_type === 'initial' ? ' set the first record' : <> took it from <span style={{ color: pp?.colour_hex }}>{pp?.name}</span></>}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {fmtDateTime(e.achieved_at)}
            {e.previous_time_ms !== null && <> · was {formatLapTime(e.previous_time_ms)}</>}
            {e.superseded_at && <> · replaced {fmtDate(e.superseded_at)} ({e.superseded_reason})</>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontWeight: 700 }}>{formatLapTime(e.new_time_ms)}</div>
          {e.previous_time_ms !== null && <div className="mono muted" style={{ fontSize: 12 }}>{'−'}{formatSeconds(e.previous_time_ms - e.new_time_ms)}</div>}
        </div>
      </li>
    );
  }
}
