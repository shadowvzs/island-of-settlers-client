import { DEFAULT_WORLD_OPTIONS } from "../../src/shared/world/generation/generate-world";
import { BLOCKING, BUILD, MATERIAL, MATERIAL_COUNT, PROP, type WorldData } from "../../src/shared/world/world-data";
import { cachedWorld } from "./cached-worlds";

export const huntingWorld = (size = 64) => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size, erosionDroplets: 0 });
  world.heights.fill(2);
  world.blocking.fill(0);
  world.walkCost.fill(10);
  world.buildClass.fill(BUILD.large);
  world.buildCap.fill(BUILD.large);
  world.slopeClass.fill(0);
  world.seaLevel = -1;
  world.props.count = 0;
  world.splat.fill(0);
  for (let i = 0; i < world.splat.length; i += MATERIAL_COUNT) world.splat[i + MATERIAL.grass] = 255;
  world.start = { x: 10, z: 10 };
  return world;
};

/** The eastern forest edge of the develop fixtures: a woodcutter needs standing trees in reach (EAI3-accept). */
const FOREST_EDGE = { maxZ: 60, minX: 58, minZ: 32, step: 3 };

/** Plants a sparse belt of broadleaf trees along the island's east edge (props and blocked cells). */
export const plantForestEdge = (world: WorldData) => {
  const { maxZ, minX, minZ, step } = FOREST_EDGE;
  let count = 0;
  for (let z = minZ; z <= maxZ; z += step) for (let x = minX; x < world.cellsX - 1; x += step) {
    world.props.types[count] = PROP.broadleafTree;
    world.props.x[count] = x + .5;
    world.props.z[count] = z + .5;
    world.props.scale[count++] = 1;
    world.blocking[z * world.cellsX + x] = BLOCKING.prop;
  }
  world.props.count = count;
};
