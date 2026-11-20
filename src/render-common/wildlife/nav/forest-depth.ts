import { COLLIDER_KIND, type ColliderSet } from "./nav-colliders";
import { NAV_CELL, NAV_RES, type NavTerrain } from "./nav-terrain";

/**
 * Ground counts as forest where at least FOREST_TRUNKS trunks stand within FOREST_REACH: the
 * gaps between the trees of a stand are forest too, a lone tree or a pair is not.
 */
const FOREST_REACH = 2.2;
const FOREST_TRUNKS = 3;
const DIAGONAL = Math.SQRT2;

const markForest = (terrain: NavTerrain, colliders: ColliderSet) => {
  const { depth, width } = terrain;
  const counts = new Uint8Array(width * depth);
  for (let index = 0; index < colliders.count; index += 1) {
    if (colliders.kind[index] !== COLLIDER_KIND.trunk) continue;
    const x = colliders.x[index]!;
    const z = colliders.z[index]!;
    const first = (value: number) => Math.max(0, Math.floor((value - FOREST_REACH) * NAV_RES));
    const lastColumn = Math.min(width - 1, Math.floor((x + FOREST_REACH) * NAV_RES));
    const lastRow = Math.min(depth - 1, Math.floor((z + FOREST_REACH) * NAV_RES));
    for (let row = first(z); row <= lastRow; row += 1) {
      for (let column = first(x); column <= lastColumn; column += 1) {
        const dx = (column + 0.5) * NAV_CELL - x;
        const dz = (row + 0.5) * NAV_CELL - z;
        const cell = row * width + column;
        if (dx * dx + dz * dz <= FOREST_REACH * FOREST_REACH && counts[cell]! < 255)
          counts[cell]! += 1;
      }
    }
  }
  return counts.map((count) => (count >= FOREST_TRUNKS ? 1 : 0));
};

/** Two pass chamfer distance (nav cells) from every open cell into the forest. */
const relax = (distance: Float32Array, width: number, depth: number, forward: boolean) => {
  const step = forward ? 1 : -1;
  const startRow = forward ? 0 : depth - 1;
  const startColumn = forward ? 0 : width - 1;
  for (let row = startRow; row >= 0 && row < depth; row += step) {
    for (let column = startColumn; column >= 0 && column < width; column += step) {
      const cell = row * width + column;
      if (distance[cell] === 0) continue;
      const back = row - step;
      const side = column - step;
      let best = distance[cell]!;
      if (side >= 0 && side < width) best = Math.min(best, distance[cell - step]! + 1);
      if (back >= 0 && back < depth) {
        best = Math.min(best, distance[cell - step * width]! + 1);
        if (side >= 0 && side < width)
          best = Math.min(best, distance[cell - step * width - step]! + DIAGONAL);
        const other = column + step;
        if (other >= 0 && other < width)
          best = Math.min(best, distance[cell - step * width + step]! + DIAGONAL);
      }
      distance[cell] = best;
    }
  }
};

/**
 * How far (world units) each nav cell lies inside a forest: 0 in the open, growing towards the
 * forest core. Species with a forest depth limit (elk) only enter the forest's margin.
 */
export const createForestDepth = (terrain: NavTerrain, colliders: ColliderSet) => {
  const { depth, width } = terrain;
  const forest = markForest(terrain, colliders);
  const distance = new Float32Array(width * depth);
  for (let cell = 0; cell < distance.length; cell += 1)
    distance[cell] = forest[cell] ? Infinity : 0;
  relax(distance, width, depth, true);
  relax(distance, width, depth, false);
  for (let cell = 0; cell < distance.length; cell += 1) distance[cell]! *= NAV_CELL;
  return distance;
};
