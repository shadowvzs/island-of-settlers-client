import type { FactionAiSnapshot } from "../../../shared/settlement/economy-ai/faction-ai-types";
import type { ScenarioFactionAi } from "../../../shared/world/scenario-faction-ai";
import type { EconomyAiFactionLog } from "./probe-log";

/** Everything the "why" view model reads: plain copies of the simulation's diagnostics and the probe's log. */
export interface EconomyAiViewInput {
  /** The map's AI entries (the level and style a faction plays when no script set one). */
  authored: readonly Readonly<ScenarioFactionAi>[];
  buildingName: (typeId: number) => string;
  cellsX: number;
  /** A building type's unturned plot in cells (width, depth). */
  footprint: (typeId: number) => readonly [number, number];
  logOf: (faction: number) => EconomyAiFactionLog | undefined;
  snapshots: readonly FactionAiSnapshot[];
  tick: number;
}

/** What the rows of one faction share. */
export interface EconomyAiFactionInput extends Omit<EconomyAiViewInput, "authored" | "logOf" | "snapshots"> {
  authored?: Readonly<ScenarioFactionAi>;
  log?: EconomyAiFactionLog;
  snapshot: FactionAiSnapshot;
}

/** One labelled line of the panel. */
export interface EconomyAiRow {
  label: string;
  value: string;
}

/** One scored goal: the terms of plan §3.4, formatted. */
export interface EconomyAiGoalRow {
  committed: boolean;
  cost: string;
  deficit: string;
  factor: string;
  id: string;
  score: string;
  state: string;
  threat: string;
  /** The goal's building, as the row's tooltip. */
  title: string;
  weight: string;
}

/** A plot marked on the map: a refused one (negative memo) or a candidate of the waiting placement. */
export interface EconomyAiPlotMark {
  kind: "candidate" | "refused";
  label: string;
  x: number;
  z: number;
}

/** One AI faction of the "why" panel, ready to render. */
export interface EconomyAiFactionView {
  backoffs: EconomyAiRow[];
  faction: number;
  /** The committed goal, or why there is none. */
  goal: string;
  goals: EconomyAiGoalRow[];
  /** When the listed scores were decided and in which posture. */
  goalsNote: string;
  maintain: EconomyAiRow[];
  /** EAI3c economy manager rows (paused producers, stock targets, discovered land, geologist). */
  manager: EconomyAiRow[];
  planner: EconomyAiRow[];
  plots: EconomyAiPlotMark[];
  setting: EconomyAiRow[];
  title: string;
  waits: string[];
}

/** What the panel renders: the game clock and one view per AI faction. */
export interface EconomyAiPanelState {
  clock: string;
  factions: EconomyAiFactionView[];
}
