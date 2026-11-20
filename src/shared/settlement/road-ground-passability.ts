import { DMath } from "../math/deterministic-math";
import { getCellTerrain } from "../world/generation/gameplay";
import { sampleSmooth } from "../world/grid-geometry";
import { BLOCKING, type WorldData } from "../world/world-data";
import { type RoadHeightConstraint } from "./road-height-constraints";
import { ROAD_WIDTH, type RoadSegment } from "./road-types";

/** Match travel's centre/side samples, including the far endpoint's cell at grid joins. */
export const roadCorridorCells = (world: WorldData, roads: readonly RoadSegment[]) => {
  const cells = new Set<number>();
  for (const road of roads) {
    const dx = road.end.x - road.start.x, dz = road.end.z - road.start.z;
    const length = DMath.hypot(dx, dz);
    if (!length) continue;
    for (const fraction of [0, .5, 1]) for (const side of [-1, 0, 1]) {
      const x = road.start.x + dx * fraction - dz / length * ROAD_WIDTH / 2 * side;
      const z = road.start.z + dz * fraction + dx / length * ROAD_WIDTH / 2 * side;
      const cellX = Math.max(0, Math.min(world.cellsX - 1, Math.floor(x)));
      const cellZ = Math.max(0, Math.min(world.cellsZ - 1, Math.floor(z)));
      cells.add(cellZ * world.cellsX + cellX);
    }
  }
  return cells;
};

/** Endpoint slopes alone cannot prevent a traversed cell becoming a four-corner cliff. */
export const roadCellHeightConstraints = (world: WorldData, cells: ReadonlySet<number>) => {
  const constraints: RoadHeightConstraint[] = [];
  for (const cell of cells) {
    const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    const a = z * (world.cellsX + 1) + x;
    const vertices = [a, a + 1, a + world.cellsX + 1, a + world.cellsX + 2];
    for (let first = 0; first < 4; first++) for (let second = first + 1; second < 4; second++)
      constraints.push({ limit: 1.45, weights: [
        { vertex: vertices[first]!, value: 1 }, { vertex: vertices[second]!, value: -1 }
      ] });
  }
  return constraints;
};

export const roadGroundPassable = (world: WorldData, roads: readonly RoadSegment[]) => {
  for (const road of roads) {
    const rise = Math.abs(sampleSmooth(world, world.heights, road.start.x, road.start.z) -
      sampleSmooth(world, world.heights, road.end.x, road.end.z));
    if (rise > DMath.hypot(road.end.x - road.start.x, road.end.z - road.start.z) * .7) return false;
  }
  for (const cell of roadCorridorCells(world, roads)) {
    const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    if (getCellTerrain(world, world, x, z).blocking !== BLOCKING.free) return false;
  }
  return true;
};
