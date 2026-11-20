import type { MoraleState } from "../../balance/morale";

/** One morale state change of a field soldier (fixtures, A16 diagnostics). */
export interface MoraleTraceRecord {
  /** Inside a friendly commander's aura at the change. */
  aura: boolean;
  faction: number;
  from: MoraleState;
  /** Soldiers the change ordered back (a fall-back takes its group along; 0: none). */
  ordered: number;
  tick: number;
  to: MoraleState;
  uid: number;
}

export type MoraleTraceSink = (record: Readonly<MoraleTraceRecord>) => void;

let sink: MoraleTraceSink | null = null;

/**
 * Installs (or removes, `null`) the morale trace sink, like the commander decision trace. Off by default: the
 * sink reads and writes no simulation state, so the state hash is the same with and without it.
 */
export const setMoraleTraceSink = (next: MoraleTraceSink | null) => {
  sink = next;
};

export const traceMorale = (record: Readonly<MoraleTraceRecord>) => {
  sink?.(record);
};

/** Callers build a record only while a sink listens. */
export const isMoraleTraceActive = () => sink !== null;
