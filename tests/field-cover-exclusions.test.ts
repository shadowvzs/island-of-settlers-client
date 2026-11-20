import { expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { buildFieldCoverInstances } from "../src/render-common/props/field-cover";
import {
  clearBuildingGroundCoverCells,
  excludeFieldCoverRegion, excludeRoadFieldCover, fieldCropCoverCells, fitRoadsideCover,
  isRoadCoverExcluded, roadsideCoverWeight, setBuildingGroundCoverCells,
  setFieldCropCoverCells
} from "../src/render-common/props/field-cover-exclusions";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";

it("keeps road and planned ground bare after cover rebuilds without repainting terrain or changing surrounding plants", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 1000 });
  const fog = createVertexFog(world);
  const before = buildFieldCoverInstances(world, fog, 4);
  expect(before.count).toBeGreaterThan(0);
  const seedIndex = Math.floor(before.count / 2);
  const x = Math.floor(before.x[seedIndex]!), z = Math.floor(before.z[seedIndex]!);
  const terrain = world.splat.slice();
  const road = [{ start: { x: x - 2, z: z + 0.5 }, end: { x: x + 2, z: z + 0.5 }, tier: "dirt" as const }];
  excludeFieldCoverRegion(world, { minX: x, maxX: x, minZ: z + 1, maxZ: z + 1 });
  excludeRoadFieldCover(world, road);
  expect(isRoadCoverExcluded(world, x + 0.5, z + 0.5)).toBe(true);
  expect(isRoadCoverExcluded(world, x + 0.5, z - 0.1)).toBe(false);
  const after = buildFieldCoverInstances(world, fog, 4);
  const again = buildFieldCoverInstances(world, fog, 4);
  expect(after.x).toEqual(again.x);
  expect(after.z).toEqual(again.z);
  expect(world.splat).toEqual(terrain);
  const expected = [];
  for (let index = 0; index < before.count; index++) {
    const px = before.x[index]!, pz = before.z[index]!;
    if (Math.floor(px) === x && Math.floor(pz) === z + 1 || isRoadCoverExcluded(world, px, pz)) continue;
    if (!fitRoadsideCover(world, { scale: 1, stretch: 1, x: px, z: pz })) continue;
    expected.push(`${px}:${pz}:${before.meshIds[index]}`);
  }
  const actual = Array.from({ length: after.count }, (_, index) =>
    `${after.x[index]}:${after.z[index]}:${after.meshIds[index]}`);
  expect(actual).toEqual(expected);
});

type CoverInstances = ReturnType<typeof buildFieldCoverInstances>;

/** Instances in the band one cell either side of a road along `centre.z`, within 5 cells of `centre.x`. */
const vergeInstances = (instances: CoverInstances, centre: { x: number; z: number }) =>
  Array.from({ length: instances.count }, (_, index) => index)
    .filter(index => Math.abs(instances.x[index]! - centre.x) < 5 &&
      Math.abs(Math.abs(instances.z[index]! - centre.z) - 1) < .15);

/**
 * A road centre in dense meadow: the first instance from the middle of the list whose verge band holds
 * more than 8 tufts, so world generation tweaks (e.g. the coastal mine gravel fade) cannot leave the
 * test road on a sparse patch.
 */
const denseMeadowCentre = (instances: CoverInstances) => {
  for (let index = Math.floor(instances.count / 2); index < instances.count; index++) {
    const centre = { x: Math.floor(instances.x[index]!), z: instances.z[index]! };
    if (vergeInstances(instances, centre).length > 8) return centre;
  }
  throw new Error("no dense meadow in the field cover");
};

it("thins and lowers meadow tufts across a road verge but leaves door lanes and the far meadow alone", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 1000 });
  const fog = createVertexFog(world);
  excludeRoadFieldCover(world, []);
  const before = buildFieldCoverInstances(world, fog, 10);
  const centre = denseMeadowCentre(before);
  const road = { end: { x: centre.x + 6, z: centre.z }, start: { x: centre.x - 6, z: centre.z },
    tier: "stone" as const, verge: "flowers" as const };
  excludeRoadFieldCover(world, [road]);
  expect(roadsideCoverWeight(world, centre.x, centre.z + .5)).toBeNull();
  expect(roadsideCoverWeight(world, centre.x, centre.z + 1)).toBe(0);
  expect(roadsideCoverWeight(world, centre.x, centre.z + 1.6)).toBeGreaterThan(0);
  expect(roadsideCoverWeight(world, centre.x, centre.z + 1.6)).toBeLessThan(1);
  expect(roadsideCoverWeight(world, centre.x, centre.z + 2)).toBe(1);
  // The same road without the saved verge keeps its full meadow: no thinning until it is planted.
  excludeRoadFieldCover(world, [{ ...road, verge: undefined }]);
  expect(roadsideCoverWeight(world, centre.x, centre.z + 1)).toBe(1);
  expect(roadsideCoverWeight(world, centre.x, centre.z + 1.6)).toBe(1);
  excludeRoadFieldCover(world, [road]);
  const after = buildFieldCoverInstances(world, fog, 10);
  const [verge, vergeBefore] = [vergeInstances(after, centre), vergeInstances(before, centre)];
  expect(vergeBefore.length).toBeGreaterThan(8);
  expect(verge.length).toBeLessThan(vergeBefore.length * .4);
  for (const index of verge) expect(after.stretch[index]!).toBeLessThan(.6);
  const far = (instances: typeof before) => Array.from({ length: instances.count }, (_, index) => index)
    .filter(index => Math.abs(instances.z[index]! - centre.z) > 2.2)
    .map(index => `${instances.x[index]}:${instances.z[index]}:${instances.stretch[index]}`);
  expect(far(after)).toEqual(far(before));
  excludeRoadFieldCover(world, [{ ...road, doorway: true }]);
  expect(roadsideCoverWeight(world, centre.x, centre.z + 1)).toBe(1);
  excludeRoadFieldCover(world, []);
});

it("keeps terrain grass out of wheat and rice tiles until those crops are gone", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 1000 });
  const fog = createVertexFog(world);
  const before = buildFieldCoverInstances(world, fog, 6);
  expect(before.count).toBeGreaterThan(0);
  const cells = new Map<number, { x: number; z: number }>();
  for (let index = 0; index < before.count && cells.size < 3; index++) {
    const x = Math.floor(before.x[index]!), z = Math.floor(before.z[index]!);
    cells.set(z * world.cellsX + x, { x, z });
  }
  const [wheat, rice, hive] = [...cells.values()];
  expect(wheat && rice && hive).toBeTruthy();
  const cropCells = fieldCropCoverCells([
    { kind: "grain", x: wheat!.x + 0.5, z: wheat!.z + 0.5 },
    { kind: "rice", x: rice!.x + 0.5, z: rice!.z + 0.5 },
    { kind: "hive", x: hive!.x + 0.5, z: hive!.z + 0.5 }
  ], world.cellsX);
  expect(cropCells.size).toBe(2);
  setFieldCropCoverCells(world, cropCells);
  const after = buildFieldCoverInstances(world, fog, 6);
  const cellAt = (x: number, z: number) => Math.floor(z) * world.cellsX + Math.floor(x);
  for (let index = 0; index < after.count; index++) {
    const cell = cellAt(after.x[index]!, after.z[index]!);
    expect(cropCells.has(cell), `grass in crop cell ${cell}`).toBe(false);
  }
  const hiveBefore = Array.from({ length: before.count }, (_, index) => index)
    .filter(index => cellAt(before.x[index]!, before.z[index]!) === hive!.z * world.cellsX + hive!.x).length;
  const hiveAfter = Array.from({ length: after.count }, (_, index) => index)
    .filter(index => cellAt(after.x[index]!, after.z[index]!) === hive!.z * world.cellsX + hive!.x).length;
  expect(hiveBefore).toBeGreaterThan(0);
  expect(hiveAfter).toBe(hiveBefore);
  setFieldCropCoverCells(world, new Set());
  const restored = buildFieldCoverInstances(world, fog, 6);
  expect(restored.x).toEqual(before.x);
  expect(restored.z).toEqual(before.z);
});

it("clears only physical building cells and restores empty exterior yard pockets after demolition", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 1000 });
  const fog = createVertexFog(world);
  const before = buildFieldCoverInstances(world, fog, 6);
  expect(before.count).toBeGreaterThan(0);
  const cellAt = (x: number, z: number) => Math.floor(z) * world.cellsX + Math.floor(x);
  const physical = new Set<number>();
  for (let index = 0; index < before.count && physical.size < 3; index++)
    physical.add(cellAt(before.x[index]!, before.z[index]!));
  expect(physical.size).toBe(3);
  const [first, second, third] = [...physical];
  setBuildingGroundCoverCells(world, 1, [first!, second!]);
  setBuildingGroundCoverCells(world, 2, [second!, third!]);
  const after = buildFieldCoverInstances(world, fog, 6);
  for (let index = 0; index < after.count; index++)
    expect(physical.has(cellAt(after.x[index]!, after.z[index]!))).toBe(false);
  clearBuildingGroundCoverCells(world, 1);
  const sharedStillBare = buildFieldCoverInstances(world, fog, 6);
  const hasCell = (cover: typeof before, cell: number) => {
    for (let index = 0; index < cover.count; index++)
      if (cellAt(cover.x[index]!, cover.z[index]!) === cell) return true;
    return false;
  };
  expect(hasCell(sharedStillBare, first!)).toBe(true);
  expect(hasCell(sharedStillBare, second!)).toBe(false);
  clearBuildingGroundCoverCells(world, 2);
  const restored = buildFieldCoverInstances(world, fog, 6);
  expect(restored.x).toEqual(before.x);
  expect(restored.z).toEqual(before.z);
});
