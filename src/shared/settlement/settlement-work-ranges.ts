import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { TERRITORY_RADII } from "../balance/territory";
import { nationDrinkChain, PLANTATIONS } from "./nation-drinks";
import { DEFAULT_FARM_RADIUS } from "./settlement-farm-area";
import { SHIPYARD_RADIUS } from "./settlement-sea-navigation";
import { STONEMASON_RADIUS } from "./settlement-stone-area";
import type { SettlementBuilding, SettlementPoint } from "./settlement-types";
import { lookoutSightFactor, territoryRadius } from "./workshop-upgrades";

const HUNTER_RADIUS = STONEMASON_RADIUS * 1.5;
const FALLBACK_WORK_RADIUS = 10;
/** The lookout charts this radius (three fish ranges), scaled by its sight upgrade. */
export const LOOKOUT_SIGHT_RADIUS = STONEMASON_RADIUS * 3;
const MATERIAL_WORK_TYPES = (typeId: number) =>
  typeId >= 41 && typeId <= 56 && (typeId - 41) % 4 !== 3;
const ACCESS_ORIGIN_TYPES = new Set([19, 36, 37, 43, 47, 51, 55, 60]);

export const resourceWorkRadius = (kind: string) => {
  if (["tree", "stone", "fish", "plant"].includes(kind)) return STONEMASON_RADIUS;
  if (kind === "wildlife") return HUNTER_RADIUS;
  return FALLBACK_WORK_RADIUS;
};

/** Type-only radius used by offline estimates, tests and non-building callers. */
export const buildingWorkRadius = (typeId: number): number | null => {
  if ([17, 18, 19, 20].includes(typeId) || MATERIAL_WORK_TYPES(typeId)) return STONEMASON_RADIUS;
  if (typeId === 36) return SHIPYARD_RADIUS;
  if (typeId === 22) return HUNTER_RADIUS;
  if (typeId === 37 || typeId === 60 || typeId === 27) return DEFAULT_FARM_RADIUS;
  if (typeId === 3) return FALLBACK_WORK_RADIUS;
  if (typeId === 5) return PLANTATIONS.vine.radius;
  if (typeId === 14) return LOOKOUT_SIGHT_RADIUS;
  return null;
};

export const buildingWorkOrigin = (building: SettlementBuilding): SettlementPoint =>
  ACCESS_ORIGIN_TYPES.has(building.typeId) ? building.access : building;

export interface BuildingAreaRange {
  center: SettlementPoint;
  radius: number;
}

/**
 * Every selected area the shared overlay draws. Production work, field plantations, lookout
 * sight and military/harbour territory all use the same circle and source-of-truth radius.
 */
export const buildingAreaRange = (
  building: SettlementBuilding,
  nation: WorkerNation = "roman"
): BuildingAreaRange | null => {
  const typeId = building.typeId;
  if (typeId === 37 || typeId === 60) return { center: building.access, radius: DEFAULT_FARM_RADIUS - .75 };
  if (typeId === 5) return {
    center: building,
    radius: PLANTATIONS[nationDrinkChain(nation).plantation].radius
  };
  if (typeId === 14) return {
    center: building,
    radius: LOOKOUT_SIGHT_RADIUS * lookoutSightFactor(building)
  };
  if (typeId === 39) return building.foundedByExpedition
    ? { center: building, radius: STONEMASON_RADIUS }
    : null;
  if (TERRITORY_RADII[typeId] !== undefined) {
    const radius = territoryRadius(building);
    return radius === undefined ? null : { center: building, radius };
  }
  const radius = buildingWorkRadius(typeId);
  if (radius === null) return null;
  return { center: buildingWorkOrigin(building), radius };
};
