import { useEffect, useRef, type RefObject } from 'react';
import { TRACK_GEOMETRY } from '../data/trackGeometry';
import { distanceAt } from '../lib/lapPace';

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
  /**
   * Detailed outlines only: a white dot laps the circuit from the finish line,
   * taking exactly this long (ms) per lap — e.g. the circuit record.
   */
  lapMs?: number | null;
}

/** Real circuit outline (see THIRD_PARTY_NOTICES.md). Strokes don't scale with size. */
export function TrackOutline({ slug, colour, detailed = false, strokeWidth = 1.6, className, dashed, title, animate = false, lapMs }: Props) {
  const g = TRACK_GEOMETRY[slug];
  const lineRef = useRef<SVGPathElement>(null);
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
        <path ref={lineRef} d={g.d} stroke={colour} strokeWidth={0.9} pathLength={1} className="track-draw"
          fill="none" strokeLinejoin="round" strokeLinecap="round" />
      ) : (
        <path ref={lineRef} d={g.d} stroke={colour} strokeWidth={detailed ? 3.5 : strokeWidth} strokeDasharray={dashed ? '4 4' : undefined} {...common} />
      )}
      {detailed && (
        <g className={animate ? 'track-details' : undefined}>
          <path d={g.pit} stroke="#FFFFFF" strokeWidth={3.5} {...common} />
          <path d={g.s1} stroke="#FFFFFF" strokeWidth={2.5} {...common} />
          <path d={g.s2} stroke="#FFFFFF" strokeWidth={2.5} {...common} />
          <path d={g.sf} stroke="#E10600" strokeWidth={3} {...common} />
        </g>
      )}
      {detailed && lapMs != null && lapMs > 0 && (
        <LapCar line={lineRef} start={g.start} reverse={g.reverse} pace={g.pace} lapMs={lapMs} delayMs={animate ? 1400 : 0} />
      )}
    </svg>
  );
}

/**
 * A dot that laps the circuit from the finish line, taking exactly `lapMs` per
 * lap. Within the lap it follows a real pole lap's pace (braking into corners,
 * accelerating out), scaled to the record time. Hidden for reduced motion.
 */
function LapCar({ line, start, reverse, pace, lapMs, delayMs }: {
  line: RefObject<SVGPathElement>; start: number; reverse: boolean; pace: readonly number[]; lapMs: number; delayMs: number;
}) {
  const dot = useRef<SVGGElement>(null);
  useEffect(() => {
    const path = line.current;
    const el = dot.current;
    if (!path || !el || typeof path.getTotalLength !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let total: number;
    try {
      total = path.getTotalLength();
    } catch {
      return;
    }
    if (!total) return;
    const place = (lapTime: number) => {
      const frac = distanceAt(pace, lapTime);
      const f = (((start + (reverse ? -frac : frac)) % 1) + 1) % 1;
      const p = path.getPointAtLength(f * total);
      // Keep the dot the same size on screen however large the outline is drawn.
      const k = 1 / (path.getScreenCTM()?.a || 1);
      el.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${k})`);
    };
    place(0);
    const t0 = performance.now() + delayMs;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = Math.max(0, now - t0);
      place((elapsed % lapMs) / lapMs);
      if (elapsed > 0) el.style.opacity = '1';
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [line, start, reverse, pace, lapMs, delayMs]);
  return (
    <g ref={dot} className="lap-car" aria-hidden="true" data-lap-ms={lapMs}>
      {/* Sizes in screen pixels (see the scale above): a 10px dot with a dark rim. */}
      <circle r={5} fill="#FFFFFF" stroke="#0A0A0C" strokeWidth={2} />
    </g>
  );
}
