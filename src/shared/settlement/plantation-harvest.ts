import { DRINK_PRODUCER_TYPE_ID } from "./building-type-ids";
import { NATION_DRINK_CHAINS } from "./nation-drinks";
import { getProductionRule } from "./production-rules";
import type { SettlementFieldFrame } from "./settlement-field-cycles";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Harvest progress of a plantation site while its worker is at work there (render-only: derived
 * from the worker's work timer each frame, never saved). The palm grower shakes the trunk, the
 * coconuts drop and bounce, then he gathers them (owner, 2026-10-13); the renderer and the
 * worker pose read the same phases.
 */
export type PalmHarvestPhase = "shake" | "drop" | "gather";
/** End of the shaking and of the falling, as fractions of the harvest work. */
export const PALM_HARVEST_TIMING = { drop: 0.42, shake: 0.3 } as const;

export const getPalmHarvestPhase = (progress: number): PalmHarvestPhase => {
  if (progress < PALM_HARVEST_TIMING.shake) return "shake";
  return progress < PALM_HARVEST_TIMING.drop ? "drop" : "gather";
};

/** 0..1 through a working actor's current production cycle at a building of `typeId`. */
const getWorkProgress = (actor: SettlementActor, typeId: number, nation: SettlementContext["playerNation"]) =>
  Math.max(0, Math.min(1, 1 - actor.timer / (getProductionRule(typeId, nation)?.seconds ?? 1)));

/** 0..1 through a harvesting worker's work at its field site; null when it is not harvesting. */
const getFieldHarvestProgress = (actor: SettlementActor, building: SettlementBuilding | undefined,
  nation: SettlementContext["playerNation"]) => {
  if (actor.phase !== "work" || actor.fieldWork !== "harvest" || actor.target?.kind !== "field" || !building)
    return null;
  return getWorkProgress(actor, building.typeId, nation);
};

/** Field frames with the harvest progress of every site a worker is harvesting right now. */
export const withHarvestProgress = (frames: readonly SettlementFieldFrame[], context: SettlementContext) => {
  const progress = new Map<number, number>();
  for (const actor of context.actors) {
    if (actor.phase !== "work" || actor.fieldWork !== "harvest") continue;
    const building = context.buildings.find(candidate => candidate.uid === actor.building);
    const value = getFieldHarvestProgress(actor, building, context.playerNation);
    if (value !== null && actor.target) progress.set(actor.target.id, value);
  }
  if (!progress.size) return frames;
  return frames.map(frame => progress.has(frame.id) ? { ...frame, harvest: progress.get(frame.id) } : frame);
};

const PALM_GROWER = NATION_DRINK_CHAINS.nubian.grower;

/** The palm grower's harvest phase (shake the trunk, watch the nuts drop, gather them), else null. */
export const getPalmGrowerPhase = (actor: SettlementActor): PalmHarvestPhase | null => {
  if (actor.job !== PALM_GROWER || actor.phase !== "work" || actor.fieldWork !== "harvest") return null;
  return getPalmHarvestPhase(getWorkProgress(actor, DRINK_PRODUCER_TYPE_ID, "nubian"));
};
