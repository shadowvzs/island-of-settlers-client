import type { StrategicIntent } from "../commander/strategic-intents";
import { FACTION_AI_LAYERS } from "./constants";
import type { DevelopGoalReport } from "./develop-diagnostics";
import type { FactionAiLayer } from "./faction-ai-types";

/** The `maintain` work a decision did or was refused (dev overlay "why" panel). */
export type FactionAiMaintainKind = "garrison" | "rebuild" | "repair";

/**
 * The economy AI's decision probe (tests, benches and the dev overlay; plan §4.3 `faction-ai-probe.ts`). Off unless a
 * recorder is installed; it reads and writes no simulation state, so the state hash is identical with and without
 * it, and normal play pays one null check per decision. The optional entries are the "why" of a decision (EAI3d):
 * a recorder that leaves them out pays nothing for them.
 */
export interface FactionAiDecisionRecorder {
  decide: (faction: number, layer: FactionAiLayer, tick: number) => void;
  /** The planner gave a goal up: its building type and why (the goal then backs off). */
  goalRefused?: (faction: number, tick: number, typeId: number, reason: string) => void;
  /** A `develop` strategic decision: every missing goal with its score terms. */
  goals?: (faction: number, tick: number, report: DevelopGoalReport) => void;
  /** A `maintain` action or its refusal (`detail`: what was done, or the refusal's reason). */
  maintain?: (faction: number, tick: number, kind: FactionAiMaintainKind, detail: string) => void;
  /** The real rules refused a candidate plot (cache `entry`): it goes to the negative memo. */
  plotRefused?: (faction: number, tick: number, typeId: number, entry: number, reason: string) => void;
  /** The faction's own strategic intents of a military decision (EAI4b), also when it states none. */
  strategy?: (faction: number, tick: number, intents: readonly StrategicIntent[]) => void;
}

let recorder: FactionAiDecisionRecorder | null = null;

/** Installs (or with null removes) the recorder of every following economy AI decision. */
export const setFactionAiProbe = (next: FactionAiDecisionRecorder | null) => {
  recorder = next;
};

/** One decision of `faction`'s layer (index into `FACTION_AI_LAYERS`) at `tick`. */
export const reportFactionAiDecision = (faction: number, layer: number, tick: number) => {
  if (recorder !== null) recorder.decide(faction, FACTION_AI_LAYERS[layer]!, tick);
};

/** The installed goal-score recorder, so a decision builds its report only when one listens. */
export const factionAiGoalProbe = () => recorder?.goals;

/** The installed strategy recorder (EAI4b). */
export const factionStrategyProbe = () => recorder?.strategy;

export const reportGoalRefused = (faction: number, tick: number, typeId: number, reason: string) => {
  if (recorder !== null) recorder.goalRefused?.(faction, tick, typeId, reason);
};

export const reportMaintain = (faction: number, tick: number, kind: FactionAiMaintainKind, detail: string) => {
  if (recorder !== null) recorder.maintain?.(faction, tick, kind, detail);
};

export const reportPlotRefused = (faction: number, tick: number, typeId: number, entry: number, reason: string) => {
  if (recorder !== null) recorder.plotRefused?.(faction, tick, typeId, entry, reason);
};
