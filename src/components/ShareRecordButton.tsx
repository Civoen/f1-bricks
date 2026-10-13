import { useState } from 'react';
import { renderRecordCard, shareRecordCard } from '../lib/recordCard';
import { formatLapTime } from '../lib/laptime';
import type { CircuitSummary } from '../lib/records';
import { useData } from '../state/data';

/** Builds a record card for the circuit's current record and shares or downloads it. */
export function ShareRecordButton({ summary, className = 'btn', label = 'Share record card' }: {
  summary: CircuitSummary;
  className?: string;
  label?: string;
}) {
  const { playerById } = useData();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const record = summary.record;
  if (!record) return null;
  const holder = playerById.get(record.player_id);
  if (!holder) return null;

  async function share() {
    if (!record || !holder) return;
    setState('busy');
    try {
      const last = summary.history[summary.history.length - 1];
      const prev = last?.previous ? playerById.get(last.previous.player_id) : undefined;
      const blob = await renderRecordCard({
        circuitSlug: summary.circuit.slug,
        circuitName: summary.circuit.short_name,
        country: summary.circuit.country,
        round: summary.circuit.display_order,
        timeMs: record.lap_time_ms,
        holderName: holder.name,
        holderColour: holder.colour_hex,
        achievedAt: record.recorded_at,
        previous: last?.previous && prev ? { name: prev.name, colour: prev.colour_hex, timeMs: last.previous.lap_time_ms } : null,
        standings: summary.standings.map((s) => ({ name: s.player.name, colour: s.player.colour_hex, timeMs: s.lap?.lap_time_ms ?? null }))
      });
      const result = await shareRecordCard(
        blob,
        `${summary.circuit.slug}-record.png`,
        `${holder.name} holds the ${summary.circuit.short_name} record: ${formatLapTime(record.lap_time_ms)}`
      );
      setState(result === 'cancelled' ? 'idle' : 'done');
    } catch {
      setState('error');
    }
  }

  return (
    <button type="button" className={className} onClick={() => void share()} disabled={state === 'busy'} aria-live="polite">
      {state === 'busy' ? 'Creating card…' : state === 'done' ? 'Card ready ✓' : state === 'error' ? 'Couldn’t create card — retry' : label}
    </button>
  );
}
