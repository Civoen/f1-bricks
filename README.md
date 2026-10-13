# F1 Bricks — F1 25 time trial tracker

A web app and installable PWA for Rag, Adam and Ben (The Bricks) to log F1 25 time-trial laps. It works out personal bests and circuit records, and keeps the full history of who held each record and when.

**Stack:** React 18 + Vite + TypeScript · Cloudflare Pages + Pages Functions · Cloudflare D1 (SQLite) · GitHub. Everything runs on Cloudflare's free plan.

> **No sign-in.** Anyone who has the site's address can view, add, correct and delete laps, so keep the address between the three of you. Every change is still recorded in an audit trail (`lap_audit`), and deleted laps are soft-deleted, so mistakes and mischief can be traced and undone.

---

## What's in the box

| Page | What it does |
|---|---|
| **Home** | Featured circuit (where the latest record was set), real track outline with real sector lines, record and PBs. The timing tower lists all 24 rounds in 2025 calendar order on one screen; rivals within 0.100s of a record are highlighted as **under threat**. |
| **Log** | Pick driver and circuit, then just type the digits (`128750` → `1:28.750`). Shows the record and the driver's PB to beat, previews whether the lap is a record/PB/tie, confirms after saving, and offers **Undo** and a **record card**. |
| **Tracks** | Every circuit with search, filters (record holder, missing times, no laps) and sorting (calendar, A–Z, closest fight, most recently broken). |
| **Circuit page** | Record, PB leaderboard with millisecond gaps, a record timeline (including corrected history), a PB progression chart, recent laps, and a **Share record card** button. |
| **Laps** | Full lap history with filters, pagination, and correcting or deleting a lap. |
| **Stats** | Standings, key figures, **under threat** list, head-to-head for each pair, recent records and an activity feed. |

Times are stored as **integer milliseconds** (`1:10.482` → `70482`), so comparisons and gaps are exact.

---

## Project structure

```
functions/api/[[route]].ts  Cloudflare Pages Function: handles every /api/* request
server/api.ts               The API: reads, log/correct/delete a lap, record history, Discord alerts
server/schema.ts            D1 tables + reference data (players, circuits). Created automatically on first use
src/lib/laptime.ts          Parse/format lap times (tested)
src/lib/records.ts          PB, record, history, standings, head-to-head rules (shared by app and API, tested)
src/lib/backend.ts          The app's calls to /api
src/demo/demoBackend.ts     In-browser sample data for local preview only
src/data/trackGeometry.ts   Generated circuit outlines (see scripts/generate-geometry.mjs)
src/pages/*                 Dashboard, Log a lap, Circuits, Circuit detail, History, Stats
tests/                      Unit, API + database (real schema on SQLite) and page smoke tests
public/_headers             Security and caching headers
```

---

## Set up (GitHub web UI + Cloudflare, about 10 minutes)

No environment variables, no SQL to paste: the database tables are created automatically the first time the site loads.

1. **GitHub:** create a new repository, click *uploading an existing file*, and drag in **the contents** of this folder (so `package.json` is at the top level). Commit.
2. **Cloudflare → Storage & Databases → D1 → Create database.** Name it `f1-bricks`.
3. **Cloudflare → Workers & Pages → Create → Pages → Connect to Git**, choose the repo, and set:
   - **Framework preset:** None (or Vite)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`

   Save and Deploy.
4. In the new Pages project: **Settings → Bindings → Add → D1 database**. Variable name **`DB`**, database **`f1-bricks`**. Save.
5. **Deployments → ⋯ on the latest → Retry deployment** (bindings apply from the next deployment).
6. Open `https://<project>.pages.dev`. All 24 circuits appear with no laps yet.

If the site says *"The database isn't connected yet"*, the binding is missing or not named exactly `DB`, or you haven't redeployed since adding it.

Every commit to the repo redeploys the site automatically. Your laps live in D1, so redeploying never touches them.

### Picking a driver

There are no accounts. On **Log**, choose Rag, Adam or Ben; each device remembers the last driver chosen, so your own phone defaults to you. Add `?driver=rag` to the Log link to preselect a driver (handy for a home-screen shortcut).

---

## Install as an app (PWA)

- **iPhone/iPad:** open the site in Safari → Share → *Add to Home Screen*.
- **Android / desktop Chrome or Edge:** browser menu → *Install app*.

The service worker caches only the app shell, fonts and icons. Lap data always comes live from the API and is never served from cache. Laps logged on another phone appear within 30 seconds, or straight away when you switch back to the app. Logging a lap needs a connection; offline, the app says so and keeps what you typed.

---

## Discord record alerts (optional)

When a lap takes a circuit record, the site can post it to a Discord channel:

> **🏁 New record · Suzuka** — **Ben** sets **1:28.903**. Takes it from **Adam** (1:29.117) by **0.214s**

1. In Discord: channel → *Edit channel* → *Integrations* → *Webhooks* → *New webhook* → *Copy webhook URL*.
2. In Cloudflare: your Pages project → **Settings → Variables and Secrets → Add**. Type **Secret**, name **`DISCORD_WEBHOOK_URL`**, value the webhook URL. Save, then retry the latest deployment.

Delete the secret (and redeploy) to stop alerts. Alerts go out for new records only (not corrections), link back to the circuit page, and a failed post never stops a lap being saved.

## Record cards

On a circuit page (or straight after setting a record) **Share record card** builds a 1080×1080 image in the browser: circuit, outline, time, holder, margin and the three PBs. On phones it opens the share sheet (WhatsApp, Discord, Messages…); on desktop it downloads a PNG.

## Under threat

A record is *under threat* when a rival's PB is within **0.100s** of it (a tie counts). Change `THREAT_MS` in `src/lib/records.ts` to adjust.

## How records are worked out

These rules live in `src/lib/records.ts`, which both the app and the API (`server/api.ts`) use, so they always agree. Both are covered by tests.

1. The fastest lap is the lowest millisecond value. A missing time is never zero.
2. PBs are per driver per circuit. The circuit record is the fastest lap across all three.
3. Laps are ordered by **when they were set** (`recorded_at`), then by when they were entered, then by id.
4. A lap takes the record only if it is **strictly faster** than every earlier lap. **Identical times never take a record:** the lap set first keeps it, and the UI says "ties the record".
5. Every lap is kept, slow ones included. Slower laps never create record events.
6. `record_events` holds each change of record (first record, then each one broken), with previous and new holder, times and achievement date.
7. Every write saves the lap, its audit entry and the circuit's record history in **one D1 batch** (a transaction), so they can never disagree. **Corrections and deletions** rebuild that circuit's history; old events are kept and marked *superseded*, so the original history stays visible under "Corrected history" on the circuit page. Deletions are soft (`deleted_at`) and audited.
8. Two saves at the same circuit at the same moment can't both win: each claims the circuit's next revision number, and the loser re-reads and retries. A unique index allows only one active event per position. Each submission carries an idempotency key, so a double-click or retry can't save the same lap twice.

**Standings** rank drivers by current records held. Ties are broken by second places, then by the fixed driver order, and equal record counts share a position. **Head-to-head** compares PBs only on circuits where both drivers have a time. Its average is the mean absolute PB gap across those circuits.

**Times** are stored as UTC and shown in each viewer's local time zone.

---

## Circuits and track outlines

The circuit list lives in the database (`circuits` table, seeded in calendar order from `server/schema.ts`). To add a layout F1 25 offers, such as a reverse layout, run this in **Cloudflare → D1 → f1-bricks → Console**:

```sql
INSERT INTO circuits (slug, name, short_name, code, country, display_order)
VALUES ('silverstone-reverse', 'Silverstone Circuit (Reverse)', 'Silverstone R', 'GBR', 'Great Britain', 25);
```

To hide one: `UPDATE circuits SET is_active = 0 WHERE slug = '…';`

Outlines come from the open-source [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) GeoJSON (MIT). To add or refresh outlines:

```bash
node scripts/generate-geometry.mjs path/to/f1-circuits.geojson
```

The script maps circuit slugs to GeoJSON ids, then draws the finish line (red), the start/finish straight (white) and the two **real sector lines** from `scripts/sector-positions.json`. Those positions were derived from each circuit's fastest 2025 qualifying lap (Baku: 2025 race) using [OpenF1](https://openf1.org) car-position data and official sector times, aligned to the outline. A reverse layout can reuse its forward outline by adding its slug to the map and a positions entry.

---

## Backups

D1 keeps point-in-time history (**Time Travel**: 7 days on the free plan, 30 on paid), so the database can be restored to any minute in that window. For a copy you keep yourself, run `SELECT * FROM lap_entries` in the D1 console and download the result, or with Node installed:

```bash
npx wrangler d1 export f1-bricks --remote --output backup.sql
```

`lap_entries` is the source of truth; everything else can be rebuilt from it.

---

## Run it locally (optional)

Requires Node 22.

```bash
npm install
npm test             # unit, API + database, and UI smoke tests
npm run dev:demo     # preview with sample data (nothing saved; grey DEMO DATA banner)
```

To run the real API with a local D1 database:

```bash
npm run build
npx wrangler pages dev dist --d1 DB=f1-bricks-local
```

---

## Tests

- `tests/laptime.test.ts`: parsing, formatting, millisecond conversion, gaps and invalid input.
- `tests/records.test.ts`: PBs, records, missing times, ties, history, corrections, duplicates, standings and head-to-head.
- `tests/api.test.ts`: runs the **real API and schema** on SQLite (the engine behind D1). Covers automatic setup, first record, Rag → Adam → Ben, slower laps, ties, idempotent retries, back-dated laps, simultaneous saves at one circuit, deleting and correcting record laps, moving a lap between circuits, invalid input, the missing-binding message and Discord alerts.
- `tests/smoke.test.tsx`: renders every page with demo data and exercises logging, correcting and deleting a lap.

---

Not affiliated with Formula 1, the FIA or EA Sports. See `THIRD_PARTY_NOTICES.md`.
