/** Fraction of the lap distance covered after `t` (0–1) of the lap time. */
export function distanceAt(pace: readonly number[], t: number): number {
  const steps = pace.length - 1;
  if (steps < 1) return t;
  const x = Math.min(Math.max(t, 0), 1) * steps;
  const i = Math.min(Math.floor(x), steps - 1);
  const a = pace[i]!, b = pace[i + 1]!;
  return (a + (b - a) * (x - i)) / pace[steps]!;
}
