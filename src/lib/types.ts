export interface Player {
  id: string;
  slug: string;
  name: string;
  colour_hex: string;
  display_order: number;
}

export interface Circuit {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  code: string;
  country: string | null;
  display_order: number;
  is_active: boolean;
}

/** An active (not deleted) lap. Times are ISO-8601 strings with offset. */
export interface Lap {
  id: string;
  player_id: string;
  circuit_id: string;
  lap_time_ms: number;
  recorded_at: string;
  created_at: string;
  notes: string | null;
}

export interface RecordEvent {
  id: string;
  circuit_id: string;
  sequence: number;
  event_type: 'initial' | 'broken';
  previous_lap_entry_id: string | null;
  new_lap_entry_id: string;
  previous_time_ms: number | null;
  new_time_ms: number;
  previous_player_id: string | null;
  new_player_id: string;
  achieved_at: string;
  created_at: string;
  superseded_at: string | null;
  superseded_reason: string | null;
}

export type LapOutcome = 'record' | 'tie_record' | 'pb' | 'lap';

export interface AuditSnapshot {
  player_id: string;
  circuit_id: string;
  lap_time_ms: number;
  recorded_at: string;
  notes: string | null;
  deleted_at: string | null;
  previous_record_ms?: number | null;
  previous_record_player_id?: string | null;
  previous_pb_ms?: number | null;
}

export interface AuditEntry {
  id: number;
  lap_entry_id: string;
  action: 'create' | 'update' | 'delete';
  outcome: LapOutcome | null;
  at: string;
  before: AuditSnapshot | null;
  after: AuditSnapshot | null;
}

export interface LogLapResult {
  lap_id: string;
  outcome: LapOutcome;
  previous_record_ms: number | null;
  previous_record_player_id: string | null;
  previous_pb_ms: number | null;
  duplicate: boolean;
}
