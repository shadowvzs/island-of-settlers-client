import type { WorldData } from "../world/world-data";
import { shipHullFitsSea, type ShipObstacle, shipsOverlap } from "./settlement-ship-clearance";
import type { createShipRoutePlanner } from "./settlement-ship-routes";
import type { SettlementPoint } from "./settlement-types";

export type DebugShipSpawn = { ok: true; id: number } |
  { ok: false; reason: "water" | "clearance" | "occupied" };

/** Exact-click placement uses the fleet's current draft, turning space and reserved rig envelopes. */
export const spawnDebugShip = (
  world: WorldData, sea: Uint8Array, planner: ReturnType<typeof createShipRoutePlanner>,
  obstacles: () => readonly ShipObstacle[], addShip: (point: SettlementPoint, yaw: number) => number,
  point: SettlementPoint
): DebugShipSpawn => {
  const { x, z } = point;
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ)
    return { ok: false, reason: "water" };
  // Accessing masks refreshes both sea depth and clearance after a terrain edit.
  const masks = planner.masks, index = Math.floor(z) * world.cellsX + Math.floor(x);
  if (!sea[index]) return { ok: false, reason: "water" };
  const pose = { x, z, yaw: 0 };
  if (!masks.turning[index] || !shipHullFitsSea(world, sea, pose)) return { ok: false, reason: "clearance" };
  if (obstacles().some(other => shipsOverlap(pose, other))) return { ok: false, reason: "occupied" };
  return { ok: true, id: addShip({ x, z }, pose.yaw) };
};
