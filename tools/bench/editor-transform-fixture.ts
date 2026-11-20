import { applyAuthoredRiver } from "../../src/shared/world/editing/authored-rivers";
import { appendProp, resizeProps } from "../../src/shared/world/editing/prop-set";
import { refreshEditedTerrain } from "../../src/shared/world/editing/terrain/terrain-apply";
import { sampleSmooth } from "../../src/shared/world/grid-geometry";
import {
  MATERIAL,
  MATERIAL_COUNT,
  PROP,
  type WorldData
} from "../../src/shared/world/world-data";

/** Explicit synthetic native editor fixture, never a procedural/natural economy acceptance claim. */
export const createEditorTransformFixture = (world: WorldData) => {
  const stride = world.cellsX + 1;
  world.start = { x: 16.5, z: 16.5 };
  for (let z = 8; z <= 110; z++) for (let x = 8; x <= 115; x++) world.heights[z * stride + x] = 1;
  for (let z = 40; z <= 56; z++)
    for (let x = 40; x <= 56; x++)
      world.heights[z * stride + x] = 1 + Math.max(0, 1 - Math.hypot(x - 48, z - 48) / 7);
  for (let z = 8; z <= 110; z++)
    for (let x = 8; x <= 115; x++) {
      const offset = (z * stride + x) * MATERIAL_COUNT;
      world.splat.fill(0, offset, offset + MATERIAL_COUNT);
      world.splat[offset + MATERIAL.grass] = 255;
    }
  world.waterSurface.fill(0);
  world.flow.fill(0);
  world.lakeWater?.fill(0);
  world.waterDepth.set(Float32Array.from(world.heights, (height) => Math.max(0, -height)));
  world.waterfalls = [];
  world.authoredRivers = undefined;
  world.generatedRivers = undefined;
  world.generatedFeatureIdentities = undefined;
  world.scenario = undefined;
  world.mineZone.fill(0);
  world.oreAmount.fill(0);
  world.mineZones = [
    { id: 1, cellCount: 4, centreX: 52, centreZ: 51, ore: 1, richness: 0.8, surveyed: true }
  ];
  for (const [index, cell] of [
    50 * 128 + 51,
    50 * 128 + 52,
    51 * 128 + 51,
    51 * 128 + 52
  ].entries()) {
    world.mineZone[cell] = 1;
    world.oreAmount[cell] = [7, 19, 33, 41][index]!;
  }
  resizeProps(world.props, 0);
  const river = {
    id: 1,
    width: 1,
    depth: 0.3,
    points: [
      { x: 48, z: 48 },
      { x: 32, z: 48 }
    ],
    patches: [],
    falls: []
  };
  applyAuthoredRiver(world, river);
  world.authoredRivers = [river];
  const sourceProp = appendProp(world.props, {
    type: PROP.largeRock,
    form: 0,
    phase: 0.3,
    rotation: 0.7,
    scale: 0.7,
    x: 53,
    z: 48,
    y: sampleSmooth(world, world.heights, 53, 48)
  });
  appendProp(world.props, {
    type: PROP.hardwoodTree,
    form: 7,
    phase: 0.7,
    rotation: 1.2,
    scale: 0.6,
    x: 52,
    z: 53,
    y: sampleSmooth(world, world.heights, 52, 53)
  });
  world.colonyStoneDeposits = [
    { id: 0, material: "marble", remaining: 17, sourceProp, x: 53, z: 48 }
  ];
  refreshEditedTerrain(world, { minX: 0, minZ: 0, maxX: 127, maxZ: 127 }, true);
  return world;
};
