import { MATERIAL_COUNT, type WorldData } from "../../world-data";
import type { TerrainEditState } from "./terrain-edit-state";

/** Bake only preflighted primary vertices into the measured editor baseline. */
export const commitFeatureTerrain = (
  world: WorldData,
  state: TerrainEditState,
  vertices: readonly number[],
  draft: Pick<WorldData, "heights" | "waterSurface"> &
    Partial<Pick<WorldData, "flow" | "lakeWater">>
) => {
  state.base ??= {
    heights: world.heights.slice(),
    waterSurface: world.waterSurface.slice(),
    splat: world.splat.slice()
  };
  state.rise ??= new Float32Array(world.heights.length);
  state.ring ??= new Float32Array(world.heights.length);
  state.lake ??= new Uint8Array(world.heights.length);
  if (draft.lakeWater) world.lakeWater ??= new Uint8Array(world.heights.length);
  for (const vertex of vertices) {
    world.heights[vertex] = state.base.heights[vertex] = draft.heights[vertex]!;
    world.waterSurface[vertex] = state.base.waterSurface[vertex] = draft.waterSurface[vertex]!;
    world.waterDepth[vertex] = Math.max(0, draft.waterSurface[vertex]! - draft.heights[vertex]!);
    if (draft.flow) {
      world.flow[vertex * 2] = draft.flow[vertex * 2]!;
      world.flow[vertex * 2 + 1] = draft.flow[vertex * 2 + 1]!;
    }
    if (world.lakeWater && draft.lakeWater) world.lakeWater[vertex] = draft.lakeWater[vertex]!;
    state.rise[vertex] = state.ring[vertex] = state.lake[vertex] = 0;
    state.base.splat.set(
      world.splat.subarray(vertex * MATERIAL_COUNT, (vertex + 1) * MATERIAL_COUNT),
      vertex * MATERIAL_COUNT
    );
  }
};
