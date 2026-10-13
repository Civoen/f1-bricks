import { TRACK_GEOMETRY } from '../data/trackGeometry';

interface Props {
  slug: string;
  colour: string;
  /** Large rendering with white start/finish straight, sector ticks and a halo. */
  detailed?: boolean;
  strokeWidth?: number;
  className?: string;
  dashed?: boolean;
  title?: string;
  /** Draw the lap on mount (detailed outlines only). Remount with a new key to replay. */
  animate?: boolean;
}

/** Real circuit outline (see THIRD_PARTY_NOTICES.md). Strokes don't scale with size. */
export function TrackOutline({ slug, colour, detailed = false, strokeWidth = 1.6, className, dashed, title, animate = false }: Props) {
  const g = TRACK_GEOMETRY[slug];
  const common = { fill: 'none', strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' } as const;
  if (!g) {
    return (
      <svg className={className} viewBox="0 0 100 60" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title}>
        <rect x="10" y="10" width="80" height="40" rx="20" stroke={colour} strokeWidth={strokeWidth} {...common} />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox={g.viewBox} preserveAspectRatio="xMidYMid meet"
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title}>
      {detailed && <path d={g.d} stroke="#202026" strokeWidth={18} {...common} />}
      {animate ? (
        // Dash-based drawing needs a stroke in drawing units (non-scaling strokes
        // break dash lengths). The outline is normalised to ~100 units across.
        <path d={g.d} stroke={colour} strokeWidth={0.9} pathLength={1} className="track-draw"
          fill="none" strokeLinejoin="round" strokeLinecap="round" />
      ) : (
        <path d={g.d} stroke={colour} strokeWidth={detailed ? 3.5 : strokeWidth} strokeDasharray={dashed ? '4 4' : undefined} {...common} />
      )}
      {detailed && (
        <g className={animate ? 'track-details' : undefined}>
          <path d={g.pit} stroke="#FFFFFF" strokeWidth={3.5} {...common} />
          <path d={g.s1} stroke="#FFFFFF" strokeWidth={2.5} {...common} />
          <path d={g.s2} stroke="#FFFFFF" strokeWidth={2.5} {...common} />
          <path d={g.sf} stroke="#E10600" strokeWidth={3} {...common} />
        </g>
      )}
    </svg>
  );
}
