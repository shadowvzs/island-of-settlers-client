import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { BLOCKING } from "../world/world-data";
import {
  ROAD_WIDTH,
  type RoadNetworkOptions,
  type RoadPoint,
  type RoadWorld,
  snapRoadPoint} from "./road-types";

/** Along a step: its start, middle and end (each with both corridor sides and the centre). */
const SAMPLE_FRACTIONS = [0, 0.5, 1] as const;

/** `width`: the corridor a step must keep clear (travel: the dirt width; construction: the reserved width). */
export const createRoadTraversal = (world: RoadWorld, options: RoadNetworkOptions, width = ROAD_WIDTH) => {
  const stride = world.cellsX * 2 + 1;
  const height =
    options.getHeight ?? ((x: number, z: number) => sampleSmooth(world, world.heights, x, z));
  const point = (node: number): RoadPoint => ({
    x: (node % stride) / 2,
    z: Math.floor(node / stride) / 2
  });
  const node = (position: RoadPoint) => {
    const snapped = snapRoadPoint(position);
    return snapped.z * 2 * stride + snapped.x * 2;
  };
  const validCoordinates = (x: number, z: number) =>
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    x >= 0 &&
    z >= 0 &&
    x <= world.cellsX &&
    z <= world.cellsZ;
  const validPoint = ({ x, z }: RoadPoint) => validCoordinates(x, z);
  const blocked = (x: number, z: number) => {
    if (!validCoordinates(x, z)) return true;
    const cellX = Math.min(world.cellsX - 1, Math.floor(x));
    const cellZ = Math.min(world.cellsZ - 1, Math.floor(z));
    return (
      world.blocking[cellZ * world.cellsX + cellX] !== BLOCKING.free ||
      Boolean(options.isBlocked?.(x, z))
    );
  };
  const walkable = (start: RoadPoint, end: RoadPoint) => {
    const dx = end.x - start.x,
      dz = end.z - start.z;
    const length = DMath.hypot(dx, dz);
    if (length === 0 || Math.abs(height(start.x, start.z) - height(end.x, end.z)) > length * 0.7)
      return false;
    // The same sample positions as ever (exact float expressions), without per-step arrays.
    const halfX = ((dz / length) * width) / 2, halfZ = ((dx / length) * width) / 2;
    for (let fractionIndex = 0; fractionIndex < SAMPLE_FRACTIONS.length; fractionIndex++) {
      const fraction = SAMPLE_FRACTIONS[fractionIndex]!;
      for (let side = -1; side <= 1; side++)
        if (blocked(start.x + dx * fraction - halfX * side, start.z + dz * fraction + halfZ * side)) return false;
    }
    return true;
  };
  const estimate =
    (end: RoadPoint, speed = 1) =>
    (current: number) => {
      const currentPoint = point(current);
      return DMath.hypot(currentPoint.x - end.x, currentPoint.z - end.z) / speed;
    };
  return { blocked, estimate, node, point, validPoint, walkable };
};
