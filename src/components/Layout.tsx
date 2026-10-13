import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { DEMO_MODE } from '../lib/config';
import { useData } from '../state/data';
import { HomeIcon, LapsIcon, LogIcon, Logo, StatsIcon, TracksIcon } from './Icons';

interface NavItem { to: string; label: string; icon: JSX.Element; end?: boolean; log?: boolean }

const NAV: NavItem[] = [
  { to: '/', label: 'HOME', icon: <HomeIcon />, end: true },
  { to: '/log', label: 'LOG', icon: <span className="log-mark"><LogIcon /></span>, log: true },
  { to: '/circuits', label: 'TRACKS', icon: <TracksIcon /> },
  { to: '/history', label: 'LAPS', icon: <LapsIcon /> },
  { to: '/stats', label: 'STATS', icon: <StatsIcon /> }
];

const fullNames: Record<string, string> = {
  HOME: 'Dashboard', LOG: 'Log a lap', TRACKS: 'Circuits', LAPS: 'Lap history', STATS: 'Statistics'
};

export function Layout() {
  const { online, error, snapshot, refresh } = useData();
  const location = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);
  // Each page opens at the top (the main area is its own scroll container).
  useEffect(() => {
    mainRef.current?.scrollTo?.(0, 0);
    window.scrollTo?.(0, 0);
  }, [location.pathname]);
  const cls = (base: string, log?: boolean) => ({ isActive }: { isActive: boolean }) =>
    `${base}${log ? ' is-log' : ''}${isActive ? ' active' : ''}`;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <NavLink to="/" className="rail-logo" aria-label="F1 Bricks home"><Logo /><span className="wordmark" aria-hidden="true">F1<br />BRICKS</span></NavLink>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={cls('rail-link', n.log)} aria-label={fullNames[n.label]}>
            {n.icon}
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="main" ref={mainRef}>
        {DEMO_MODE && (
          <div className="banner banner-demo" role="note">DEMO DATA — fictional sample laps held in this browser only. Nothing is saved.</div>
        )}
        {!online && (
          <div className="banner banner-offline" role="status">You’re offline. Times shown may be out of date and new laps can’t be saved until you reconnect.</div>
        )}
        {online && error && snapshot && (
          <div className="banner banner-error" role="alert">
            Couldn’t refresh: {error}
            <button type="button" className="btn btn-sm" onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        <div className="route" key={location.pathname}>
          <Outlet />
        </div>
      </div>

      <nav className="bottom-nav" aria-label="Primary">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={cls('', n.log)} aria-label={fullNames[n.label]}>
            {n.icon}
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
