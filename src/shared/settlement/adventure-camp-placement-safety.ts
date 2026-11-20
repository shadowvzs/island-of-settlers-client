import { DMath } from "../math/deterministic-math";
import type { WorldData } from "../world/world-data";
import { type CampObstacle,campObstacleDistance, campSegmentTouchesObstacle } from "./adventure-camp-obstacles";
import { isBaseWorldNavigationClear, someObstacleInCells } from "./navigation-prop-geometry";

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const;

/**
 * A bounded patch surrounds the complete new shell. Every old boundary passage must remain
 * connected after insertion, on foot and mounted routing lattices. This rejects closing an isthmus
 * without an island-sized flood per decorative prop and preserves crossings for either army.
 */
export const campObstaclePreservesPassages = (
  world: WorldData, previous: readonly CampObstacle[], obstacle: CampObstacle
) => {
  for (const radius of [0, 1.05]) for (const step of [1, .5]) {
    if (!preservesPatch(world, previous, obstacle, radius, step)) return false;
  }
  return true;
};
const preservesPatch = (world: WorldData, previous: readonly CampObstacle[], obstacle: CampObstacle,
  radius: number, step: number) => {
  const reach = DMath.hypot(obstacle.halfX, obstacle.halfZ) + radius + 2;
  const minX = Math.floor(obstacle.x - reach) + .5, minZ = Math.floor(obstacle.z - reach) + .5;
  const width = Math.ceil(reach * 2 / step) + 2, size = width * width;
  const oldClear = new Uint8Array(size), nextClear = new Uint8Array(size);
  const maxX = minX + (width - 1) * step, maxZ = minZ + (width - 1) * step;
  const nearby = previous.filter(other => {
    const dx = Math.max(minX - other.x, 0, other.x - maxX), dz = Math.max(minZ - other.z, 0, other.z - maxZ);
    return DMath.hypot(dx, dz) < DMath.hypot(other.halfX, other.halfZ) + Math.max(.22, radius);
  });
  const point = (cell: number) => ({ x: minX + cell % width * step, z: minZ + Math.floor(cell / width) * step });
  for (let cell = 0; cell < size; cell++) {
    const location = point(cell);
    if (!isBaseWorldNavigationClear(world, location.x, location.z, radius) ||
      nearby.some(other => campObstacleDistance(other, location) < Math.max(.22, radius))) continue;
    oldClear[cell] = 1; nextClear[cell] = Number(campObstacleDistance(obstacle, location) >= Math.max(.22, radius));
  }
  // A single convex shell strictly inside an entirely open patch cannot close its perimeter.
  if (!nearby.length && oldClear.every(Boolean) && !patchHasProps(world, minX, minZ, maxX, maxZ, radius)) return true;
  const edges = baseEdges(world, oldClear, width, point, radius);
  const shellRadius = Math.max(.22, radius);
  const oldGroups = components(oldClear, width, point, nearby, shellRadius, edges);
  const nextGroups = components(nextClear, width, point, [...nearby, obstacle], shellRadius, edges);
  const passageGroups = new Map<number, number>();
  for (let cell = 0; cell < size; cell++) {
    const x = cell % width, z = Math.floor(cell / width);
    if (x !== 0 && z !== 0 && x !== width - 1 && z !== width - 1) continue;
    const group = oldGroups[cell]!;
    if (group < 0) continue;
    const next = nextGroups[cell]!;
    if (next < 0) return false;
    const known = passageGroups.get(group);
    if (known !== undefined && known !== next) return false;
    passageGroups.set(group, next);
  }
  return true;
};
const components = (clear: Uint8Array, width: number, point: (cell: number) => { x: number; z: number },
  obstacles: readonly CampObstacle[], radius: number, edges: Uint8Array) => {
  const groups = new Int32Array(clear.length).fill(-1), queue = new Int32Array(clear.length);
  let group = 0;
  for (let start = 0; start < clear.length; start++) {
    if (!clear[start] || groups[start] !== -1) continue;
    let head = 0, tail = 1; queue[0] = start; groups[start] = group;
    while (head < tail) {
      const current = queue[head++]!, x = current % width, z = Math.floor(current / width);
      for (let direction = 0; direction < NEIGHBOURS.length; direction++) {
        if (!(edges[current]! & (1 << direction))) continue;
        const [dx, dz] = NEIGHBOURS[direction]!;
        const nx = x + dx, nz = z + dz, next = nz * width + nx;
        if (nx < 0 || nz < 0 || nx >= width || nz >= width || !clear[next] || groups[next] !== -1) continue;
        if (dx && dz && (!clear[z * width + nx] || !clear[nz * width + x])) continue;
        if (obstacles.some(obstacle => campSegmentTouchesObstacle(obstacle, point(current), point(next), radius))) continue;
        groups[next] = group; queue[tail++] = next;
      }
    }
    group++;
  }
  return groups;
};

const baseEdges = (world: WorldData, clear: Uint8Array, width: number,
  point: (cell: number) => { x: number; z: number }, radius: number) => {
  const edges = new Uint8Array(clear.length);
  for (let cell = 0; cell < clear.length; cell++) {
    if (!clear[cell]) continue;
    const x = cell % width, z = Math.floor(cell / width), start = point(cell);
    for (let direction = 0; direction < NEIGHBOURS.length; direction++) {
      const [dx, dz] = NEIGHBOURS[direction]!, nx = x + dx, nz = z + dz, next = nz * width + nx;
      if (nx < 0 || nz < 0 || nx >= width || nz >= width || !clear[next]) continue;
      if (dx && dz && (!clear[z * width + nx] || !clear[nz * width + x])) continue;
      // Share the actor navigation's 5 cm segment sampling, computed only once for both floods.
      const end = point(next), steps = Math.ceil(DMath.hypot(end.x - start.x, end.z - start.z) / .05);
      let passable = true;
      for (let sample = 1; sample < steps; sample++) {
        if (isBaseWorldNavigationClear(world, start.x + (end.x - start.x) * sample / steps,
          start.z + (end.z - start.z) * sample / steps, radius)) continue;
        passable = false; break;
      }
      if (passable) edges[cell] = edges[cell]! | (1 << direction);
    }
  }
  return edges;
};

const patchHasProps = (world: WorldData, minX: number, minZ: number, maxX: number, maxZ: number, radius: number) => {
  const padding = 1.2 + radius;
  return someObstacleInCells(world, Math.floor(minX - padding), Math.floor(minZ - padding),
    Math.floor(maxX + padding), Math.floor(maxZ + padding), () => true);
};
