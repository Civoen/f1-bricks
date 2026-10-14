/**
 * D1 (SQLite) schema and reference data.
 *
 * There is nothing to paste into a console: the API creates these tables the
 * first time it runs against an empty database. Every statement is idempotent
 * (IF NOT EXISTS / INSERT OR IGNORE), so running it again is harmless.
 *
 * Times are ISO-8601 UTC strings ("2026-10-13T19:04:11.000Z"), so they sort
 * correctly as text. Lap times are integer milliseconds.
 */

/** Bump this and add an entry to MIGRATIONS to change an existing database. */
export const SCHEMA_VERSION = 3;

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
const UUID = '(lower(hex(randomblob(16))))';

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS players (
    id            TEXT PRIMARY KEY DEFAULT ${UUID},
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    colour_hex    TEXT NOT NULL CHECK (length(colour_hex) = 7 AND substr(colour_hex, 1, 1) = '#'),
    display_order INTEGER NOT NULL DEFAULT 0
  )`,

  // display_order follows the 2025 race calendar. Set is_active = 0 to hide one.
  `CREATE TABLE IF NOT EXISTS circuits (
    id            TEXT PRIMARY KEY DEFAULT ${UUID},
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    short_name    TEXT NOT NULL,
    code          TEXT NOT NULL CHECK (length(code) BETWEEN 2 AND 4),
    country       TEXT,
    display_order INTEGER NOT NULL,
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
  )`,

  // Every lap ever logged. Deleted laps are soft-deleted so the audit trail survives.
  `CREATE TABLE IF NOT EXISTS lap_entries (
    id                TEXT PRIMARY KEY,
    player_id         TEXT NOT NULL REFERENCES players (id),
    circuit_id        TEXT NOT NULL REFERENCES circuits (id),
    lap_time_ms       INTEGER NOT NULL CHECK (lap_time_ms > 0 AND lap_time_ms < 3600000),
    recorded_at       TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT ${NOW},
    updated_at        TEXT NOT NULL DEFAULT ${NOW},
    notes             TEXT CHECK (notes IS NULL OR length(notes) <= 500),
    deleted_at        TEXT,
    client_request_id TEXT UNIQUE
  )`,
  `CREATE INDEX IF NOT EXISTS lap_entries_circuit_idx ON lap_entries (circuit_id) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS lap_entries_recorded_idx ON lap_entries (recorded_at) WHERE deleted_at IS NULL`,

  // One row per change of circuit record. Corrections mark old rows superseded
  // (kept, not deleted) so the original history stays visible.
  `CREATE TABLE IF NOT EXISTS record_events (
    id                    TEXT PRIMARY KEY,
    circuit_id            TEXT NOT NULL REFERENCES circuits (id),
    sequence              INTEGER NOT NULL CHECK (sequence >= 1),
    event_type            TEXT NOT NULL CHECK (event_type IN ('initial', 'broken')),
    previous_lap_entry_id TEXT REFERENCES lap_entries (id),
    new_lap_entry_id      TEXT NOT NULL REFERENCES lap_entries (id),
    previous_time_ms      INTEGER,
    new_time_ms           INTEGER NOT NULL,
    previous_player_id    TEXT REFERENCES players (id),
    new_player_id         TEXT NOT NULL REFERENCES players (id),
    achieved_at           TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT ${NOW},
    superseded_at         TEXT,
    superseded_reason     TEXT,
    CHECK ((event_type = 'initial') = (previous_lap_entry_id IS NULL)),
    CHECK (previous_time_ms IS NULL OR new_time_ms < previous_time_ms)
  )`,
  // Exactly one active event per position in each circuit's history.
  `CREATE UNIQUE INDEX IF NOT EXISTS record_events_active_seq ON record_events (circuit_id, sequence) WHERE superseded_at IS NULL`,

  // Optimistic lock: every write at a circuit claims the next revision number.
  // Two writers that read the same state can't both commit; the loser retries.
  `CREATE TABLE IF NOT EXISTS circuit_revisions (
    circuit_id TEXT NOT NULL REFERENCES circuits (id),
    rev        INTEGER NOT NULL,
    at         TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (circuit_id, rev)
  )`,

  // Every create, correction and deletion.
  `CREATE TABLE IF NOT EXISTS lap_audit (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    lap_entry_id TEXT NOT NULL REFERENCES lap_entries (id),
    action       TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    outcome      TEXT CHECK (outcome IN ('record', 'tie_record', 'pb', 'lap')),
    at           TEXT NOT NULL DEFAULT ${NOW},
    before       TEXT,
    after        TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS lap_audit_at_idx ON lap_audit (at)`,

  // Reference data: the three drivers and the F1 25 circuits (no lap times).
  `INSERT OR IGNORE INTO players (slug, name, colour_hex, display_order) VALUES
    ('rag',  'Rag',  '#35C878', 1),
    ('adam', 'Adam', '#398BFF', 2),
    ('ben',  'Ben',  '#FF8A24', 3)`,

  `INSERT OR IGNORE INTO circuits (slug, name, short_name, code, country, display_order) VALUES
    ('albert-park',   'Albert Park Circuit',                'Albert Park',   'AUS', 'Australia',     1),
    ('shanghai',      'Shanghai International Circuit',     'Shanghai',      'CHN', 'China',         2),
    ('suzuka',        'Suzuka International Racing Course', 'Suzuka',        'JPN', 'Japan',         3),
    ('bahrain',       'Bahrain International Circuit',      'Bahrain',       'BHR', 'Bahrain',       4),
    ('jeddah',        'Jeddah Corniche Circuit',            'Jeddah',        'KSA', 'Saudi Arabia',  5),
    ('miami',         'Miami International Autodrome',      'Miami',         'MIA', 'United States', 6),
    ('imola',         'Autodromo Enzo e Dino Ferrari',      'Imola',         'IMO', 'Italy',         7),
    ('monaco',        'Circuit de Monaco',                  'Monaco',        'MON', 'Monaco',        8),
    ('barcelona',     'Circuit de Barcelona-Catalunya',     'Barcelona',     'ESP', 'Spain',         9),
    ('montreal',      'Circuit Gilles Villeneuve',          'Montréal',      'CAN', 'Canada',        10),
    ('red-bull-ring', 'Red Bull Ring',                      'Red Bull Ring', 'AUT', 'Austria',       11),
    ('silverstone',   'Silverstone Circuit',                'Silverstone',   'GBR', 'Great Britain', 12),
    ('spa',           'Circuit de Spa-Francorchamps',       'Spa',           'BEL', 'Belgium',       13),
    ('hungaroring',   'Hungaroring',                        'Hungaroring',   'HUN', 'Hungary',       14),
    ('zandvoort',     'Circuit Zandvoort',                  'Zandvoort',     'NED', 'Netherlands',   15),
    ('monza',         'Autodromo Nazionale Monza',          'Monza',         'ITA', 'Italy',         16),
    ('baku',          'Baku City Circuit',                  'Baku',          'AZE', 'Azerbaijan',    17),
    ('marina-bay',    'Marina Bay Street Circuit',          'Marina Bay',    'SGP', 'Singapore',     18),
    ('cota',          'Circuit of the Americas',            'Austin',        'USA', 'United States', 19),
    ('mexico-city',   'Autódromo Hermanos Rodríguez',       'Mexico City',   'MEX', 'Mexico',        20),
    ('interlagos',    'Autódromo José Carlos Pace',         'Interlagos',    'BRA', 'Brazil',        21),
    ('las-vegas',     'Las Vegas Strip Circuit',            'Las Vegas',     'LVG', 'United States', 22),
    ('lusail',        'Lusail International Circuit',      'Lusail',        'QAT', 'Qatar',         23),
    ('yas-marina',    'Yas Marina Circuit',                 'Yas Marina',    'ABU', 'Abu Dhabi',     24)`
];

/**
 * Changes for databases created by an earlier version. A new database gets
 * SCHEMA (already up to date); an existing one runs each step above its
 * stored version, once, on the first request after a deploy.
 */
export const MIGRATIONS: Record<number, string[]> = {
  // v2: Rag is green, Ben is orange.
  2: [
    `UPDATE players SET colour_hex = '#35C878' WHERE slug = 'rag'`,
    `UPDATE players SET colour_hex = '#FF8A24' WHERE slug = 'ben'`
  ],
  // v3: Circuit of the Americas is shown as "Austin".
  3: [`UPDATE circuits SET short_name = 'Austin' WHERE slug = 'cota'`]
};
