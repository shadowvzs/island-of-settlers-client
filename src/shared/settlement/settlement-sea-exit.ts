import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import type { SettlementPoint } from "./settlement-types";

const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const EDGE_MARGIN = 4;

const edgeDistance = (world: WorldData, x: number, z: number) =>
  Math.min(x, z, world.cellsX - 1 - x, world.cellsZ - 1 - z);

/** Search radius (cells) for open water around a ship lying in tight water (a berth, an anchorage). */
const NEAREST_RADIUS = 12;

/** The turnable cell nearest `from` (the cell itself when it is turnable), -1 when none is close. */
const nearestTurnable = (world: WorldData, turning: Uint8Array, from: SettlementPoint) => {
  const x0 = Math.floor(from.x), z0 = Math.floor(from.z);
  let best = -1, bestDistance = Infinity;
  for (let z = z0 - NEAREST_RADIUS; z <= z0 + NEAREST_RADIUS; z++) for (let x = x0 - NEAREST_RADIUS; x <= x0 + NEAREST_RADIUS; x++) {
    if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ || !turning[z * world.cellsX + x]) continue;
    const distance = DMath.hypot(x - x0, z - z0);
    if (distance < bestDistance) { best = z * world.cellsX + x; bestDistance = distance; }
  }
  return best;
};

/**
 * Reachable turnable sea cell closest to the map edge, where far voyages leave and re-enter.
 * Hull clearance keeps turnable cells off the border, so the closest one wins.
 */
export const findSeaExit = (world: WorldData, turning: Uint8Array, from: SettlementPoint,
  accepts: (point: SettlementPoint) => boolean = () => true) => {
  const first = nearestTurnable(world, turning, from);
  if (first < 0) return null;
  const visited = new Uint8Array(turning.length), queue = [first];
  visited[first] = 1;
  let best = -1, bestDistance = Infinity;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    const distance = edgeDistance(world, x, z);
    const usable = accepts({ x: x + .5, z: z + .5 });
    if (usable && distance < bestDistance) { best = cell; bestDistance = distance; }
    if (usable && distance <= EDGE_MARGIN) break;
    for (const [dx, dz] of directions) {
      const nx = x + dx, nz = z + dz, next = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) continue;
      if (visited[next] || !turning[next]) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }
  return best < 0 ? null : { x: best % world.cellsX + .5, z: Math.floor(best / world.cellsX) + .5 };
};
