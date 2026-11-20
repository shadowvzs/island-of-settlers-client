import { isWorkerNation } from "../../render-common/workers/worker-appearance";
import type { WorkerNation } from "../../render-common/workers/worker-unit";

/** Who plays a slot: the human player, a computer nation, bandits or pirates (plan item 42). */
export const SCENARIO_PLAYER_KINDS = ["human", "nation", "bandits", "pirates"] as const;
export type ScenarioPlayerKind = (typeof SCENARIO_PLAYER_KINDS)[number];
/** The human player always owns faction 0; authored enemies use factions 1–16. */
export const HUMAN_FACTION = 0;
export const MAX_FACTION = 16;
/** One human and at most four others. */
const MAX_PLAYER_SLOTS = 5;

/**
 * A player slot of a campaign map. Slots sharing the human's `team` would be allies; until a teams lane exists the
 * campaign validator accepts no allied slot and one hostile slot only (review R6).
 */
export interface ScenarioPlayerSlot {
  faction: number;
  kind: ScenarioPlayerKind;
  /** The look of a `nation` slot; the other kinds have their own. */
  nation?: WorkerNation;
  team: number;
}

const factionIn = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= HUMAN_FACTION &&
  (value as number) <= MAX_FACTION;

const validSlot = (slot: unknown) => {
  if (!slot || typeof slot !== "object") return false;
  const { faction, kind, nation, team } = slot as Record<string, unknown>;
  if (!factionIn(faction) || !factionIn(team)) return false;
  if (!(SCENARIO_PLAYER_KINDS as readonly unknown[]).includes(kind)) return false;
  return nation === undefined ? kind !== "nation" : kind === "nation" && isWorkerNation(nation);
};

/** Structural check of `MapScenario.players`: at most five slots with unique factions. */
export const validScenarioPlayers = (value: unknown) => {
  if (!Array.isArray(value) || value.length > MAX_PLAYER_SLOTS || !value.every(validSlot)) return false;
  return new Set(value.map(slot => (slot as ScenarioPlayerSlot).faction)).size === value.length;
};
