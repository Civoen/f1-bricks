import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DeleteLapModal, EditLapModal } from '../components/EditLapModal';
import { EditIcon, TrashIcon } from '../components/Icons';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { fmtDateTime, TIME_ZONE } from '../lib/format';
import { formatGap, formatLapTime } from '../lib/laptime';
import { achievementOrder } from '../lib/records';
import type { Lap } from '../lib/types';
import { useData } from '../state/data';

const PAGE_SIZE = 50;
type Sort = 'newest' | 'oldest' | 'fastest';

export function History() {
  const { snapshot, loading, error, refresh, players, circuits, playerById, circuitById, circuitBySlug, annotations, summaryById } = useData();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Lap | null>(null);
  const [deleting, setDeleting] = useState<Lap | null>(null);

  const player = params.get('player') ?? '';
  const circuitSlug = params.get('circuit') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const only = params.get('only') ?? '';
  const sort = (params.get('sort') as Sort) || 'newest';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const laps = snapshot?.laps ?? [];
    const circuitId = circuitSlug ? circuitBySlug.get(circuitSlug)?.id : undefined;
    const fromMs = from ? Date.parse(`${from}T00:00:00`) : -Infinity;
    const toMs = to ? Date.parse(`${to}T23:59:59.999`) : Infinity;
    const out = laps.filter((l) => {
      if (player && playerById.get(l.player_id)?.slug !== player) return false;
      if (circuitId && l.circuit_id !== circuitId) return false;
      const t = Date.parse(l.recorded_at);
      if (t < fromMs || t > toMs) return false;
      const a = annotations.get(l.id);
      if (only === 'pb' && !a?.pbAtTime) return false;
      if (only === 'record' && !a?.recordAtTime) return false;
      return true;
    });
    if (sort === 'fastest') out.sort((a, b) => a.lap_time_ms - b.lap_time_ms || achievementOrder(a, b));
    else if (sort === 'oldest') out.sort(achievementOrder);
    else out.sort((a, b) => achievementOrder(b, a));
    return out;
  }, [snapshot, player, circuitSlug, from, to, only, sort, playerById, circuitBySlug, annotations]);

  if (!snapshot && loading) return <LoadingState />;
  if (!snapshot) return <ErrorState message={error ?? 'Unknown error'} onRetry={() => void refresh()} />;

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const anyFilter = player || circuitSlug || from || to || only;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{snapshot.laps.length} laps logged · times shown in {TIME_ZONE}</div>
          <h1 className="page-title">Lap history</h1>
        </div>
        <Link to="/log" className="btn btn-primary">LOG A LAP</Link>
      </div>

      <div className="filters">
        <label className="sr-only" htmlFor="h-player">Driver</label>
        <select id="h-player" className="select" value={player} onChange={(e) => set('player', e.target.value)}>
          <option value="">All drivers</option>
          {players.map((p) => <option key={p.id} value={p.slug}>{p.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="h-circuit">Circuit</label>
        <select id="h-circuit" className="select" value={circuitSlug} onChange={(e) => set('circuit', e.target.value)}>
          <option value="">All circuits</option>
          {circuits.map((c) => <option key={c.id} value={c.slug}>{c.short_name}</option>)}
        </select>
        <label className="muted" htmlFor="h-from" style={{ fontSize: 13 }}>From</label>
        <input id="h-from" className="input" type="date" value={from} onChange={(e) => set('from', e.target.value)} />
        <label className="muted" htmlFor="h-to" style={{ fontSize: 13 }}>to</label>
        <input id="h-to" className="input" type="date" value={to} onChange={(e) => set('to', e.target.value)} />
        <div role="group" aria-label="Show" style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="pill" aria-pressed={only === 'pb'} onClick={() => set('only', only === 'pb' ? '' : 'pb')}>PB laps</button>
          <button type="button" className="pill" aria-pressed={only === 'record'} onClick={() => set('only', only === 'record' ? '' : 'record')}>Record laps</button>
        </div>
        <label className="sr-only" htmlFor="h-sort">Sort</label>
        <select id="h-sort" className="select" value={sort} onChange={(e) => set('sort', e.target.value === 'newest' ? '' : e.target.value)} style={{ marginLeft: 'auto' }}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="fastest">Fastest first</option>
        </select>
        {anyFilter && <button type="button" className="btn btn-sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear</button>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No laps match" action={false}>Try widening the filters.</EmptyState>
      ) : (
        <>
          <div className="table-scroll">
            <table className="table history-table">
              <thead>
                <tr>
                  <th scope="col">Set</th><th scope="col">Driver</th><th scope="col">Circuit</th><th scope="col">Time</th>
                  <th scope="col">To current PB</th><th scope="col">At the time</th><th scope="col">Notes</th><th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const p = playerById.get(l.player_id);
                  const c = circuitById.get(l.circuit_id);
                  const a = annotations.get(l.id);
                  const pb = summaryById.get(l.circuit_id)?.standings.find((s) => s.player.id === l.player_id)?.lap;
                  const label = `${p?.name} · ${c?.short_name} · ${formatLapTime(l.lap_time_ms)} · ${fmtDateTime(l.recorded_at)}`;
                  return (
                    <tr key={l.id}>
                      <td className="muted" style={{ fontSize: 13 }}>{fmtDateTime(l.recorded_at)}</td>
                      <td>{p ? <Link to={`/drivers/${p.slug}`} className="player-name" style={{ color: p.colour_hex, textDecoration: 'none' }}>{p.name}</Link> : null}</td>
                      <td>{c ? <Link to={`/circuits/${c.slug}`} style={{ textDecoration: 'none' }}>{c.short_name}</Link> : '—'}</td>
                      <td className="t">{formatLapTime(l.lap_time_ms)}</td>
                      <td className="mono muted">{pb ? (pb.id === l.id ? 'Current PB' : formatGap(l.lap_time_ms - pb.lap_time_ms)) : '—'}</td>
                      <td>
                        {a?.recordAtTime ? <span className="tag tag-record">Record</span>
                          : a?.pbAtTime ? <span className="tag tag-pb">PB</span>
                          : <span className="muted">—</span>}
                      </td>
                      <td className="notes">{l.notes}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button type="button" className="btn btn-icon" aria-label={`Correct ${label}`} onClick={() => setEditing(l)}><EditIcon /></button>
                          <button type="button" className="btn btn-icon btn-danger" aria-label={`Delete ${label}`} onClick={() => setDeleting(l)}><TrashIcon /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted" style={{ fontSize: 13 }}>
              Showing {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-sm" disabled={current <= 1} onClick={() => set('page', String(current - 1))}>← Newer</button>
              <span className="muted" style={{ alignSelf: 'center', fontSize: 13 }}>Page {current} of {pages}</span>
              <button type="button" className="btn btn-sm" disabled={current >= pages} onClick={() => set('page', String(current + 1))}>Older →</button>
            </div>
          </div>
        </>
      )}

      {editing && <EditLapModal lap={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <DeleteLapModal lap={deleting} onClose={() => setDeleting(null)}
          label={`${playerById.get(deleting.player_id)?.name} · ${circuitById.get(deleting.circuit_id)?.short_name} · ${formatLapTime(deleting.lap_time_ms)} · ${fmtDateTime(deleting.recorded_at)}`} />
      )}
    </div>
  );
}
