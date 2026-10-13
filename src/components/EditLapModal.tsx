import { useState, type FormEvent } from 'react';
import { friendlyError } from '../lib/backend';
import { fromLocalInput, toLocalInput } from '../lib/format';
import { formatLapTime, isCompleteLapTimeInput, maskLapTimeInput, parseLapTime, type ParseResult } from '../lib/laptime';
import type { Lap } from '../lib/types';
import { useData } from '../state/data';
import { Modal } from './Modal';

export function EditLapModal({ lap, onClose }: { lap: Lap; onClose: () => void }) {
  const { players, circuits, updateLap, online } = useData();
  const [playerId, setPlayerId] = useState(lap.player_id);
  const [circuitId, setCircuitId] = useState(lap.circuit_id);
  const [timeText, setTimeText] = useState(formatLapTime(lap.lap_time_ms));
  const initialWhen = toLocalInput(new Date(lap.recorded_at));
  const [when, setWhen] = useState(initialWhen);
  const [notes, setNotes] = useState(lap.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parsed: ParseResult = isCompleteLapTimeInput(timeText) ? parseLapTime(timeText) : { ok: false, error: 'Type all six digits, e.g. 128750' };
  // Keep the exact original timestamp (with seconds) unless the user changes it.
  const iso = when === initialWhen ? lap.recorded_at : fromLocalInput(when);
  const whenError = !iso ? 'Enter when the lap was set' : Date.parse(iso) > Date.now() + 10 * 60_000 ? 'A lap can’t be set in the future' : null;
  const unchanged = parsed.ok && parsed.ms === lap.lap_time_ms && playerId === lap.player_id && circuitId === lap.circuit_id &&
    when === initialWhen && notes === (lap.notes ?? '');
  const valid = parsed.ok && !whenError;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !parsed.ok || !iso) return;
    setBusy(true);
    setErr(null);
    try {
      await updateLap({ lapId: lap.id, playerId, circuitId, lapTimeMs: parsed.ms, recordedAt: iso, notes: notes.trim() || null });
      onClose();
    } catch (ex) {
      setErr(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal label="Correct lap" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="modal-body">
          <h2 className="modal-title">Correct lap</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Personal bests, records and stats are recalculated. Any record history this changes is kept and marked as corrected.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
            <div className="field">
              <label htmlFor="e-player">Driver</label>
              <select id="e-player" className="select" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
                {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="e-circuit">Circuit</label>
              <select id="e-circuit" className="select" value={circuitId} onChange={(e) => setCircuitId(e.target.value)}>
                {circuits.map((c) => <option key={c.id} value={c.id}>{c.short_name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="e-time">Lap time</label>
              <input id="e-time" className="input mono" value={timeText} onChange={(e) => setTimeText(maskLapTimeInput(e.target.value))} inputMode="numeric"
                aria-invalid={!parsed.ok} aria-describedby="e-time-help" autoComplete="off" />
              <div id="e-time-help" className={`help${parsed.ok ? '' : ' error'}`}>{parsed.ok ? 'm:ss.mmm' : parsed.error}</div>
            </div>
            <div className="field">
              <label htmlFor="e-when">Set on</label>
              <input id="e-when" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-invalid={Boolean(whenError)} />
              {whenError && <div className="help error">{whenError}</div>}
            </div>
          </div>
          <div className="field">
            <label htmlFor="e-notes">Notes</label>
            <input id="e-notes" className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {err && <div className="help error" role="alert" style={{ fontSize: 14 }}>Not saved: {err}</div>}
          {!online && <div className="help error">You’re offline. Reconnect to save the correction.</div>}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!valid || busy || !online || unchanged}>{busy ? 'Saving…' : 'Save correction'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteLapModal({ lap, label, onClose }: { lap: Lap; label: string; onClose: () => void }) {
  const { deleteLap, online } = useData();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await deleteLap(lap.id);
      onClose();
    } catch (ex) {
      setErr(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal label="Delete lap" accent="var(--red)" onClose={onClose}>
      <div className="modal-body">
        <h2 className="modal-title">Delete this lap?</h2>
        <p style={{ margin: 0 }}>{label}</p>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          It will be removed from standings, personal bests and records. If it held a record, the record passes back to the next fastest lap.
          The deletion is kept in the audit trail.
        </p>
        {err && <div className="help error" role="alert" style={{ fontSize: 14 }}>Not deleted: {err}</div>}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>Keep lap</button>
        <button type="button" className="danger" onClick={confirm} disabled={busy || !online}>{busy ? 'Deleting…' : 'Delete lap'}</button>
      </div>
    </Modal>
  );
}
