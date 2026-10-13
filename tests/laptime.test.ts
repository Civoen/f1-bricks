import { describe, expect, it } from 'vitest';
import { compareLapTimes, formatGap, formatLapTime, formatSeconds, isCompleteLapTimeInput, maskLapTimeInput, parseLapTime } from '../src/lib/laptime';

describe('parseLapTime', () => {
  it.each([
    ['1:10.482', 70482],
    ['1:34.125', 94125],
    ['2:03.700', 123700],
    ['01:10.482', 70482],
    ['  1:28.903 ', 88903],
    ['58.123', 58123],
    ['0:58.123', 58123],
    ['1:10.48', 70480],
    ['1:10.4', 70400],
    ['59:59.999', 3599999]
  ])('parses %s as %i ms', (input, ms) => {
    expect(parseLapTime(input)).toEqual({ ok: true, ms });
  });

  it.each(['', '   ', 'abc', '1:70.000', '1:10', '1.10.482', '-1:10.482', '1:10.4821', '1:1.482', ':10.482', '1:10,482', '60:00.000', '0:00.000', '0.000'])(
    'rejects %j',
    (input) => {
      const r = parseLapTime(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  );

  it('never accepts a negative time', () => {
    expect(parseLapTime('-0:58.123').ok).toBe(false);
  });
});

describe('maskLapTimeInput', () => {
  it.each([
    ['', ''],
    ['1', '1'],
    ['12', '1:2'],
    ['128', '1:28'],
    ['1287', '1:28.7'],
    ['12875', '1:28.75'],
    ['128750', '1:28.750'],
    ['1287509', '1:28.750'],
    ['1:28.750', '1:28.750'],
    ['1:28:750', '1:28.750'],
    ['a1b2c8', '1:28'],
    ['1:28.', '1:28']
  ])('masks %j as %j', (raw, masked) => {
    expect(maskLapTimeInput(raw)).toBe(masked);
  });

  it('is complete only with all six digits and parses to milliseconds', () => {
    expect(isCompleteLapTimeInput('1:28.75')).toBe(false);
    expect(isCompleteLapTimeInput('1:28.750')).toBe(true);
    const r = parseLapTime(maskLapTimeInput('128750'));
    expect(r).toEqual({ ok: true, ms: 88750 });
  });
});

describe('formatting', () => {
  it('formats milliseconds as m:ss.mmm', () => {
    expect(formatLapTime(70482)).toBe('1:10.482');
    expect(formatLapTime(58123)).toBe('0:58.123');
    expect(formatLapTime(123700)).toBe('2:03.700');
    expect(formatLapTime(60000)).toBe('1:00.000');
  });

  it('round-trips parse → format', () => {
    for (const t of ['1:10.482', '1:28.903', '2:03.700', '0:58.001']) {
      const r = parseLapTime(t);
      expect(r.ok && formatLapTime(r.ms)).toBe(t);
    }
  });

  it('rejects non-integer or negative milliseconds', () => {
    expect(() => formatLapTime(1.5)).toThrow();
    expect(() => formatLapTime(-1)).toThrow();
  });

  it('formats gaps with millisecond precision and sign', () => {
    expect(formatGap(214)).toBe('+0.214');
    expect(formatGap(-214)).toBe('−0.214');
    expect(formatGap(0)).toBe('±0.000');
    expect(formatGap(1005)).toBe('+1.005');
    expect(formatSeconds(61234)).toBe('61.234');
  });

  it('computes exact integer gaps (no floating point drift)', () => {
    const a = parseLapTime('1:29.117');
    const b = parseLapTime('1:28.903');
    expect(a.ok && b.ok && a.ms - b.ms).toBe(214);
    expect(a.ok && b.ok && compareLapTimes(b.ms, a.ms)).toBeLessThan(0);
  });
});
