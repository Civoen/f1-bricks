import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { TrackOutline } from '../components/TrackOutline';
import { fmtDay } from '../lib/format';
import { formatGap, formatLapTime, formatSeconds } from '../lib/laptime';
import { threatFor } from '../lib/records';
import { useData } from '../state/data';

type Filter = 'all' | 'untouched' | 'missing' | 'threat' | `holder:${string}`;
type Sort = 'calendar' | 'alpha' | 'closest' | 'recent';

export function Circuits() {
  const { snapshot, loading, error, refresh, summaries, players, playerById } = useData();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('calendar');

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = summaries.filter((s) =>
      !term || [s.circuit.name, s.circuit.short_name, s.circuit.country ?? '', s.circuit.code].some((v) => v.toLowerCase().includes(term))
    );
    if (filter === 'untouched') out = out.filter((s) => s.lapCount === 0);
    else if (filter === 'missing') out = out.filter((s) => !s.allThreeSet);
    else if (filter === 'threat') out = out.filter((s) => threatFor(s));
    else if (filter.startsWith('holder:')) out = out.filter((s) => s.record?.player_id === filter.slice(7));
    const sorted = [...out];
    if (sort === 'alpha') sorted.sort((a, b) => a.circuit.short_name.localeCompare(b.circuit.short_name));
    if (sort === 'closest') sorted.sort((a, b) => (a.spreadMs ?? Infinity) - (b.spreadMs ?? Infinity) || a.circuit.display_order - b.circuit.display_order);
    if (sort === 'recent') sorted.sort((a, b) => (b.lastRecordAt ? Date.parse(b.lastRecordAt) : -Infinity) - (a.lastRecordAt ? Date.parse(a.lastRecordAt) : -Infinity));
    return sorted;
  }, [summaries, q, filter, sort]);

  if (!snapshot && loading) return <LoadingState />;
  if (!snapshot) return <ErrorState message={error ?? 'Unknown error'} onRetry={() => void refresh()} />;

  const set = summaries.filter((s) => s.record).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{summaries.length} circuits · {set} with a record · {summaries.filter((s) => s.allThreeSet).length} with all three times</div>
          <h1 className="page-title">Circuits</h1>
        </div>
        <Link to="/log" className="btn btn-primary">LOG A LAP</Link>
      </div>

      <div className="filters" role="search">
        <label className="sr-only" htmlFor="circuit-search">Search circuits</label>
        <input id="circuit-search" className="input" type="search" placeholder="Search circuits" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200 }} />
        <div role="group" aria-label="Filter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="pill" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          {players.map((p) => (
            <button key={p.id} type="button" className="pill" aria-pressed={filter === `holder:${p.id}`} onClick={() => setFilter(`holder:${p.id}`)}>
              <span className="dot" style={{ background: p.colour_hex, marginRight: 6 }} />{p.name}’s records
            </button>
          ))}
          <button type="button" className="pill" aria-pressed={filter === 'threat'} onClick={() => setFilter('threat')}>Under threat</button>
          <button type="button" className="pill" aria-pressed={filter === 'missing'} onClick={() => setFilter('missing')}>Missing times</button>
          <button type="button" className="pill" aria-pressed={filter === 'untouched'} onClick={() => setFilter('untouched')}>No laps yet</button>
        </div>
        <label className="sr-only" htmlFor="circuit-sort">Sort</label>
        <select id="circuit-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ marginLeft: 'auto' }}>
          <option value="calendar">Calendar order</option>
          <option value="alpha">A–Z</option>
          <option value="closest">Closest competition</option>
          <option value="recent">Most recently broken</option>
        </select>
      </div>

      {list.length === 0 ? (
        <EmptyState title="No circuits match" action={false}>Try a different search or filter.</EmptyState>
      ) : (
        <div className="circuit-grid">
          {list.map((s, i) => {
            const holder = s.record ? playerById.get(s.record.player_id) : undefined;
            const leader = s.standings[0]?.lap;
            const threat = threatFor(s);
            return (
              <Link key={s.circuit.id} to={`/circuits/${s.circuit.slug}`} className="circuit-card"
                style={{ ['--i' as string]: i }}>
                <TrackOutline slug={s.circuit.slug} colour={holder?.colour_hex ?? '#4A4A52'} strokeWidth={2.5} className="cc-watermark" />
                <div className="cc-top">
                  <span className="rnd" style={holder ? { background: holder.colour_hex, borderColor: holder.colour_hex, color: '#0A0A0C' } : undefined}>
                    {String(s.circuit.display_order).padStart(2, '0')}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="muted" style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{s.circuit.country}</div>
                    <h3>{s.circuit.short_name}</h3>
                  </div>
                </div>
                {s.record && holder ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                      <span className="rec num">{formatLapTime(s.record.lap_time_ms)}</span>
                      <span className="holder-tag" style={{ background: holder.colour_hex }}>{holder.name}</span>
                      <span className="muted" style={{ fontSize: 12 }}>{fmtDay(s.record.recorded_at)}</span>
                      {threat && <span className="threat-tag" title={`${threat.challenger.player.name} is ${formatSeconds(threat.gapMs)}s away`}>Under threat</span>}
                    </div>
                    <div className="pbs-mini">
                      {s.standings.map((st) => (
                        <div key={st.player.id}>
                          <span style={{ color: st.player.colour_hex, fontWeight: 700 }}>{st.player.name}</span>
                          <span className="bar"><i style={{ width: st.lap && leader ? `${Math.max(8, 100 - Math.min(1, (st.gapMs ?? 0) / 1500) * 92)}%` : '0%', background: st.player.colour_hex }} /></span>
                          <span className="mono" style={{ textAlign: 'right', fontSize: 12, color: st.lap && st.position === 1 ? 'var(--text)' : 'var(--muted)' }}>
                            {!st.lap ? 'no time' : st.position === 1 ? 'P1' : formatGap(st.gapMs ?? 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="muted" style={{ fontSize: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span>{s.lapCount} lap{s.lapCount === 1 ? '' : 's'} logged</span>
                      <span>{s.allThreeSet ? 'All three set' : `${players.length - s.playersWithTimes} missing`}</span>
                    </div>
                  </>
                ) : (
                  <div className="muted" style={{ fontSize: 14 }}>No laps yet — nobody has set a time here.</div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
