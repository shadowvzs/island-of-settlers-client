import { DMath } from "../math/deterministic-math";
import {
  defaultWorkArea,
  type FarmArea,
  type FarmAreaBounds,
  inFarmArea,
  validWorkAreaBounds} from "./settlement-farm-area";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** Shared resource-worker reach, increased by 50% from the previous sixteen cells. */
export const STONEMASON_RADIUS = 24;
const areas = new WeakMap<SettlementContext, Map<number, FarmAreaBounds>>();
const stoneAreaFor = (
  context: SettlementContext,
  building: SettlementBuilding
): FarmArea => {
  const custom = areas.get(context)?.get(building.uid);
  return custom
    ? { ...custom, custom: true }
    : defaultWorkArea(context.options.world, building.access, STONEMASON_RADIUS);
};
export const stoneArea = (context: SettlementContext, uid: number) => {
  const building = context.buildings.find((entry) => entry.uid === uid && entry.typeId === 19);
  return building ? stoneAreaFor(context, building) : null;
};
export const setStoneArea = (
  context: SettlementContext,
  uid: number,
  bounds: FarmAreaBounds | null
) => {
  const building = context.buildings.find((entry) => entry.uid === uid && entry.typeId === 19);
  if (
    !building ||
    (bounds &&
      !validWorkAreaBounds(context.options.world, building.access, bounds, STONEMASON_RADIUS))
  )
    return false;
  const map = areas.get(context) ?? new Map<number, FarmAreaBounds>();
  areas.set(context, map);
  if (bounds === null) map.delete(uid);
  else map.set(uid, { ...bounds });
  return true;
};

export const stoneTargetAllowed = (
  context: SettlementContext,
  building: SettlementBuilding,
  target: SettlementPoint
) =>
  DMath.hypot(target.x - building.access.x, target.z - building.access.z) <= STONEMASON_RADIUS &&
  inFarmArea(stoneAreaFor(context, building), target);

export const saveStoneAreas = (context: SettlementContext) =>
  [...(areas.get(context) ?? [])].filter(([uid]) => context.buildings.some(building => building.uid === uid));
export const restoreStoneAreas = (context: SettlementContext, entries: [number, FarmAreaBounds][]) => {
  areas.set(context, new Map(entries));
};
