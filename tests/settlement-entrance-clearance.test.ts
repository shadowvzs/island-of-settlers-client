import { expect, it } from "vitest";

import { buildingEntrancesObstructModels, getPlacedBuildingEntranceBounds } from "../src/render-common/buildings/building-model-clearance";
import { entranceClearancePlacementReason } from "../src/shared/settlement/settlement-building-entrance-clearance";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
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

it.each([1, 20].flatMap(typeId => [0,1,2,3].map(rotation => ({ typeId, rotation }))))(
  "building $typeId rotated $rotation rejects road ribbons through its door and leaves its real junction clear",
  ({ rotation, typeId }) => {
    const context = fixture(), building = makeBuilding(context, typeId, 32, 32, rotation);
    expect(entranceClearancePlacementReason(context, building)).toBeNull();
    const sweep = getPlacedBuildingEntranceBounds(building)[0]!;
    const tangent = { x: Math.round(Math.cos(rotation * Math.PI / 2)),
      z: -Math.round(Math.sin(rotation * Math.PI / 2)) };
    const crossRoad = (point: {x:number;z:number}) => [{
      start: { x: point.x - tangent.x * 2, z: point.z - tangent.z * 2 },
      end: { x: point.x + tangent.x * 2, z: point.z + tangent.z * 2 }, tier: "dirt" as const
    }];
    context.options.roads.segments = () => crossRoad({x:(sweep.min[0]+sweep.max[0])/2,
      z:(sweep.min[2]+sweep.max[2])/2});
    expect(entranceClearancePlacementReason(context, building)).toBe("Door swing would overlap an existing road");
    context.options.roads.segments = () => crossRoad(building.access);
    expect(entranceClearancePlacementReason(context, building)).toBeNull();
  });

it.each([1, 20])("building %i protects its open doorway from present and future tree crowns", typeId => {
  const context = fixture(), building = makeBuilding(context, typeId, 32, 32);
  const props = context.options.world.props;
  props.count = 1; props.types[0] = PROP.broadleafTree; props.x[0] = 31.5; props.z[0] = 34.6;
  expect(entranceClearancePlacementReason(context, building)).toBe("Door swing would overlap a tree outside its plot");
  expect(treePlantingClearsRotors([building], 31.5, 0, 34.6)).toBe(false);
  props.types[0] = PROP_REMOVED;
  expect(entranceClearancePlacementReason(context, building)).toBeNull();
  expect(treePlantingClearsRotors([building], 32, 0, 24)).toBe(true);
});

it("checks actual neighboring models in both placement orders", () => {
  const cottage = { typeId: 20, x: 32, y: 0, z: 32, rotation: 0 };
  const neighbor = { typeId: 17, x: 31.5, y: 0, z: 34, rotation: 0 };
  expect(buildingEntrancesObstructModels(cottage, neighbor)).toBe(true);
  expect(buildingEntrancesObstructModels(neighbor, cottage)).toBe(true);
  expect(buildingEntrancesObstructModels(cottage, { ...neighbor, z: 39 })).toBe(false);
});
