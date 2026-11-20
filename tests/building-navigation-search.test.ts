import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { isPublicBuildingPointClear, withBuildingNavigationSearch } from "../src/shared/settlement/settlement-building-navigation";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { createTrafficWorld } from "./helpers/traffic-scenario";

const fixture = () => {
  const { context } = createTrafficWorld(24);
  context.nextBuilding = 0; context.playerNation = "chinese";
  const [width, depth] = getBuildingDefinition(33).gridFootprint;
  const building = makeBuilding(context, 33, 12 + width % 2 / 2, 12 + depth % 2 / 2, 1);
  building.construction = 1; building.input = { logs: 4 }; building.output = { planks: 6 };
  context.buildings.push(building);
  const points = [];
  for (let z = building.z - depth / 2 - 1; z <= building.z + depth / 2 + 1; z += .125)
    for (let x = building.x - width / 2 - 1; x <= building.x + width / 2 + 1; x += .125) points.push({ x, z });
  return { building, context, points };
};

it("reuses search-local stock geometry while preserving every sampled physical clearance", () => {
  const { building, context, points } = fixture();
  const expected = points.map(point => isPublicBuildingPointClear(context, point));
  const input = building.input;
  let reads = 0;
  Object.defineProperty(building, "input", { get: () => { reads++; return input; } });
  const actual = withBuildingNavigationSearch(context, () => points.map(point => isPublicBuildingPointClear(context, point)));
  expect(actual).toEqual(expected);
  expect(reads).toBeLessThan(20);
  expect(expected).toContain(true);
  expect(expected).toContain(false);
});

it("observes changed stock and building level in the next search even within the same tick", () => {
  const { building, context, points } = fixture();
  const sample = () => points.map(point => isPublicBuildingPointClear(context, point));
  const initial = withBuildingNavigationSearch(context, sample);
  building.input.logs = 0; building.output.planks = 0;
  building.workshopUpgrade = { level: 2 } as typeof building.workshopUpgrade;
  const changed = sample();
  expect(withBuildingNavigationSearch(context, sample)).toEqual(changed);
  expect(changed).not.toEqual(initial);
});

it("cleans the search scope on exceptions and restores outer scopes after nested searches", () => {
  const { building, context, points } = fixture();
  const input = building.input;
  let reads = 0;
  Object.defineProperty(building, "input", { get: () => { reads++; return input; } });
  const point = points.find(candidate => {
    reads = 0; isPublicBuildingPointClear(context, candidate); return reads > 0;
  })!;
  expect(point).toBeDefined();
  withBuildingNavigationSearch(context, () => {
    isPublicBuildingPointClear(context, point);
    expect(() => withBuildingNavigationSearch(context, () => { throw new Error("cancelled"); })).toThrow("cancelled");
    reads = 0;
    isPublicBuildingPointClear(context, point);
    expect(reads).toBe(0);
  });
  reads = 0;
  isPublicBuildingPointClear(context, point);
  expect(reads).toBeGreaterThan(0);
});
