import { expect, it, vi } from "vitest";

import { getBuildingNavigationProfile } from "../src/render-common/buildings/building-navigation-profile";
import { isGroundSegmentClear, isNavigationClear, searchGroundPath } from "../src/shared/settlement/settlement-navigation";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { publicTerrainPath } from "../src/shared/settlement/settlement-terrain-routing";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { outdoorWorkPath } from "../src/shared/settlement/settlement-worker-stock-paths";
import { addPlot, createTrafficWorld } from "./helpers/traffic-scenario";

const longWall = (closed = false) => {
  const scene = createTrafficWorld(96);
  for (let z = 0; z < (closed ? 96 : 81); z++) scene.world.walkCost[z * 96 + 40] = 0;
  const building = { uid: 1, workerApproach: { x: 55, z: 20 } } as SettlementBuilding;
  return { ...scene, building, target: { x: 35, z: 4 } };
};

it("finds a physically clear outdoor route when a long fine search exhausts its local budget", () => {
  const { building, context, target } = longWall();
  expect(searchGroundPath(context, building.workerApproach, target)).toMatchObject({
    status: "budget-exhausted", visits: 16_384
  });
  const before = { ...building.workerApproach };
  const path = outdoorWorkPath(context, building, target);
  expect(path).not.toBeNull();
  let previous = building.workerApproach;
  for (const point of path!) {
    expect(isGroundSegmentClear(context, previous, point)).toBe(true);
    previous = point;
  }
  expect(path!.at(-1)).toEqual(target);
  expect(building.workerApproach).toEqual(before);
});

it("does not cross a closed wall to reach a resource", () => {
  const { building, context, target } = longWall(true);
  expect(outdoorWorkPath(context, building, target)).toBeNull();
});

it("keeps a valid fine route when a clear off-centre start has no coarse corridor", () => {
  const { context } = createTrafficWorld(96);
  context.playerNation = "chinese"; context.nextBuilding = 40;
  const tower = makeBuilding(context, 16, 52.5, 52.5, 3);
  tower.construction = 1; tower.input = { stone: 2 }; context.buildings.push(tower);
  const building = { uid: 1, workerApproach: { x: 53.94035277499918, z: 53.78090367348567 } } as SettlementBuilding;
  const target = { x: 79, z: 53.78090367348567 };
  expect(publicTerrainPath(context, building.workerApproach, target)).toBeNull();
  const fine = searchGroundPath(context, building.workerApproach, target);
  expect(fine.status).toBe("found");
  expect(outdoorWorkPath(context, building, target)).toEqual(fine.path);
});

it("retains an injected worker path provider for a long outdoor leg", () => {
  const { building, context, target } = longWall();
  const authored = [{ x: 55, z: 82 }, { x: 35, z: 82 }, target];
  context.options.findWorkerPath = vi.fn(() => authored);
  expect(outdoorWorkPath(context, building, target)).toBe(authored);
  expect(context.options.findWorkerPath).toHaveBeenCalledExactlyOnceWith(building.workerApproach, target);
});

it("retains an authored Fisher shore entry and its final dry bridge", () => {
  const { context } = createTrafficWorld(96);
  const building = { uid: 1, workerApproach: { x: 60, z: 60 } } as SettlementBuilding;
  const target = { x: 20, z: 20, shoreEntry: { x: 21, z: 22 }, waterY: 0 };
  const path = outdoorWorkPath(context, building, target)!;
  expect(path).not.toBeNull();
  expect(path).toContainEqual(target.shoreEntry);
  expect(path.at(-1)).toEqual({ x: target.x, z: target.z });
  expect(path.slice(-23)).not.toContainEqual(target.shoreEntry);
});

it("never borrows the worker's private courtyard permission for an outdoor target", () => {
  const scene = createTrafficWorld(32);
  const building = addPlot(scene, { uid: 1, typeId: 17, x: 16, z: 16,
    width: 4, depth: 4, doorRotation: 0 });
  const interior = getBuildingNavigationProfile(17, "roman").interiors[0]!;
  const target = { x: building.x + (interior.min[0] + interior.max[0]) / 2,
    z: building.z + (interior.min[2] + interior.max[2]) / 2 };
  scene.context.options.canWorkerEnterPlot = () => true;
  expect(isNavigationClear(scene.context, target)).toBe(false);
  expect(outdoorWorkPath(scene.context, building, target)).toBeNull();
});
