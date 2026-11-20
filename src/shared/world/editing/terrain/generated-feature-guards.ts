import type { WorldData } from "../../world-data";
import type { TerrainComponent } from "./terrain-component";

/** Whether a river flows through the selected cells (a relief contour crossed by a channel). */
export const hasFlowingWater = (world: WorldData, selection: TerrainComponent) => {
  const stride = world.cellsX + 1;
  return selection.cells.some((cell) => {
    const vertex = Math.floor(cell / world.cellsX) * stride + (cell % world.cellsX);
    return [vertex, vertex + 1, vertex + stride, vertex + stride + 1].some(
      (index) =>
        world.waterDepth[index]! > 0.01 &&
        Math.hypot(world.flow[index * 2]!, world.flow[index * 2 + 1]!) > 0.01
    );
  });
};

interface TransformedTerrain {
  heights: Float32Array;
  profileSlope: number;
  protectedVertices: ReadonlySet<number>;
}

const isRoadGraded = (world: WorldData, vertex: number) =>
  !!world.roadGradeApplied &&
  !!world.roadGradeBase &&
  Math.abs(world.roadGradeApplied[vertex]! - world.roadGradeBase[vertex]!) > 0.00001;

const assertClearVertex = (world: WorldData, vertex: number, terrain: TransformedTerrain) => {
  if (terrain.protectedVertices.has(vertex))
    throw new Error(
      "This transform touches a protected plot, resource or authored feature. Choose a clear destination."
    );
  if (isRoadGraded(world, vertex))
    throw new Error("This transform touches a graded road. Choose a destination away from roads.");
  if (Math.hypot(world.flow[vertex * 2]!, world.flow[vertex * 2 + 1]!) > 0.01)
    throw new Error(
      "This transform touches a river. Move the relief clear of it or include the river course."
    );
};

/** A join up to this step is always walkable ground (the editor's slope limit). */
const SLOPE_LIMIT = 0.7;

/**
 * Every changed vertex must be clear of unrelated features; no join may become steeper than the
 * slope limit or than the relief's own profile laid on the ground slope there before.
 */
export const assertClearTransform = (
  world: WorldData,
  changed: readonly number[],
  terrain: TransformedTerrain
) => {
  const stride = world.cellsX + 1,
    { heights, profileSlope } = terrain;
  for (const vertex of changed) {
    assertClearVertex(world, vertex, terrain);
    for (const neighbour of [vertex - 1, vertex + 1, vertex - stride, vertex + stride]) {
      const step = Math.abs(heights[vertex]! - heights[neighbour]!);
      const before = Math.abs(world.heights[vertex]! - world.heights[neighbour]!);
      if (step > Math.max(SLOPE_LIMIT, profileSlope + before) + 0.05)
        throw new Error(
          "The transformed profile would create a new steep terrain join. Use a clearer, flatter destination or larger size."
        );
    }
  }
};
