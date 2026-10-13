const base = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true } as const;

export const HomeIcon = () => (
  <svg {...base}><path d="M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z" stroke="currentColor" strokeWidth="1.6" /></svg>
);
export const LogIcon = () => (
  <svg {...base} width={16} height={16}><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
);
export const TracksIcon = () => (
  <svg {...base}><path d="M4 15 C2 10 5 7 8 8 C11 9 10 4 13 3 C17 2 18 6 16 9 C14 12 17 14 13 16 C9 18 5 18 4 15Z" stroke="currentColor" strokeWidth="1.6" /></svg>
);
export const LapsIcon = () => (
  <svg {...base}><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" /><path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.6" /></svg>
);
export const StatsIcon = () => (
  <svg {...base}><path d="M4 16V9M10 16V4M16 16v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
);
export const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 3l12 12M15 3L3 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
export const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 2.5l3 3L5 14H2v-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
);
export const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
);
export const Logo = ({ size = 36 }: { size?: number }) => (
  <svg width={size} height={(size * 20) / 36} viewBox="0 0 34 18" aria-hidden="true"><path d="M2 16 L12 2 H32 L22 16 Z" fill="#E10600" /></svg>
);
