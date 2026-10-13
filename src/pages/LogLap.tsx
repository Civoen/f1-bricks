import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CloseIcon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { ErrorState, LoadingState } from '../components/States';
import { ShareRecordButton } from '../components/ShareRecordButton';
import { TrackOutline } from '../components/TrackOutline';
import { friendlyError } from '../lib/backend';
import { fromLocalInput, heroNameClass, toLocalInput } from '../lib/format';
import { formatGap, formatLapTime, formatSeconds, isCompleteLapTimeInput, maskLapTimeInput, parseLapTime, type ParseResult } from '../lib/laptime';
import { previewVerdict, type CircuitSummary } from '../lib/records';
import type { Lap, LogLapResult } from '../lib/types';
import { useData } from '../state/data';

// The device remembers the last driver picked, so each person's phone defaults to them.
const LAST_DRIVER_KEY = 'f1-bricks:last-driver';
function readLastDriver(): string | null {
  try { return window.localStorage.getItem(LAST_DRIVER_KEY); } catch { return null; }
}
function saveLastDriver(slug: string) {
  try { window.localStorage.setItem(LAST_DRIVER_KEY, slug); } catch { /* storage unavailable */ }
}

const newRequestId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

export function LogLap() {
  const { snapshot, loading, error, refresh, players, summaries, summaryById, playerById, online, logLap, deleteLap } = useData();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [circuitId, setCircuitId] = useState<string | null>(null);
  const [timeText, setTimeText] = useState('');
  const [touched, setTouched] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ res: LogLapResult; ms: number; circuitId: string; circuitSlug: string; circuitName: string; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestId = useRef(newRequestId());

  // Defaults: the signed-in player, and the circuit from ?circuit= if given.
  useEffect(() => {
    if (!snapshot) return;
    if (!playerId) {
      const wanted = params.get('driver') ?? readLastDriver();
      setPlayerId(players.find((p) => p.slug === wanted)?.id ?? players[0]?.id ?? null);
    }
    if (!circuitId) {
      const fromParam = summaries.find((s) => s.circuit.slug === params.get('circuit'));
      setCircuitId(fromParam?.circuit.id ?? summaries[0]?.circuit.id ?? null);
    }
  }, [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const complete = isCompleteLapTimeInput(timeText);
  const parsed: ParseResult = complete ? parseLapTime(timeText) : { ok: false, error: 'Type all six digits, e.g. 128750 for 1:28.750' };
  const recordedAtIso = fromLocalInput(when);
  const whenError = !recordedAtIso
    ? 'Enter when the lap was set'
    : Date.parse(recordedAtIso) > Date.now() + 10 * 60_000
      ? 'A lap can’t be set in the future'
      : null;
  // While typing, an incomplete time isn't an error; a complete but impossible one is.
  const timeError = parsed.ok ? null : complete || (touched && timeText !== '') ? parsed.error : null;
  const canSubmit = online && parsed.ok && !whenError && playerId && circuitId && !submitting;

  const summary = circuitId ? summaryById.get(circuitId) : undefined;
  const preview = useMemo(() => {
    if (!summary || !playerId || !parsed.ok) return null;
    return previewVerdict(summary.laps, playerId, parsed.ms);
  }, [summary, playerId, parsed.ok, parsed.ok ? parsed.ms : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!snapshot && loading) return <LoadingState />;
  if (!snapshot) return <ErrorState message={error ?? 'Unknown error'} onRetry={() => void refresh()} />;

  const selectedPlayer = playerId ? playerById.get(playerId) : undefined;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit || !parsed.ok || !recordedAtIso || !playerId || !circuitId || !summary) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await logLap({
        playerId, circuitId, lapTimeMs: parsed.ms, recordedAt: recordedAtIso,
        notes: notes.trim() || null, clientRequestId: requestId.current
      });
      const slug = playerById.get(playerId)?.slug;
      if (slug) saveLastDriver(slug);
      setNotice(null);
      setResult({ res, ms: parsed.ms, circuitId: summary.circuit.id, circuitSlug: summary.circuit.slug, circuitName: summary.circuit.short_name, text: timeText });
    } catch (err) {
      setSubmitError(friendlyError(err)); // form data is preserved for a retry
    } finally {
      setSubmitting(false);
    }
  }

  async function undoLast() {
    if (!result) return;
    await deleteLap(result.res.lap_id);
    // Put the time back so it can be fixed and saved again.
    requestId.current = newRequestId();
    setTimeText(result.text);
    setCircuitId(result.circuitId);
    setResult(null);
    setNotice(`Undone — the ${formatLapTime(result.ms)} lap at ${result.circuitName} was removed.`);
  }

  function logAnother() {
    requestId.current = newRequestId();
    setResult(null);
    setTimeText('');
    setNotes('');
    setTouched(false);
    setWhen(toLocalInput(new Date()));
  }

  // Board after this lap (preview only).
  const board = summary
    ? players.map((p) => {
        const pb = summary.standings.find((s) => s.player.id === p.id)?.lap ?? null;
        const isNew = p.id === playerId && parsed.ok && (!pb || parsed.ms < pb.lap_time_ms);
        return { p, ms: isNew && parsed.ok ? parsed.ms : pb?.lap_time_ms ?? null, isNew, pb };
      })
        .sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity) || a.p.display_order - b.p.display_order)
    : [];
  const boardBest = board[0]?.ms ?? null;
  const futureHolderId = board[0]?.ms != null ? board[0].p.id : null;

  const verdict = verdictView(preview, parsed.ok ? parsed.ms : 0, complete || timeError ? timeText : '', Boolean(timeError), selectedPlayer?.colour_hex ?? '#fff', playerById);

  return (
    <div className="log-page">
      <form className="log-form" onSubmit={onSubmit} aria-label="Log a lap" noValidate>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 className="page-title" style={{ fontSize: 44 }}>Log a lap</h1>
          <button type="button" className="btn btn-icon" style={{ width: 44, height: 44 }} aria-label="Close and return" onClick={() => navigate(-1)}>
            <CloseIcon />
          </button>
        </div>

        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="eyebrow" style={{ padding: 0, marginBottom: 8 }}>Driver</legend>
          <div className="drivers">
            {players.map((p) => (
              <button key={p.id} type="button" className="driver-btn" aria-pressed={p.id === playerId}
                style={p.id === playerId ? { borderColor: p.colour_hex } : undefined} onClick={() => setPlayerId(p.id)}>
                <span className="dot" style={{ background: p.colour_hex, width: 10, height: 10 }} />
                {p.name.toUpperCase()}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="eyebrow" style={{ padding: 0, marginBottom: 8 }}>Circuit · calendar order</legend>
          <div className="tiles">
            {summaries.map((s) => {
              const holder = s.record ? playerById.get(s.record.player_id) : undefined;
              return (
                <button key={s.circuit.id} type="button" className="tile" aria-pressed={s.circuit.id === circuitId}
                  aria-label={`${tileLabel(s, summaries)} (${s.circuit.name})`} title={s.circuit.name} onClick={() => setCircuitId(s.circuit.id)}>
                  <TrackOutline slug={s.circuit.slug} colour={holder?.colour_hex ?? '#4A4A52'} />
                  <span style={{ color: s.record || s.circuit.id === circuitId ? undefined : 'var(--muted)' }}>{tileLabel(s, summaries)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 220px)', gap: 12, alignItems: 'start' }}>
          <div className="field">
            <label htmlFor="laptime">Lap time</label>
            <input id="laptime" className="input time-input" type="text" inputMode="numeric" pattern="[0-9:.]*" autoComplete="off" spellCheck={false}
              placeholder="1:28.750" value={timeText} onChange={(e) => { setTimeText(maskLapTimeInput(e.target.value)); setNotice(null); }}
              onBlur={() => setTouched(true)} aria-invalid={Boolean(timeError)} aria-describedby="laptime-help" />
            <div id="laptime-help" className={`help${timeError ? ' error' : ''}`}>
              {timeError ?? 'Just type the digits — 128750 becomes 1:28.750.'}
            </div>
          </div>
          <div className="field">
            <label htmlFor="when">Set on</label>
            <input id="when" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
              max={toLocalInput(new Date(Date.now() + 10 * 60_000))} style={{ height: 72 }} aria-invalid={Boolean(whenError)} aria-describedby="when-help" />
            <div id="when-help" className={`help${whenError ? ' error' : ''}`}>{whenError ?? 'Defaults to now'}</div>
          </div>
        </div>

        {summary && <TargetStrip summary={summary} playerId={playerId} />}

        <div className="field">
          <label htmlFor="notes">Notes <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>· optional</span></label>
          <input id="notes" className="input" type="text" maxLength={500} placeholder="Setup, assists, conditions…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {notice && <div className="help" role="status" style={{ fontSize: 14, color: 'var(--text)' }}>{notice}</div>}
        {submitError && <div className="help error" role="alert" style={{ fontSize: 14 }}>Not saved: {submitError}</div>}
        {!online && <div className="help error" role="status" style={{ fontSize: 14 }}>You’re offline. Reconnect to save this lap — your entry will stay here.</div>}

        <button type="submit" className="btn btn-primary" style={{ marginTop: 'auto', height: 56, fontSize: 24, flexShrink: 0 }} disabled={!canSubmit} aria-busy={submitting}>
          {submitting ? 'SAVING…' : 'SAVE LAP'}
        </button>
      </form>

      <section className="log-preview" aria-label="What this lap means" aria-live="polite">
        {summary && (
          <>
            <div className="eyebrow-red">Round {String(summary.circuit.display_order).padStart(2, '0')} · {summary.circuit.country}</div>
            <h2 key={`name-${summary.circuit.slug}`} className={`${heroNameClass(summary.circuit.short_name)} rise`}>{summary.circuit.short_name}</h2>
            <div className="muted" style={{ marginTop: 8, fontSize: 15 }}>{summary.circuit.name}</div>
            <TrackOutline key={`track-${summary.circuit.slug}`} slug={summary.circuit.slug} detailed animate className="hero-track"
              colour={futureHolderId ? playerById.get(futureHolderId)?.colour_hex ?? '#4A4A52' : '#4A4A52'} />
            <div className="verdict" style={{ background: verdict.bg, color: verdict.fg }}>
              <div>
                <div className="vt rise" key={verdict.title}>{verdict.title}</div>
                <div className="vs">{verdict.sub}</div>
              </div>
              {verdict.delta && <div className="vd">{verdict.delta}</div>}
            </div>
            <div className="board">
              {board.map((b, i) => (
                <div key={b.p.id} style={{ borderTopColor: b.ms != null ? b.p.colour_hex : 'var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em' }}>
                    <span style={{ color: b.p.colour_hex }}>{b.p.name.toUpperCase()}</span>
                    <span className="muted">{b.ms != null ? `P${i + 1}` : '—'}</span>
                  </div>
                  <div className="mono" style={{ fontWeight: 700, fontSize: 17, marginTop: 2, color: b.ms == null ? 'var(--muted)' : b.isNew ? b.p.colour_hex : undefined }}>
                    {b.ms != null ? formatLapTime(b.ms) : 'No time'}
                  </div>
                  <div className="mono muted" style={{ fontSize: 12 }}>
                    {b.ms == null ? 'not set' : i === 0 ? 'Leader' : formatGap(b.ms - (boardBest ?? b.ms))}
                  </div>
                </div>
              ))}
            </div>
            <div className="help" style={{ marginTop: 8 }}>Standings at this circuit if this lap is saved.</div>
          </>
        )}
      </section>

      {result && (
        <SavedModal result={result} onAnother={logAnother} onClose={logAnother} onUndo={undoLast} playerById={playerById}
          summary={summaryById.get(result.circuitId)} />
      )}
    </div>
  );
}

function verdictView(
  v: ReturnType<typeof previewVerdict> | null,
  ms: number,
  text: string,
  invalid: boolean,
  playerColour: string,
  playerById: Map<string, { name: string }>
): { title: string; sub: string; delta: string; bg: string; fg: string; accent: string } {
  const who = (lap: Lap | null) => (lap ? playerById.get(lap.player_id)?.name ?? '' : '');
  if (!text.trim()) return { title: 'ENTER A TIME', sub: 'Type the six digits from the game, e.g. 128750', delta: '', bg: 'var(--elevated)', fg: 'var(--muted)', accent: 'var(--border)' };
  if (invalid || !v) return { title: 'CHECK THE TIME', sub: 'That doesn’t look like a lap time. Use 1:28.750', delta: '', bg: 'var(--elevated)', fg: 'var(--text)', accent: 'var(--border)' };
  switch (v.kind) {
    case 'record':
      return { title: 'NEW CIRCUIT RECORD', sub: v.previous ? `Takes it from ${who(v.previous)} (${formatLapTime(v.previous.lap_time_ms)})` : 'First time on the board here',
        delta: v.improvementMs !== null ? `−${formatSeconds(v.improvementMs)}` : '', bg: 'var(--red)', fg: '#fff', accent: 'var(--red)' };
    case 'tie_record':
      return { title: 'TIES THE RECORD', sub: `Identical to ${who(v.holder)}’s ${formatLapTime(v.holder.lap_time_ms)} · the record stays with ${who(v.holder)}`,
        delta: '±0.000', bg: '#fff', fg: 'var(--bg)', accent: '#fff' };
    case 'pb':
      return { title: 'NEW PERSONAL BEST', sub: `${v.previousPb ? `Beats the previous PB of ${formatLapTime(v.previousPb.lap_time_ms)}` : 'First time at this circuit'} · ${formatGap(v.gapToRecordMs)} to the record`,
        delta: v.previousPb ? `−${formatSeconds(v.previousPb.lap_time_ms - ms)}` : '',
        bg: '#fff', fg: 'var(--bg)', accent: playerColour };
    case 'lap':
      return { title: 'LAP LOGGED', sub: `Saved to history · PB is ${formatLapTime(v.pb.lap_time_ms)}`, delta: formatGap(v.gapToPbMs), bg: 'var(--elevated)', fg: 'var(--text)', accent: 'var(--muted)' };
  }
}

function SavedModal({ result, onAnother, onClose, onUndo, playerById, summary }: {
  result: { res: LogLapResult; ms: number; circuitSlug: string; circuitName: string };
  onAnother: () => void;
  onClose: () => void;
  onUndo: () => Promise<void>;
  playerById: Map<string, { name: string }>;
  summary: CircuitSummary | undefined;
}) {
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  async function undo() {
    setUndoing(true);
    setUndoError(null);
    try {
      await onUndo();
    } catch (e) {
      setUndoError(friendlyError(e));
      setUndoing(false);
    }
  }
  const { res, ms } = result;
  const prevHolder = res.previous_record_player_id ? playerById.get(res.previous_record_player_id)?.name : undefined;
  const view = {
    record: {
      title: 'New circuit record',
      sub: res.previous_record_ms !== null ? `${formatGap(ms - res.previous_record_ms)} on ${prevHolder ?? 'the previous record'} (${formatLapTime(res.previous_record_ms)})` : 'First time on the board at this circuit.',
      accent: 'var(--red)'
    },
    tie_record: { title: 'Ties the record', sub: `Identical to ${prevHolder ?? 'the record'}. The record stays with the lap set first.`, accent: '#fff' },
    pb: { title: 'New personal best', sub: res.previous_pb_ms !== null ? `${formatGap(ms - res.previous_pb_ms)} on the previous PB (${formatLapTime(res.previous_pb_ms)})` : 'First time at this circuit.', accent: '#fff' },
    lap: { title: 'Lap logged', sub: res.previous_pb_ms !== null ? `${formatGap(ms - res.previous_pb_ms)} to the PB. Saved to history.` : 'Saved to history.', accent: 'var(--muted)' }
  }[res.outcome];

  return (
    <Modal label="Lap saved" accent={view.accent} onClose={onClose}>
      <div className="modal-body">
        <div className="eyebrow" style={{ color: view.accent === 'var(--muted)' ? undefined : view.accent }}>Lap saved · {result.circuitName}</div>
        <div className="modal-title" style={{ fontSize: 52 }}>{view.title}</div>
        <div className="display num" style={{ fontWeight: 800, fontSize: 76, lineHeight: 1 }}>{formatLapTime(ms)}</div>
        <div className="muted" style={{ fontSize: 16 }}>{view.sub}</div>
        {res.duplicate && <div className="help">This lap had already been saved — it was not added twice.</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {res.outcome === 'record' && summary && <ShareRecordButton summary={summary} className="btn" />}
          <button type="button" className="btn" onClick={() => void undo()} disabled={undoing}>
            {undoing ? 'Undoing…' : 'Undo — remove this lap'}
          </button>
        </div>
        {undoError && <div className="help error" role="alert">Couldn’t undo: {undoError}</div>}
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onAnother}>Log another</button>
        <Link to={`/circuits/${result.circuitSlug}`} className="primary">View circuit</Link>
      </div>
    </Modal>
  );
}

/** Tile label: the country, or the circuit's own name where a country hosts more than one round. */
function tileLabel(s: CircuitSummary, all: CircuitSummary[]): string {
  const country = s.circuit.country;
  if (!country) return s.circuit.short_name;
  const shared = all.filter((x) => x.circuit.country === country).length > 1;
  return shared ? s.circuit.short_name : country;
}

/** What to beat: the circuit record and the selected driver's PB, shown before typing. */
function TargetStrip({ summary, playerId }: { summary: CircuitSummary; playerId: string | null }) {
  const record = summary.standings[0]?.lap ? summary.standings[0] : null;
  const mine = summary.standings.find((s) => s.player.id === playerId);
  return (
    <div className="target-strip" aria-label="Times to beat">
      <div>
        <div className="eyebrow">Circuit record</div>
        {record?.lap ? (
          <div className="target-time">
            <span className="mono">{formatLapTime(record.lap.lap_time_ms)}</span>
            <span className="holder-tag" style={{ background: record.player.colour_hex }}>{record.player.name}</span>
          </div>
        ) : <div className="target-time muted">No time yet</div>}
      </div>
      {mine && (
        <div>
          <div className="eyebrow">{mine.player.name}’s PB</div>
          {mine.lap ? (
            <div className="target-time">
              <span className="mono" style={{ color: mine.player.colour_hex }}>{formatLapTime(mine.lap.lap_time_ms)}</span>
              <span className="muted mono" style={{ fontSize: 13 }}>{mine.position === 1 ? 'holds the record' : formatGap(mine.gapMs ?? 0)}</span>
            </div>
          ) : <div className="target-time muted">No time yet</div>}
        </div>
      )}
    </div>
  );
}
