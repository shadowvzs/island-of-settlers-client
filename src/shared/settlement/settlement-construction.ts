import { DMath } from "../math/deterministic-math";
import { addGood } from "./production-rules";
import type { SettlementBuilding } from "./settlement-types";

// Audited against worker-generation animation-manifest and worker-action-contacts.
export const BUILDER_HAMMER = { duration: 1.3, contact: 0.72 } as const;
export const builderHammerContacts = (from: number, to: number) => {
  const hits = (time: number) =>
    Math.max(0, Math.floor((time - BUILDER_HAMMER.contact + 1e-8) / BUILDER_HAMMER.duration) + 1);
  return Math.max(0, hits(to) - hits(from));
};
export const constructionHits = (building: SettlementBuilding) =>
  Math.max(Math.ceil((12 + building.width * 4) / BUILDER_HAMMER.duration),
    Object.values(building.required).reduce((sum, count) => sum + count, 0));
/** Planks are delivered first, then stone, then every other material. */
const materialDeliveryRank = (ware: string) => {
  if (ware === "planks") return -1;
  return ware === "stone" ? 0 : 1;
};
const materialSequence = (building: SettlementBuilding) =>
  Object.entries(building.required)
    .sort(
      ([a], [b]) =>
        materialDeliveryRank(a) - materialDeliveryRank(b)
    )
    .flatMap(([ware, count]) => Array.from({ length: count }, () => ware));
const nextConstructionMaterial = (building: SettlementBuilding) => {
  const materials = materialSequence(building);
  const hit = Math.round(building.construction * constructionHits(building));
  const unit = Math.floor((hit * materials.length) / constructionHits(building));
  const ware = materials[unit];
  if (!ware) return undefined;
  const ordinal = materials.slice(0, unit + 1).filter((entry) => entry === ware).length;
  return (building.constructionConsumed?.[ware] ?? 0) < ordinal ? ware : undefined;
};
export const constructionSupplied = (building: SettlementBuilding) => {
  const ware = nextConstructionMaterial(building);
  return !ware || (building.input[ware] ?? 0) > 0;
};
export const applyConstructionContact = (building: SettlementBuilding) => {
  if (!constructionSupplied(building) || building.construction >= 1) return false;
  const ware = nextConstructionMaterial(building);
  if (ware) {
    addGood(building.input, ware, -1);
    building.constructionConsumed ??= {};
    addGood(building.constructionConsumed, ware);
  }
  building.construction = Math.min(
    1,
    (Math.round(building.construction * constructionHits(building)) + 1) /
      constructionHits(building)
  );
  return true;
};
export const constructionWorkPositions = (building: SettlementBuilding) =>
  [
    { x: building.x + building.width / 2 + 0.6, z: building.z },
    { x: building.x, z: building.z - building.depth / 2 - 0.6 },
    { x: building.x - building.width / 2 - 0.6, z: building.z },
    { x: building.x + 0.8, z: building.z + building.depth / 2 + 0.6 }
  ].map((point, side) => {
    if (DMath.hypot(point.x - building.access.x, point.z - building.access.z) < 0.75) {
      // Keep the entire doorway approach free, including rotated entrances.
      if (side % 2 === 0) point.z += 0.9;
      else point.x += 0.9;
    }
    return point;
  });
/** Yaw facing straight at the wall of a `constructionWorkPositions` edge (east, north, west, south). */
const WALL_FACING_YAWS = [-Math.PI / 2, 0, Math.PI / 2, Math.PI] as const;
export const constructionFacing = (edge: number) => WALL_FACING_YAWS[edge % WALL_FACING_YAWS.length]!;
