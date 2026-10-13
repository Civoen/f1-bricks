import { Link } from 'react-router-dom';
import { TrackOutline } from '../components/TrackOutline';
import { ErrorState, LoadingState } from '../components/States';
import { formatGap, formatLapTime, formatSeconds } from '../lib/laptime';
import { fmtDay } from '../lib/format';
import { heroNameClass } from '../lib/format';
import { THREAT_MS, threatFor, type CircuitSummary } from '../lib/records';
import { useData } from '../state/data';

export function Dashboard() {
  const { snapshot, loading, error, refresh, summaries, standings, activeEvents, playerById } = useData();

  if (!snapshot && loading) return <LoadingState />;
  if (!snapshot) return <ErrorState message={error ?? 'Unknown error'} onRetry={() => void refresh()} />;

  // Featured circuit: where the most recent record was set (by achievement time).
  const latestEvent = [...activeEvents].sort((a, b) => Date.parse(b.achieved_at) - Date.parse(a.achieved_at))[0];
  const featured: CircuitSummary | undefined =
    summaries.find((s) => s.circuit.id === latestEvent?.circuit_id) ?? summaries[0];
  const withRecord = summaries.filter((s) => s.record).length;
  const threatCount = summaries.filter((s) => threatFor(s)).length;

  return (
    <div className="dash">
      {featured && <Hero key={featured.circuit.id} summary={featured} isLatest={Boolean(latestEvent)} />}

      <section className="tower" aria-labelledby="tower-title">
        <div className="tower-head">
          <div>
            <h2 id="tower-title" className="tower-title">TIMING TOWER</h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {standings.map((s, i) => (
                <span key={s.player.id}>
                  {i > 0 && ' · '}
                  <span style={{ color: s.player.colour_hex, fontWeight: 700 }}>{s.player.name} {s.records}</span>
                </span>
              ))}
              {' · '}{withRecord} of {summaries.length} set
              {threatCount > 0 && <>{' · '}<span className="threat-text" title={`Records with a rival within ${THREAT_MS / 1000}s`}>{threatCount} under threat</span></>}
            </div>
          </div>
          <Link to="/log" className="btn btn-primary">LOG A LAP</Link>
        </div>

        <ol className="tower-list">
          {summaries.map((s, i) => {
            const holder = s.record ? playerById.get(s.record.player_id) : undefined;
            const leader = s.standings[0]?.lap;
            const threat = threatFor(s);
            return (
              <li key={s.circuit.id} style={{ ['--i' as string]: i }}>
                <Link
                  to={`/circuits/${s.circuit.slug}`}
                  className={`tower-row${s.circuit.id === featured?.circuit.id ? ' current' : ''}${s.record ? '' : ' empty'}`}
                  aria-label={`Round ${i + 1}, ${s.circuit.short_name}: ${s.record && holder ? `record ${formatLapTime(s.record.lap_time_ms)} by ${holder.name}` : 'no laps yet'}${threat ? `, under threat from ${threat.challenger.player.name}` : ''}`}
                >
                  <span className="rnd" style={holder ? { background: holder.colour_hex, borderColor: holder.colour_hex, color: '#0A0A0C' } : undefined}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <TrackOutline slug={s.circuit.slug} colour={holder?.colour_hex ?? '#4A4A52'} />
                  <span className="nm">
                    <b style={{ color: s.record ? undefined : 'var(--muted)' }}>{s.circuit.short_name}</b>
                    <span>{s.circuit.country}</span>
                  </span>
                  <span className="rec" style={{ color: s.record ? undefined : 'var(--muted)' }}>
                    {s.record ? formatLapTime(s.record.lap_time_ms) : '—'}
                  </span>
                  <span className="chips">
                    {!s.record && <span className="chip"><span className="dot" style={{ background: 'var(--border)' }} />No laps yet</span>}
                    {s.record && s.standings.map((st) => (
                      <span key={st.player.id} className={`chip${threat && threat.challenger.player.id === st.player.id ? ' chip-threat' : ''}`}
                        title={threat && threat.challenger.player.id === st.player.id ? `Under threat: ${st.player.name} is ${(threat.gapMs / 1000).toFixed(3)}s away` : undefined}
                        style={{ color: st.position === 1 ? 'var(--text)' : undefined }}>
                        <span className="dot" style={{ background: st.lap ? st.player.colour_hex : 'var(--border)' }} />
                        {!st.lap ? 'no time' : st.position === 1 ? 'P1' : leader ? formatGap(st.gapMs ?? 0) : ''}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function Hero({ summary, isLatest }: { summary: CircuitSummary; isLatest: boolean }) {
  const { playerById } = useData();
  const s = summary;
  const round = s.circuit.display_order;
  const holder = s.record ? playerById.get(s.record.player_id) : undefined;
  const last = s.history[s.history.length - 1];
  const prevHolder = last?.previous ? playerById.get(last.previous.player_id) : undefined;
  const name = s.circuit.short_name;

  return (
    <section className="dash-hero enter" aria-label={`Featured circuit: ${name}`}>
      <div className="eyebrow-red">
        Round {String(round).padStart(2, '0')} · {s.circuit.country}{isLatest && ' · Last record broken'}
      </div>
      <h1 className={heroNameClass(name)}>
        <Link to={`/circuits/${s.circuit.slug}`} style={{ textDecoration: 'none' }}>{name}</Link>
      </h1>

      <TrackOutline slug={s.circuit.slug} colour={holder?.colour_hex ?? '#4A4A52'} detailed animate className="hero-track" />

      <div>
        <div className="eyebrow">Circuit record</div>
        {s.record && holder ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
            <div className="hero-record-time rise" style={{ animationDelay: '250ms' }}>{formatLapTime(s.record.lap_time_ms)}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="hero-holder" style={{ color: holder.colour_hex }}>{holder.name}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {last?.previous && last.improvementMs !== null
                  ? `−${formatSeconds(last.improvementMs)} on ${prevHolder?.name ?? 'previous'} · ${fmtDay(s.record.recorded_at)}`
                  : `First time set · ${fmtDay(s.record.recorded_at)}`}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
            <div className="hero-record-time muted">—:——.———</div>
            <span className="muted">No laps yet. Be the first on the board.</span>
          </div>
        )}
        <div className="pb-tiles">
          {s.standings.map((st) => (
            <div key={st.player.id} className="pb-tile rise" style={{ animationDelay: `${350 + s.standings.indexOf(st) * 60}ms`, borderTopColor: st.lap ? st.player.colour_hex : 'var(--border)' }}>
              <div className="who" style={{ color: st.player.colour_hex }}>{st.player.name}</div>
              <div className="t" style={{ color: st.lap ? undefined : 'var(--muted)' }}>{st.lap ? formatLapTime(st.lap.lap_time_ms) : 'No time'}</div>
              <div className="g">{!st.lap ? 'not set' : st.position === 1 ? 'P1' : formatGap(st.gapMs ?? 0)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
