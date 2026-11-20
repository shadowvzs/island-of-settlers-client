import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { createMountainField, getRockSkinCover } from "../world/rock-cover";
import type { WorldData } from "../world/world-data";
import { overlapsSettlementGround } from "./settlement-ground-clearance";
import type { ResourceTarget, SettlementPoint } from "./settlement-types";

/** Small finite seams in the existing rendered rocky skin; extracting chunks never reshapes terrain. */
export const createMountainStoneDeposits = (world: WorldData) => {
  const mountain = createMountainField(world, world.heights);
  const remaining = new Map<number, number>();
  const queries = new Map<string, ResourceTarget[]>();
  const seams = new Map<number, ResourceTarget>();
  const height = (x: number, z: number) => sampleSmooth(world, world.heights, x, z);
  const spot = (id: number): SettlementPoint | null => {
    const cell = -1_000_000 - id, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    return x >= 1 && z >= 1 && x < world.cellsX - 1 && z < world.cellsZ - 1 ? { x: x + .5, z: z + .5 } : null;
  };
  const amount = (id: number) => remaining.get(id) ?? 12;
  // The same footprint gates discovery and extraction, including an already selected target.
  const canConsume = (target: ResourceTarget, includeDepleted = false) => {
    let seam = seams.get(target.id);
    if (!seam) {
      const point = spot(target.id);
      seam = point ? discover(target.id, point.x, point.z) : undefined;
    }
    if (!seam || DMath.hypot(seam.x - target.x, seam.z - target.z) > .01 ||
      overlapsSettlementGround(world, seam.x - .6, seam.z - .6, seam.x + .6, seam.z + .6) ||
      (!includeDepleted && amount(target.id) <= 0)) return false;
    const approach = seam.approach!;
    return !!target.approach && DMath.hypot(approach.x - target.approach.x, approach.z - target.approach.z) < .01 &&
      Boolean(world.walkCost[Math.floor(approach.z) * world.cellsX + Math.floor(approach.x)]) &&
      height(approach.x, approach.z) > world.seaLevel + .08 && height(seam.x, seam.z) - height(approach.x, approach.z) <= 1.35;
  };
  const discover = (id: number, x: number, z: number): ResourceTarget | undefined => {
    const known = seams.get(id);
    if (known) return known;
    const gx = (height(x + .25, z) - height(x - .25, z)) / .5;
    const gz = (height(x, z + .25) - height(x, z - .25)) / .5;
    const slope = DMath.hypot(gx, gz);
    if (getRockSkinCover(slope, sampleSmooth(world, mountain, x, z)) < .65) return;
    const approach = { x: x - gx / slope * .8, z: z - gz / slope * .8 };
    const target: ResourceTarget = { id, kind: "stone", x, z, y: height(approach.x, approach.z), approach };
    seams.set(id, target);
    return target;
  };
  const canRestore = (id: number) => {
    const point = spot(id);
    const target = point && discover(id, point.x, point.z);
    return !!target && canConsume(target, true);
  };
  const targets = (near: SettlementPoint, range: number, includeDepleted = false): ResourceTarget[] => {
    const key = `${near.x}:${near.z}:${range}`;
    let result = queries.get(key);
    if (!result) {
      result = [];
      for (let z = Math.max(1, Math.floor(near.z - range)); z < Math.min(world.cellsZ - 1, near.z + range); z++)
        for (let x = Math.max(1, Math.floor(near.x - range)); x < Math.min(world.cellsX - 1, near.x + range); x++) {
          const px = x + .5, pz = z + .5, id = -1_000_000 - z * world.cellsX - x;
          if (DMath.hypot(px - near.x, pz - near.z) > range) continue;
          const target = discover(id, px, pz);
          if (target) result.push(target);
        }
      queries.set(key, result);
    }
    return result.filter(target => canConsume(target, includeDepleted));
  };
  const consume = (target: ResourceTarget) => {
    if (!canConsume(target)) return false;
    remaining.set(target.id, amount(target.id) - 1); return true;
  };
  const saveState = (): [number, number][] => [...remaining].sort((a, b) => b[0] - a[0]);
  const loadState = (saved: readonly (readonly [number, number])[]) => {
    remaining.clear();
    for (const [id, value] of saved) remaining.set(id, value);
  };
  return { amount, canConsume, canRestore, consume, loadState, saveState, spot, targets,
    refill: (id: number) => remaining.delete(id) };
};
