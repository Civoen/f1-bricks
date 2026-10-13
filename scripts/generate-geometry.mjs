#!/usr/bin/env node
/**
 * Generates src/data/trackGeometry.ts from the open-source F1 circuits GeoJSON
 * (https://github.com/bacinger/f1-circuits, MIT licence — see THIRD_PARTY_NOTICES.md).
 *
 * Usage:
 *   node scripts/generate-geometry.mjs path/to/f1-circuits.geojson
 *
 * Each outline is projected to a flat SVG path that fits a 100-unit box, with:
 *   - pit:  the start/finish straight (drawn white in the UI)
 *   - sf:   a short tick across the finish line
 *   - pace: real lap pace from scripts/lap-pace.json (for the lapping dot)
 *   - s1/s2: ticks at the real sector 1/2 and 2/3 timing lines
 *
 * Line positions come from scripts/sector-positions.json: fractions of distance
 * along each outline, derived from real 2025 F1 laps (OpenF1 position data and
 * official sector times) aligned to the outline.
 *
 * To add a circuit: add its slug → GeoJSON id below, re-run, and add the
 * circuit row in a new Supabase migration (the circuit list lives in the DB).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SLUG_TO_GEO_ID = {
  'albert-park': 'au-1953',
  shanghai: 'cn-2004',
  suzuka: 'jp-1962',
  bahrain: 'bh-2002',
  jeddah: 'sa-2021',
  miami: 'us-2022',
  imola: 'it-1953',
  monaco: 'mc-1929',
  barcelona: 'es-1991',
  montreal: 'ca-1978',
  'red-bull-ring': 'at-1969',
  silverstone: 'gb-1948',
  spa: 'be-1925',
  hungaroring: 'hu-1986',
  zandvoort: 'nl-1948',
  monza: 'it-1922',
  baku: 'az-2016',
  'marina-bay': 'sg-2008',
  cota: 'us-2012',
  'mexico-city': 'mx-1962',
  interlagos: 'br-1940',
  'las-vegas': 'us-2023',
  lusail: 'qa-2004',
  'yas-marina': 'ae-2009'
};

const here0 = path.dirname(fileURLToPath(import.meta.url));
const SECTOR_POSITIONS = JSON.parse(fs.readFileSync(path.join(here0, 'sector-positions.json'), 'utf8'));
const LAP_PACE = JSON.parse(fs.readFileSync(path.join(here0, 'lap-pace.json'), 'utf8'));

const TICK_HALF = 3;
const PAD = 7;

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/generate-geometry.mjs path/to/f1-circuits.geojson');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const byId = new Map(data.features.map((f) => [f.properties.id, f]));

const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const adiff = (x, y) => {
  const d = Math.abs(x - y) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const pt = (p) => `${f1(p[0])} ${f1(p[1])}`;

function paceFor(slug) {
  const p = LAP_PACE[slug]?.pace;
  if (!p) throw new Error(`No lap pace for ${slug} in scripts/lap-pace.json`);
  return p;
}

const out = {};
for (const [slug, geoId] of Object.entries(SLUG_TO_GEO_ID)) {
  const feat = byId.get(geoId);
  if (!feat) throw new Error(`GeoJSON id ${geoId} not found for ${slug}`);
  let pts = feat.geometry.coordinates;
  const last = pts[pts.length - 1];
  if (pts[0][0] === last[0] && pts[0][1] === last[1]) pts = pts.slice(0, -1);

  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xy = pts.map((p) => [p[0] * k, -p[1]]);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const s = 100 / Math.max(maxx - minx, maxy - miny);
  const P = xy.map(([x, y]) => [(x - minx) * s, (y - miny) * s]);
  const n = P.length;
  const w = (maxx - minx) * s;
  const h = (maxy - miny) * s;

  const seg = P.map((p, i) => Math.hypot(P[(i + 1) % n][0] - p[0], P[(i + 1) % n][1] - p[1]));
  const L = seg.reduce((a, b) => a + b, 0);
  const locate = (frac) => {
    let t = (((frac % 1) + 1) % 1) * L, acc = 0;
    for (let i = 0; i < n; i++) {
      if (acc + seg[i] >= t) {
        const u = (t - acc) / seg[i];
        const a = P[i], b = P[(i + 1) % n];
        return { i, x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, a: ang(a, b) };
      }
      acc += seg[i];
    }
    return { i: 0, x: P[0][0], y: P[0][1], a: ang(P[0], P[1]) };
  };
  const tick = (frac) => {
    const { x, y, a } = locate(frac);
    const nx = -Math.sin(a), ny = Math.cos(a);
    return `M${pt([x - nx * TICK_HALF, y - ny * TICK_HALF])} L${pt([x + nx * TICK_HALF, y + ny * TICK_HALF])}`;
  };
  const pos = SECTOR_POSITIONS[slug];
  if (!pos) throw new Error(`No sector positions for ${slug} in scripts/sector-positions.json`);

  // Start/finish straight: from the finish line, follow the track both ways
  // while its heading stays within 12° of the heading at the line.
  const f = locate(pos.sf);
  const tol = (12 * Math.PI) / 180;
  const fwd = [];
  for (let i = (f.i + 1) % n, steps = 0; steps < n / 4; steps++) {
    const j = (i + 1) % n;
    fwd.push(i);
    if (adiff(ang(P[i], P[j]), f.a) > tol) break;
    i = j;
  }
  const back = [];
  for (let i = f.i, steps = 0; steps < n / 4; steps++) {
    const j = (i - 1 + n) % n;
    back.unshift(i);
    if (adiff(ang(P[j], P[i]), f.a) > tol) break;
    i = j;
  }
  const pitPts = [...back.map((i) => P[i]), [f.x, f.y], ...fwd.map((i) => P[i])];

  out[slug] = {
    viewBox: `${f1(-PAD)} ${f1(-PAD)} ${f1(w + 2 * PAD)} ${f1(h + 2 * PAD)}`,
    d: 'M' + P.map(pt).join(' L') + ' Z',
    pit: 'M' + pitPts.map(pt).join(' L'),
    sf: tick(pos.sf),
    s1: tick(pos.s1),
    s2: tick(pos.s2),
    // For the lap animation: where the lap starts along \`d\`, and whether the
    // cars run against the outline's point order (sector 1 comes after sector 2
    // when walking forward from the finish line).
    start: Math.round(pos.sf * 10000) / 10000,
    reverse: (((pos.s1 - pos.sf) % 1) + 1) % 1 > (((pos.s2 - pos.sf) % 1) + 1) % 1,
    pace: paceFor(slug)
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', 'src', 'data', 'trackGeometry.ts');
const body = `// GENERATED by scripts/generate-geometry.mjs — do not edit by hand.
// Outlines: https://github.com/bacinger/f1-circuits (MIT). See THIRD_PARTY_NOTICES.md.
// Finish line and sector lines from real 2025 F1 laps (see scripts/sector-positions.json).

export interface TrackGeometry {
  viewBox: string;
  /** Full lap outline */
  d: string;
  /** Start/finish straight */
  pit: string;
  /** Start/finish line tick */
  sf: string;
  /** Sector 1 → 2 boundary tick */
  s1: string;
  /** Sector 2 → 3 boundary tick */
  s2: string;
  /** Finish line position as a fraction of the length of \`d\` */
  start: number;
  /** True when the racing direction runs against the order of points in \`d\` */
  reverse: boolean;
  /**
   * How a real lap unfolds: distance covered (×10000) at 120 equal steps of
   * lap time, from a 2025 pole lap's speed trace. Drives the lapping dot.
   */
  pace: number[];
}

export const TRACK_GEOMETRY: Record<string, TrackGeometry> = ${JSON.stringify(out, null, 2)};
`;
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, body);
console.log(`Wrote ${Object.keys(out).length} circuits to ${path.relative(process.cwd(), target)}`);
