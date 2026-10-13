import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function LoadingState({ label = 'Loading timing data…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="skeleton" style={{ width: 220, height: 14 }} />
      <div className="skeleton" style={{ width: 160, height: 14 }} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <h2>Couldn’t load data</h2>
      <p>{message}</p>
      {onRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, children, action = true }: { title: string; children?: ReactNode; action?: boolean }) {
  return (
    <div className="state">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action && <Link to="/log" className="btn btn-primary">LOG A LAP</Link>}
    </div>
  );
}
