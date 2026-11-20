import { expect, it } from "vitest";

import { buildingGroundCoverCells } from "../src/app/settlement/island-building-clearance";
import { BUILDING_GROUND_COVER_MARGIN } from "../src/render-common/buildings/building-ground-cover";
import { getBuildingNavigationProfile } from "../src/render-common/buildings/building-navigation-profile";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createVertexFog } from "../src/render-common/chunk-sampling";
import { buildFieldCoverInstances } from "../src/render-common/props/field-cover";
import { setBuildingGroundCoverCells } from "../src/render-common/props/field-cover-exclusions";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { THEME_COUNT } from "../src/shared/world/generation/island-themes";
import { MATERIAL, MATERIAL_COUNT, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

/**
 * The owner's storehouse yard: its crates and canopy posts sit in cells the old five-point
 * sampling missed, so cover tufts grew through them. The fixture is a Japanese storehouse
 * (type 29) on forced meadow; an empty plot corner must keep its grass.
 */
const STOREHOUSE = { depth: 5, rotation: 0, typeId: 29, uid: 1, width: 5, x: 32.5, z: 32.5 } as const;
const REGION = { maxX: 42, maxZ: 42, minX: 24, minZ: 24 };

const forceMeadow = (world: WorldData) => {
  const stride = world.cellsX + 1;
  for (let z = 18; z <= 46; z++) for (let x = 18; x <= 46; x++) {
    const vertex = z * stride + x, base = vertex * MATERIAL_COUNT;
    world.splat.fill(0, base, base + MATERIAL_COUNT);
    world.splat[base + MATERIAL.grass] = 255;
    world.heights[vertex] = 0;
    world.moisture[vertex] = 180;
    world.waterDepth[vertex] = 0;
    world.coastDistance[vertex] = 10;
  }
  for (let z = 18; z <= 45; z++) for (let x = 18; x <= 45; x++)
    world.slopeClass[z * world.cellsX + x] = 0;
  world.themeWeights.fill(0);
  for (let vertex = 0; vertex < stride * (world.cellsZ + 1); vertex++)
    world.themeWeights[vertex * THEME_COUNT] = 255;
};

const footprintsOf = (
  parts: ReturnType<typeof getBuildingNavigationProfile>["recipe"]["parts"],
  scale: number, building: { x: number; z: number }
) => parts.map(part => {
  const bounds = getRomanPartBounds(part);
  return {
    maxX: building.x + Math.max(bounds.min[0], bounds.max[0]) * scale + BUILDING_GROUND_COVER_MARGIN,
    maxZ: building.z + Math.max(bounds.min[2], bounds.max[2]) * scale + BUILDING_GROUND_COVER_MARGIN,
    minX: building.x + Math.min(bounds.min[0], bounds.max[0]) * scale - BUILDING_GROUND_COVER_MARGIN,
    minZ: building.z + Math.min(bounds.min[2], bounds.max[2]) * scale - BUILDING_GROUND_COVER_MARGIN
  };
});

const groundProps = () => {
  const profile = getBuildingNavigationProfile(STOREHOUSE.typeId, "japanese", 1);
  return footprintsOf(profile.recipe.parts.filter(part =>
    part.shape === "bevel-box" && part.surface === "wood" && part.size[0] > .3 ||
    part.shape === "cylinder" && part.surface === "wood" && part.size[1] > 1 ||
    part.shape === "sphere" && part.surface === "wood"
  ), profile.scale, STOREHOUSE);
};

const instancesInside = (
  instances: ReturnType<typeof buildFieldCoverInstances>,
  footprints: ReturnType<typeof groundProps>
) => {
  let count = 0;
  for (let index = 0; index < instances.count; index++) {
    const x = instances.x[index]!, z = instances.z[index]!;
    if (footprints.some(box => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ)) count++;
  }
  return count;
};

const instancesInCell = (instances: ReturnType<typeof buildFieldCoverInstances>, cellX: number, cellZ: number) => {
  let count = 0;
  for (let index = 0; index < instances.count; index++)
    if (Math.floor(instances.x[index]!) === cellX && Math.floor(instances.z[index]!) === cellZ) count++;
  return count;
};

it("keeps cover tufts out of small stock/yard props and their lean margin, but not an empty yard corner", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 1000 });
  forceMeadow(world);
  const fog = createVertexFog(world), footprints = groundProps();
  expect(instancesInside(buildFieldCoverInstances(world, fog, 20, REGION), footprints)).toBeGreaterThan(0);

  const cells = buildingGroundCoverCells(STOREHOUSE as SettlementBuilding, "japanese", world);
  expect(cells).toContain(34 * world.cellsX + 33);
  expect(cells).not.toContain(34 * world.cellsX + 34);
  setBuildingGroundCoverCells(world, STOREHOUSE.uid, cells);
  const covered = buildFieldCoverInstances(world, fog, 20, REGION);
  expect(instancesInside(covered, footprints)).toBe(0);
  expect(instancesInCell(covered, 34, 34)).toBeGreaterThan(0);
});

it("keeps cover tufts out of the woodcutter's grounded stock logs", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 1000 });
  forceMeadow(world);
  const woodcutter = { depth: 4, rotation: 0, typeId: 17, uid: 2, width: 4, x: 32.5, z: 32.5 } as const;
  const profile = getBuildingNavigationProfile(woodcutter.typeId, "japanese", 1);
  const footprints = footprintsOf(profile.recipe.parts.filter(part => part.stock), profile.scale, woodcutter);
  const fog = createVertexFog(world);
  expect(instancesInside(buildFieldCoverInstances(world, fog, 20, REGION), footprints)).toBeGreaterThan(0);

  const cells = buildingGroundCoverCells(woodcutter as SettlementBuilding, "japanese", world);
  expect(cells).not.toContain(30 * world.cellsX + 34);
  setBuildingGroundCoverCells(world, woodcutter.uid, cells);
  const covered = buildFieldCoverInstances(world, fog, 20, REGION);
  expect(instancesInside(covered, footprints)).toBe(0);
  expect(instancesInCell(covered, 34, 30)).toBeGreaterThan(0);
});
