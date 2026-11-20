import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";

/**
 * Open water this far from a plot centre sets its facing: the harbour's 8-tile shore rule from an
 * entrance 3.5 cells off the centre, plus the shore-to-sea step, stays inside it.
 */
const HARBOUR_FACING_RADIUS = 16;
const QUARTER_TURN = Math.PI / 2;

/** Rotation whose door (rotation 0: +z, 1: +x, 2: -z, 3: -x) points along `x`, `z`. */
export const rotationTowards = (x: number, z: number) =>
  ((Math.round(DMath.atan2(x, z) / QUARTER_TURN) % 4) + 4) % 4;

/** Open-sea cells around the plot centre and the sum of the unit vectors towards them. */
const seaDirection = (world: WorldData, sea: Uint8Array, x: number, z: number) => {
  const radius = HARBOUR_FACING_RADIUS;
  let cells = 0, seaX = 0, seaZ = 0;
  for (let row = Math.max(0, Math.floor(z - radius)); row < Math.min(world.cellsZ, z + radius); row++)
    for (let column = Math.max(0, Math.floor(x - radius)); column < Math.min(world.cellsX, x + radius); column++) {
      if (!sea[row * world.cellsX + column]) continue;
      const dx = column + .5 - x, dz = row + .5 - z, distance = DMath.hypot(dx, dz);
      if (distance > radius || distance === 0) continue;
      cells++;
      seaX += dx / distance;
      seaZ += dz / distance;
    }
  return { cells, seaX, seaZ };
};

/**
 * The plot's own shore sets the harbour's facing: its back to the open sea, its door to the land
 * (the established colony harbour orientation). Null when no open sea lies within reach, so the
 * plot cannot host a harbour; `fallback` when the sea surrounds it evenly.
 */
export const harbourShoreRotation = (
  world: WorldData, sea: Uint8Array, x: number, z: number, fallback: number
) => {
  const { cells, seaX, seaZ } = seaDirection(world, sea, x, z);
  if (!cells) return null;
  return DMath.hypot(seaX, seaZ) < 1 ? fallback : rotationTowards(-seaX, -seaZ);
};
