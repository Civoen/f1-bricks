import { useState } from 'react';
import { fmtDateTime, fmtDay } from '../lib/format';
import { formatLapTime } from '../lib/laptime';
import { pbProgression } from '../lib/records';
import type { Lap, Player } from '../lib/types';

const W = 640, H = 280, L = 64, R = 16, T = 14, B = 30;

/**
 * Personal-best progression as step lines on a time axis. A flat line is a
 * period with no improvement; each step down is a new PB. Players with no
 * laps are listed as such rather than drawn at zero.
 */
export function ProgressionChart({ laps, players }: { laps: Lap[]; players: Player[] }) {
  const [hover, setHover] = useState<{ x: number; y: number; player: Player; lap: Lap } | null>(null);
  const series = players.map((p) => ({ player: p, points: pbProgression(laps, p.id) }));
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;

  const t0 = Math.min(...all.map((l) => Date.parse(l.recorded_at)));
  const t1 = Math.max(Date.now(), ...all.map((l) => Date.parse(l.recorded_at)));
  const span = Math.max(t1 - t0, 86400000);
  const vMin = Math.min(...all.map((l) => l.lap_time_ms));
  const vMax = Math.max(...all.map((l) => l.lap_time_ms));
  const pad = Math.max(100, Math.round((vMax - vMin) * 0.12));
  const y0 = vMin - pad, y1 = vMax + pad;

  const x = (iso: string) => L + ((Date.parse(iso) - t0) / span) * (W - L - R);
  const xEnd = W - R;
  const y = (ms: number) => T + ((ms - y0) / (y1 - y0)) * (H - T - B); // faster = higher on the chart

  const yTicks = Array.from({ length: 4 }, (_, i) => Math.round(y0 + ((y1 - y0) * (i + 0.5)) / 4));
  const xTicks = Array.from({ length: 4 }, (_, i) => new Date(t0 + (span * i) / 3).toISOString());

  return (
    <div>
      <div className="legend" style={{ marginBottom: 8 }}>
        {series.map((s) => (
          <span key={s.player.id} style={{ color: s.player.colour_hex }}>
            ● {s.player.name.toUpperCase()}
            {s.points.length === 0 && <span className="muted" style={{ fontWeight: 500 }}> · no laps</span>}
          </span>
        ))}
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Personal best progression. ${series.map((s) =>
          s.points.length ? `${s.player.name}: ${s.points.map((p) => formatLapTime(p.lap_time_ms)).join(' to ')}` : `${s.player.name}: no laps`).join('. ')}`}>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#202026" />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" fill="#92929B" fontFamily="JetBrains Mono, monospace" fontSize="10">{formatLapTime(v)}</text>
            </g>
          ))}
          <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#333338" />
          {xTicks.map((iso, i) => (
            <text key={iso} x={L + (i / 3) * (W - L - R)} y={H - 10} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}
              fill="#92929B" fontFamily="JetBrains Mono, monospace" fontSize="10">{fmtDay(iso).toUpperCase()}</text>
          ))}
          {series.map(({ player, points }) => {
            if (!points.length) return null;
            let d = `M${x(points[0]!.recorded_at)} ${y(points[0]!.lap_time_ms)}`;
            for (let i = 1; i < points.length; i++) {
              d += ` H${x(points[i]!.recorded_at)} V${y(points[i]!.lap_time_ms)}`;
            }
            d += ` H${xEnd}`;
            return (
              <g key={player.id}>
                <path d={d} fill="none" stroke={player.colour_hex} strokeWidth="2.5" strokeLinejoin="round" />
                {points.map((p) => (
                  <circle key={p.id} cx={x(p.recorded_at)} cy={y(p.lap_time_ms)} r="4.5" fill={player.colour_hex}
                    stroke="#0A0A0C" strokeWidth="1.5" tabIndex={0} style={{ cursor: 'pointer', outline: 'none' }}
                    onMouseEnter={() => setHover({ x: x(p.recorded_at), y: y(p.lap_time_ms), player, lap: p })}
                    onFocus={() => setHover({ x: x(p.recorded_at), y: y(p.lap_time_ms), player, lap: p })}
                    onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}>
                    <title>{`${player.name} ${formatLapTime(p.lap_time_ms)} · ${fmtDateTime(p.recorded_at)}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="chart-tip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
            <b style={{ color: hover.player.colour_hex }}>{hover.player.name}</b>{' '}
            <span className="mono">{formatLapTime(hover.lap.lap_time_ms)}</span>
            <div className="muted">{fmtDateTime(hover.lap.recorded_at)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
