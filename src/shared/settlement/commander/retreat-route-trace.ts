/** One covered retreat route handed out (fixtures, A16 diagnostics). */
export interface RetreatRouteTraceRecord {
  /** `rout`: a broken soldier's way to its rally point; `squad`: a commander squad's retreat. */
  kind: "rout" | "squad";
  faction: number;
  /** The soldier (rout) or the squad id (its first member). */
  uid: number;
  /** Enemy influence summed along the route and along the straight cell line to its end (×cell length). */
  exposure: number;
  straightExposure: number;
  reached: boolean;
  expansions: number;
}

export type RetreatRouteTraceSink = (record: Readonly<RetreatRouteTraceRecord>) => void;

let sink: RetreatRouteTraceSink | null = null;

/**
 * Installs (or removes, `null`) the retreat route trace sink, like the morale trace. Off by default: the sink
 * reads and writes no simulation state, so the state hash is the same with and without it.
 */
export const setRetreatRouteTraceSink = (next: RetreatRouteTraceSink | null) => {
  sink = next;
};

export const traceRetreatRoute = (record: Readonly<RetreatRouteTraceRecord>) => {
  sink?.(record);
};

/** Callers build a record only while a sink listens. */
export const isRetreatRouteTraceActive = () => sink !== null;
