import { useEffect, useMemo, useState } from 'react';
import { canShareFile, recordCardFile, renderRecordCard, shareFile, type RecordCardData } from '../lib/recordCard';
import type { CircuitSummary } from '../lib/records';
import { useData } from '../state/data';
import { Modal } from './Modal';

/**
 * Shares the circuit's current record as an image.
 *  - The card is drawn as soon as the button appears, so tapping opens the
 *    share sheet immediately (phones only allow sharing straight from a tap).
 *  - Where sharing images isn't possible (most desktops, some in-app
 *    browsers) or it fails, the card opens in a preview with a download button
 *    and a "press and hold to save" hint.
 */
export function ShareRecordButton({ summary, className = 'btn', label = 'Share record card' }: {
  summary: CircuitSummary;
  className?: string;
  label?: string;
}) {
  const { playerById } = useData();
  const data = useMemo<RecordCardData | null>(() => {
    const record = summary.record;
    const holder = record ? playerById.get(record.player_id) : undefined;
    if (!record || !holder) return null;
    const last = summary.history[summary.history.length - 1];
    const prev = last?.previous ? playerById.get(last.previous.player_id) : undefined;
    return {
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
    };
  }, [summary, playerById]);

  const key = data ? JSON.stringify(data) : '';
  const [file, setFile] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  // Draw the card ahead of the tap.
  useEffect(() => {
    if (!data) return;
    let live = true;
    setFile(null);
    setFailed(false);
    renderRecordCard(data)
      .then((blob) => { if (live) setFile(recordCardFile(blob, `${data.circuitSlug}-record.png`)); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the tap came before the card was ready, show it as soon as it is.
  useEffect(() => {
    if (waiting && file) {
      setWaiting(false);
      openPreview(file);
    }
  }, [waiting, file]); // eslint-disable-line react-hooks/exhaustive-deps

  // Free the preview image when it's closed.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!data) return null;

  function openPreview(f: File) {
    setPreview(URL.createObjectURL(f));
  }

  function onClick() {
    if (!file) {
      setWaiting(true);
      return;
    }
    if (canShareFile(file)) {
      // No awaits before this call: the share must start inside the tap.
      void shareFile(file).then((r) => { if (r === 'failed') openPreview(file); });
    } else {
      openPreview(file);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={onClick} disabled={failed} aria-live="polite">
        {failed ? 'Couldn’t create the card' : waiting ? 'Creating card…' : label}
      </button>
      {preview && file && (
        <Modal label="Record card" onClose={() => setPreview(null)}>
          <div className="share-preview">
            <img src={preview} alt={`${data.circuitName} record card: ${data.holderName}`} />
            <p className="help" style={{ margin: 0 }}>On a phone, press and hold the image to save or share it.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a className="btn btn-primary btn-sm" href={preview} download={file.name}>Download image</a>
              <button type="button" className="btn btn-sm" onClick={() => setPreview(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
