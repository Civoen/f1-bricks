import { describe, expect, it } from 'vitest';
import { distanceAt } from '../src/lib/lapPace';
import { TRACK_GEOMETRY } from '../src/data/trackGeometry';

describe('lapping dot', () => {
  it('every circuit has a usable real-lap pace profile', () => {
    expect(Object.keys(TRACK_GEOMETRY)).toHaveLength(24);
    for (const [slug, g] of Object.entries(TRACK_GEOMETRY)) {
      expect(g.pace[0], slug).toBe(0);
      expect(g.pace.at(-1), slug).toBe(10000);
      expect(g.pace.length, slug).toBe(121);
      for (let i = 1; i < g.pace.length; i++) expect(g.pace[i]!, slug).toBeGreaterThanOrEqual(g.pace[i - 1]!);
    }
  });

  it('starts on the line, finishes on the line, and slows for corners', () => {
    const p = TRACK_GEOMETRY.monaco!.pace;
    expect(distanceAt(p, 0)).toBe(0);
    expect(distanceAt(p, 1)).toBe(1);
    // Speed (distance per time step) varies a lot through a Monaco lap.
    const speeds = p.slice(1).map((v, i) => v - p[i]!);
    expect(Math.max(...speeds) / Math.min(...speeds)).toBeGreaterThan(4);
  });

  it('interpolates smoothly between pace steps', () => {
    const pace = [0, 2000, 10000];
    expect(distanceAt(pace, 0.25)).toBeCloseTo(0.1);
    expect(distanceAt(pace, 0.75)).toBeCloseTo(0.6);
  });
});
