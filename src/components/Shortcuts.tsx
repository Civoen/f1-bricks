import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useData } from '../state/data';
import { Modal } from './Modal';

/** True when a key press is meant for a text field, not for a shortcut. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export const dialogOpen = () => Boolean(document.querySelector('.overlay, .celebrate'));

/** Opens the shortcuts sheet from anywhere (e.g. the rail button). */
export const openShortcuts = () => window.dispatchEvent(new Event('f1b:shortcuts'));

const LAST_DRIVER_KEY = 'f1-bricks:last-driver';

/**
 * App-wide keyboard shortcuts (desktop):
 *   L        Log a lap (or jump to the time box when already there)
 *   G then H / T / L / S / D   Home, Tracks, Laps, Stats, your driver page
 *   /        Search tracks
 *   ?        Show all shortcuts
 * Log-a-lap keys live in the Log page itself.
 */
export function Shortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const { players } = useData();
  const [open, setOpen] = useState(false);
  const pendingG = useRef(0);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('f1b:shortcuts', show);
    return () => window.removeEventListener('f1b:shortcuts', show);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      // "?" also works from the lap-time box, which only ever holds digits.
      const inTime = (e.target as HTMLElement | null)?.id === 'laptime';
      if (isTyping(e) && !(inTime && e.key === '?')) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (dialogOpen()) return;
      const k = e.key.toLowerCase();

      if (Date.now() - pendingG.current < 1200) {
        pendingG.current = 0;
        const myDriver = (() => { try { return window.localStorage.getItem(LAST_DRIVER_KEY); } catch { return null; } })();
        const to = { h: '/', t: '/circuits', l: '/history', s: '/stats',
          d: `/drivers/${players.find((p) => p.slug === myDriver)?.slug ?? players[0]?.slug ?? ''}` }[k];
        if (to) {
          e.preventDefault();
          navigate(to);
        }
        return;
      }
      if (k === 'g') {
        pendingG.current = Date.now();
        return;
      }
      if (k === 'l') {
        e.preventDefault();
        if (location.pathname === '/log') document.getElementById('laptime')?.focus();
        else navigate('/log');
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        if (location.pathname === '/circuits') document.getElementById('circuit-search')?.focus();
        else {
          navigate('/circuits');
          window.setTimeout(() => document.getElementById('circuit-search')?.focus(), 150);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, location.pathname, players]);

  if (!open) return null;
  const initials = players.map((p) => `${p.name[0]?.toUpperCase()} ${p.name}`).join(' · ');
  return (
    <Modal label="Keyboard shortcuts" onClose={() => setOpen(false)}>
      <div className="modal-body shortcuts">
        <div className="modal-title">Keyboard shortcuts</div>
        <section>
          <h3>Anywhere</h3>
          <dl>
            <dt><kbd>L</kbd></dt><dd>Log a lap</dd>
            <dt><kbd>G</kbd> <kbd>H</kbd></dt><dd>Home</dd>
            <dt><kbd>G</kbd> <kbd>T</kbd></dt><dd>Tracks</dd>
            <dt><kbd>G</kbd> <kbd>L</kbd></dt><dd>Laps</dd>
            <dt><kbd>G</kbd> <kbd>S</kbd></dt><dd>Stats</dd>
            <dt><kbd>G</kbd> <kbd>D</kbd></dt><dd>Your driver page</dd>
            <dt><kbd>/</kbd></dt><dd>Search tracks</dd>
            <dt><kbd>?</kbd></dt><dd>This list</dd>
          </dl>
        </section>
        <section>
          <h3>Log a lap</h3>
          <dl>
            <dt><kbd>0</kbd>–<kbd>9</kbd></dt><dd>Type the time (six digits, e.g. 128750)</dd>
            <dt>{players.map((p) => <kbd key={p.id}>{p.name[0]?.toUpperCase()}</kbd>)}</dt><dd>Pick the driver ({initials})</dd>
            <dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Previous / next track</dd>
            <dt><kbd>Enter</kbd></dt><dd>Save the lap</dd>
            <dt><kbd>N</kbd></dt><dd>Log another (after saving)</dd>
            <dt><kbd>Esc</kbd></dt><dd>Close a popup</dd>
          </dl>
        </section>
        <p className="help" style={{ margin: 0 }}>Example: <kbd>L</kbd> <kbd>R</kbd> <kbd>]</kbd> 1 2 8 7 5 0 <kbd>Enter</kbd> logs 1:28.750 for Rag at the next track.</p>
      </div>
      <div className="modal-actions" style={{ gridTemplateColumns: '1fr' }}>
        <button type="button" onClick={() => setOpen(false)} data-autofocus>Close</button>
      </div>
    </Modal>
  );
}
