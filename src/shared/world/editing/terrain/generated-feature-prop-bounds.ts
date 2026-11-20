import { createPropStones } from "../../../../render-common/rocks/meadow-stones";
import { createRockShape } from "../../../../render-common/rocks/rock-shapes";
import type { RockTerrain } from "../../../../render-common/rocks/rock-terrain";
import { createCellRandom, deriveSeed } from "../../rng";
import type { WorldData } from "../../world-data";

const shapes = new Map<string, Float32Array>();

/** Measure both native rock shells and their companions from the existing per-ID mesh recipe.
 * Flat grounding changes Y only, so this is the actual horizontal envelope at any terrain height. */
export const nativeFeatureStoneRadius = (world: WorldData, id: number) => {
  const x = world.props.x[id]!,
    z = world.props.z[id]!;
  const terrain: RockTerrain = {
    cellsX: world.cellsX,
    cellsZ: world.cellsZ,
    height: () => 0,
    moisture: () => 0,
    mountain: () => 0,
    visibility: () => 1
  };
  const stones = createPropStones(
    world.props.types[id]!,
    { x, z, scale: world.props.scale[id]!, yaw: world.props.rotation[id]! },
    {
      terrain,
      tint: () => 0,
      random: createCellRandom(deriveSeed(world.seed, "meadow-stones"), id)
    }
  );
  let radius = 0;
  for (const stone of stones)
    for (const detail of ["high", "low"] as const) {
      const key = `${stone.family}/${stone.variant}/${detail}`;
      let positions = shapes.get(key);
      if (!positions) {
        positions = createRockShape(stone.family, stone.variant, detail).positions;
        shapes.set(key, positions);
      }
      for (let vertex = 0; vertex < positions.length; vertex += 3) {
        const px =
          stone.centre[0] -
          x +
          stone.axes[0][0] * positions[vertex]! +
          stone.axes[1][0] * positions[vertex + 1]! +
          stone.axes[2][0] * positions[vertex + 2]!;
        const pz =
          stone.centre[2] -
          z +
          stone.axes[0][2] * positions[vertex]! +
          stone.axes[1][2] * positions[vertex + 1]! +
          stone.axes[2][2] * positions[vertex + 2]!;
        radius = Math.max(radius, Math.hypot(px, pz));
      }
    }
  return radius;
};
