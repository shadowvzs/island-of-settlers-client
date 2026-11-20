import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import {   type BuildingCollisionBox, buildingModelsObstructRotors, buildingOverheadIntersectsBox, getPlacedBuildingModelBoxes,
type PlacedBuildingModel } from "../src/render-common/buildings/building-model-clearance";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { makeBuilding, placementReason } from "../src/shared/settlement/settlement-placement";
import { treePlantingClearsRotors } from "../src/shared/settlement/settlement-rotor-clearance";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, PROP, PROP_REMOVED } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 64;
  return { options: { world: {
    cellsX: size, cellsZ: size, heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large), mineZones: [],
    props: { count: 0, types: new Uint8Array(1), scale: new Float32Array([1.22]),
      form: new Uint8Array(1), x: new Float32Array(1), y: new Float32Array(1), z: new Float32Array(1) }
  }, roads: { segments: () => [] } }, nextBuilding: 0, buildings: [], occupied: new Uint8Array(size ** 2)
  } as unknown as SettlementContext;
};
const quarterBox = (box: BuildingCollisionBox, rotation: number): BuildingCollisionBox => {
  const angle = rotation * Math.PI / 2, cosine = Math.round(Math.cos(angle)), sine = Math.round(Math.sin(angle));
  const transform = (point: number[]) => [30.5 + point[0]! * cosine + point[2]! * sine,
    point[1]!, 30 + -point[0]! * sine + point[2]! * cosine];
  const first = transform(box.min), second = transform(box.max);
  return { min: first.map((value, axis) => Math.min(value, second[axis]!)) as [number, number, number],
    max: first.map((value, axis) => Math.max(value, second[axis]!)) as [number, number, number] };
};

describe("height-aware mill sails", () => {
  it.each([0, 1, 2, 3])("blocks intersecting roofs but permits shoulder cargo under the sweep, turn %i", rotation => {
    const building = { typeId: 31, x: 30.5, y: 0, z: 30, rotation };
    const sizing = getRomanBuildingWorldSizing(getBuildingDefinition(31));
    const z = sizing.recipe.mechanism[2] * sizing.scale;
    const rotor=sizing.overhead[0]!,radius=rotor.radius*sizing.scale,hub=rotor.center[1]*sizing.scale;
    expect(buildingOverheadIntersectsBox(building, quarterBox({ min: [radius*.75, hub-.2, z-.1],
      max: [radius*.95,hub+.3,z+.1] }, rotation))).toBe(true);
    expect(buildingOverheadIntersectsBox(building, quarterBox({ min: [-.2, 0, z - .1],
      max: [.2, 1.6, z + .1] }, rotation))).toBe(false);
    // The bounding square's upper corner is not inside the circular rotor disk.
    expect(buildingOverheadIntersectsBox(building, quarterBox({ min: [radius*.9, hub+radius*.9, z-.1],
      max: [radius,hub+radius,z+.1] }, rotation))).toBe(false);
    expect(buildingOverheadIntersectsBox(building, quarterBox({ min: [2.6, 3, -2],
      max: [3, 4, -1.5] }, rotation))).toBe(false);
  });

  it("tests neighboring mill sweeps in either placement order", () => {
    const mill = { typeId: 31, x: 30.5, y: 0, z: 30, rotation: 0 };
    const neighboring = { typeId: 31, x: 35.5, y: 0, z: 30, rotation: 0 };
    expect(buildingModelsObstructRotors(mill, neighboring)).toBe(true);
    expect(buildingModelsObstructRotors(neighboring, mill)).toBe(true);
    expect(buildingModelsObstructRotors(mill, { ...neighboring, z: 26 })).toBe(false);
  });

  it("reserves only five ground cells while accepting an unobstructed placement", () => {
    const context = fixture(), mill = makeBuilding(context, 31, 30.5, 30);
    expect([mill.width, mill.depth]).toEqual([5, 4]);
    expect(placementReason(context, mill)).toBeNull();
  });

  it("rejects a contained ground plot whose rotor would extend beyond the island", () => {
    const context = fixture(), mill = makeBuilding(context, 31, 2.5, 30);
    expect(placementReason(context, mill)).toBe("Mill sails leave the island grid");
  });

  it("rejects trees outside the compact plot while leaving removed trees and low road space usable", () => {
    const context = fixture(), mill = makeBuilding(context, 31, 30.5, 30);
    const props = context.options.world.props;
    props.count = 1; props.types[0] = PROP.broadleafTree;
    props.x[0] = 33.6; props.z[0] = 30.9;
    expect(placementReason(context, mill)).toBe("Mill sails would overlap a tree outside its plot");
    props.types[0] = PROP_REMOVED;
    expect(placementReason(context, mill)).toBeNull();
  });

  it("keeps future mature crowns clear while allowing planting behind the thin rotor plane", () => {
    const mill = { typeId: 31, x: 30.5, y: 0, z: 30, rotation: 0 };
    expect(treePlantingClearsRotors([mill], 34, 0, 30.9)).toBe(false);
    expect(treePlantingClearsRotors([mill], 34, 0, 23)).toBe(true);
    expect(treePlantingClearsRotors([], 34, 0, 30.9)).toBe(true);
  });
});

it("keeps the rotor-vs-building verdict of the exhaustive box test with the broad phase", () => {
  const exhaustive = (mill: PlacedBuildingModel, other: PlacedBuildingModel) =>
    getPlacedBuildingModelBoxes(other).some((box) => buildingOverheadIntersectsBox(mill, box));
  let hits = 0, checks = 0;
  for (const typeId of [0, 17, 31, 33])
    for (let rotation = 0; rotation < 4; rotation++)
      for (let dz = -12; dz <= 12; dz += 1.5)
        for (let dx = -12; dx <= 12; dx += 1.5) {
          const mill = { typeId: 31, x: 30, y: 0, z: 30, rotation: (rotation + 1) % 4 };
          const other = { typeId, x: 30 + dx, y: 0, z: 30 + dz, rotation };
          const expected = exhaustive(mill, other) || (typeId === 31 && exhaustive(other, mill));
          expect(buildingModelsObstructRotors(mill, other)).toBe(expected);
          hits += Number(expected); checks++;
        }
  expect(hits).toBeGreaterThan(0);
  expect(hits).toBeLessThan(checks);
});
