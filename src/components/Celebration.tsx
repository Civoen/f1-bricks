import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatLapTime, formatSeconds } from '../lib/laptime';

/** F1 timing colour for the fastest time overall. */
export const PURPLE = '#A54BFF';

export interface CelebrationData {
  kind: 'record' | 'pb';
  timeMs: number;
  /** Time it beat (previous record or previous PB), if there was one. */
  beatMs: number | null;
  driverName: string;
  driverColour: string;
  circuitName: string;
}

const DURATION_MS = 2600;
const REDUCED_MS = 1600;

/**
 * A short, broadcast-style moment when a lap beats a time: three sector lights
 * fill in (purple for a circuit record, the driver's colour for a PB), slanted
 * brand stripes sweep across, and the time wipes in. Tap, click or any key
 * skips it. Shorter and without movement for people who prefer reduced motion.
 */
export function Celebration({ data, onDone }: { data: CelebrationData; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  const accent = data.kind === 'record' ? PURPLE : data.driverColour;
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const finish = () => done.current();
    const t = window.setTimeout(finish, reduced ? REDUCED_MS : DURATION_MS);
    // Capture phase, so Enter/Escape skip the celebration instead of reaching the dialog underneath.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    window.addEventListener('keydown', onKey, true);
    try {
      navigator.vibrate?.(data.kind === 'record' ? [40, 60, 40, 60, 120] : [40, 60, 90]);
    } catch {
      // not supported (e.g. iPhone)
    }
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [reduced, data.kind]);

  const delta = data.beatMs !== null && data.beatMs > data.timeMs ? `−${formatSeconds(data.beatMs - data.timeMs)}` : null;

  return createPortal(
    <div className={`celebrate${reduced ? ' reduced' : ''}`} style={{ ['--accent' as string]: accent, ['--driver' as string]: data.driverColour }}
      onClick={() => done.current()} role="status" aria-live="assertive"
      aria-label={`${data.kind === 'record' ? 'New circuit record' : 'Personal best'}: ${data.driverName}, ${formatLapTime(data.timeMs)} at ${data.circuitName}`}>
      <div className="celebrate-stripes" aria-hidden="true">
        <i style={{ background: 'var(--driver)' }} />
        <i style={{ background: 'var(--red)' }} />
        <i style={{ background: '#fff' }} />
      </div>
      <div className="celebrate-card" aria-hidden="true">
        <div className="celebrate-sectors">
          {['S1', 'S2', 'S3'].map((s, i) => (
            <span key={s} style={{ ['--n' as string]: i }}><b>{s}</b></span>
          ))}
        </div>
        <div className="celebrate-tag">{data.kind === 'record' ? 'New circuit record' : 'Personal best'}</div>
        <div className="celebrate-time">
          <span className="celebrate-time-text">{formatLapTime(data.timeMs)}</span>
        </div>
        <div className="celebrate-meta">
          <span style={{ color: 'var(--driver)' }}>{data.driverName}</span>
          <span className="celebrate-dot" />
          <span>{data.circuitName}</span>
          {delta && <><span className="celebrate-dot" /><span className="celebrate-delta">{delta}</span></>}
        </div>
      </div>
    </div>,
    document.body
  );
}
