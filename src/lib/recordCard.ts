/**
 * Shareable record card: a 1080×1080 PNG drawn on a canvas in the browser
 * (no server, no extra libraries). Shared through the phone's share sheet
 * where available, otherwise downloaded.
 */
import { TRACK_GEOMETRY } from '../data/trackGeometry';
import { fmtDate } from './format';
import { formatLapTime, formatSeconds } from './laptime';

export interface RecordCardData {
  circuitSlug: string;
  circuitName: string;
  country: string | null;
  round: number;
  timeMs: number;
  holderName: string;
  holderColour: string;
  achievedAt: string;
  previous: { name: string; colour: string; timeMs: number } | null;
  standings: { name: string; colour: string; timeMs: number | null }[];
}

const SIZE = 1080;
const DISPLAY = '"Big Shoulders Display", "Arial Narrow", sans-serif';
const BODY = 'Barlow, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

async function fontsReady() {
  if (!('fonts' in document)) return;
  await Promise.all([
    document.fonts.load(`900 120px ${DISPLAY}`),
    document.fonts.load(`800 120px ${DISPLAY}`),
    document.fonts.load(`700 30px ${BODY}`),
    document.fonts.load(`700 30px ${MONO}`)
  ]).catch(() => undefined);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, weight: string, family: string, maxSize: number, maxWidth: number) {
  let size = maxSize;
  do {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  } while (size > 24);
  return size;
}

export async function renderRecordCard(d: RecordCardData): Promise<Blob> {
  await fontsReady();
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  // Ground
  ctx.fillStyle = '#0A0A0C';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Track outline, large, right side
  const g = TRACK_GEOMETRY[d.circuitSlug];
  if (g) {
    const [vx, vy, vw, vh] = g.viewBox.split(' ').map(Number) as [number, number, number, number];
    // Its own band between the name and the time, right-aligned.
    const box = { x: 400, y: 380, w: 610, h: 250 };
    const scale = Math.min(box.w / vw, box.h / vh);
    const ox = box.x + (box.w - vw * scale) / 2 - vx * scale;
    const oy = box.y + (box.h - vh * scale) / 2 - vy * scale;
    const stroke = (path: string, colour: string, width: number) => {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = colour;
      ctx.lineWidth = width / scale;
      ctx.stroke(new Path2D(path));
      ctx.restore();
    };
    stroke(g.d, '#202026', 30);
    stroke(g.d, d.holderColour, 7);
    stroke(g.pit, '#FFFFFF', 7);
    stroke(g.s1, '#FFFFFF', 5);
    stroke(g.s2, '#FFFFFF', 5);
    stroke(g.sf, '#E10600', 6);
  }

  // Brand mark
  ctx.fillStyle = '#E10600';
  ctx.beginPath();
  ctx.moveTo(72, 108); ctx.lineTo(96, 72); ctx.lineTo(148, 72); ctx.lineTo(124, 108);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 40px ${DISPLAY}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('F1 BRICKS', 166, 104);
  ctx.fillStyle = '#92929B';
  ctx.font = `700 22px ${BODY}`;
  ctx.textAlign = 'right';
  ctx.fillText('F1 25 TIME TRIAL', SIZE - 72, 102);
  ctx.textAlign = 'left';

  // Eyebrow + circuit name
  ctx.fillStyle = '#FF6B63';
  ctx.font = `700 26px ${BODY}`;
  const eyebrow = `NEW CIRCUIT RECORD · ROUND ${String(d.round).padStart(2, '0')}${d.country ? ` · ${d.country.toUpperCase()}` : ''}`;
  ctx.fillText(eyebrow.split('').join(String.fromCharCode(8202)), 72, 200);
  ctx.fillStyle = '#FFFFFF';
  const nameSize = fitText(ctx, d.circuitName.toUpperCase(), '900', DISPLAY, 150, SIZE - 144);
  ctx.font = `900 ${nameSize}px ${DISPLAY}`;
  ctx.fillText(d.circuitName.toUpperCase(), 68, 200 + nameSize * 0.92);

  // Record time + holder
  const timeY = 760;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 190px ${DISPLAY}`;
  ctx.fillText(formatLapTime(d.timeMs), 64, timeY);
  ctx.fillStyle = d.holderColour;
  ctx.font = `900 76px ${DISPLAY}`;
  ctx.fillText(d.holderName.toUpperCase(), 72, timeY + 84);
  ctx.fillStyle = '#92929B';
  ctx.font = `600 30px ${BODY}`;
  const sub = d.previous
    ? `−${formatSeconds(d.previous.timeMs - d.timeMs)}s on ${d.previous.name} · ${fmtDate(d.achievedAt)}`
    : `First record at this circuit · ${fmtDate(d.achievedAt)}`;
  ctx.fillText(sub, 72, timeY + 132);

  // Standings strip
  const stripY = 950;
  const colW = (SIZE - 144 - 24) / 3;
  let pos = 0;
  d.standings.slice(0, 3).forEach((s, i) => {
    if (s.timeMs !== null) pos++;
    const x = 72 + i * (colW + 12);
    ctx.fillStyle = '#17171B';
    ctx.fillRect(x, stripY, colW, 70);
    ctx.fillStyle = s.timeMs !== null ? s.colour : '#333338';
    ctx.fillRect(x, stripY, colW, 5);
    ctx.fillStyle = s.colour;
    ctx.font = `700 22px ${BODY}`;
    ctx.fillText(s.timeMs !== null ? `P${pos} ${s.name.toUpperCase()}` : s.name.toUpperCase(), x + 16, stripY + 34);
    ctx.fillStyle = s.timeMs !== null ? '#FFFFFF' : '#92929B';
    ctx.font = `700 24px ${MONO}`;
    ctx.fillText(s.timeMs !== null ? formatLapTime(s.timeMs) : 'No time', x + 16, stripY + 60);
  });

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png')
  );
}

/** Opens the share sheet with the image, or downloads it where sharing files isn't supported. */
export async function shareRecordCard(blob: Blob, filename: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
