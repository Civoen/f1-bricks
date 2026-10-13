import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Backend, LogLapInput, Snapshot, UpdateLapInput } from '../lib/backend';
import { friendlyError } from '../lib/backend';
import { annotateLaps, championshipStandings, summariseAll, type CircuitSummary, type LapAnnotation, type PlayerStanding } from '../lib/records';
import type { Circuit, LogLapResult, Player, RecordEvent } from '../lib/types';

interface DataState {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  online: boolean;
  refresh: () => Promise<void>;
  logLap: (input: LogLapInput) => Promise<LogLapResult>;
  updateLap: (input: UpdateLapInput) => Promise<void>;
  deleteLap: (lapId: string) => Promise<void>;
  // Derived
  players: Player[];
  circuits: Circuit[];
  playerById: Map<string, Player>;
  circuitById: Map<string, Circuit>;
  circuitBySlug: Map<string, Circuit>;
  summaries: CircuitSummary[];
  summaryById: Map<string, CircuitSummary>;
  annotations: Map<string, LapAnnotation>;
  standings: PlayerStanding[];
  activeEvents: RecordEvent[];
}

const DataContext = createContext<DataState | null>(null);

export function DataProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const p = (async () => {
      setLoading(true);
      try {
        const s = await backend.load();
        setSnapshot(s);
        setError(null);
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = p;
    return p;
  }, [backend]);

  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = backend.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 400);
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onOnline = () => {
      setOnline(true);
      void refresh();
    };
    const onOffline = () => setOnline(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [backend, refresh]);

  const logLap = useCallback(async (input: LogLapInput) => {
    const r = await backend.logLap(input);
    await refresh();
    return r;
  }, [backend, refresh]);

  const updateLap = useCallback(async (input: UpdateLapInput) => {
    await backend.updateLap(input);
    await refresh();
  }, [backend, refresh]);

  const deleteLap = useCallback(async (lapId: string) => {
    await backend.deleteLap(lapId);
    await refresh();
  }, [backend, refresh]);

  const derived = useMemo(() => {
    const players = [...(snapshot?.players ?? [])].sort((a, b) => a.display_order - b.display_order);
    const circuits = [...(snapshot?.circuits ?? [])].sort((a, b) => a.display_order - b.display_order);
    const laps = snapshot?.laps ?? [];
    const summaries = summariseAll(circuits, laps, players);
    const annotations = annotateLaps(laps);
    return {
      players,
      circuits,
      playerById: new Map(players.map((p) => [p.id, p])),
      circuitById: new Map(circuits.map((c) => [c.id, c])),
      circuitBySlug: new Map(circuits.map((c) => [c.slug, c])),
      summaries,
      summaryById: new Map(summaries.map((s) => [s.circuit.id, s])),
      annotations,
      standings: championshipStandings(summaries, players, annotations, laps),
      activeEvents: (snapshot?.events ?? []).filter((e) => !e.superseded_at)
    };
  }, [snapshot]);

  const value: DataState = { snapshot, loading, error, online, refresh, logLap, updateLap, deleteLap, ...derived };
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
