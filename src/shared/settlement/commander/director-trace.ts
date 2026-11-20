import type { DirectorMacro, ForceKind } from "./director-types";

/** One force's director decision (A14-4a fixtures and the A16 diagnostics). */
export interface DirectorTraceRecord {
  tick: number;
  faction: number;
  force: number;
  kind: ForceKind;
  previous: DirectorMacro;
  macro: DirectorMacro;
  task: number;
  members: number;
  strength: number;
  /** Known enemy buildings the faction may target at this decision. */
  knownTargets: number;
  target?: number;
  scout?: number;
}

type DirectorTraceSink = (record: DirectorTraceRecord) => void;

let sink: DirectorTraceSink | null = null;

/**
 * Installs (or removes with null) the director trace. Like the commander trace it reads and writes no
 * simulation state: off by default, one null check per force decision.
 */
export const setDirectorTraceSink = (next: DirectorTraceSink | null) => {
  sink = next;
};

export const isDirectorTraceActive = () => sink !== null;

export const traceDirectorDecision = (record: DirectorTraceRecord) => {
  sink?.(record);
};
