import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getNationBuildingDefinition } from "../src/render-common/buildings/nation-building-text";
import { PLAYER_NATIONS } from "../src/render-common/workers/worker-appearance";
import { makeBuilding, placementReason } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD } from "../src/shared/world/world-data";

const SIZE = 64;
/** Flat buildable land; the editor places with the map nation, the run with the player's nation. */
const flatContext = (nation: (typeof PLAYER_NATIONS)[number]) => ({
  buildings: [], nextBuilding: 0, occupied: new Uint8Array(SIZE ** 2), playerNation: nation,
  options: { roads: { segments: () => [] }, world: {
    blocking: new Uint8Array(SIZE ** 2), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large), cellsX: SIZE,
    cellsZ: SIZE, heights: new Float32Array((SIZE + 1) ** 2), mineZones: [],
    props: { count: 0, form: new Uint8Array(1), scale: new Float32Array([1]), types: new Uint8Array(1),
      x: new Float32Array(1), y: new Float32Array(1), z: new Float32Array(1) },
    walkCost: new Uint8Array(SIZE ** 2).fill(10)
  } }
}) as unknown as SettlementContext;

/** Everything placement and logistics read from a placed building. */
const placed = (nation: (typeof PLAYER_NATIONS)[number], typeId: number, rotation: number) => {
  const context = flatContext(nation), building = makeBuilding(context, typeId, 32, 32, rotation);
  const { access, depth, doorThreshold, hasDoor, width, workerApproach } = building;
  return { access, depth, doorThreshold, footprint: getNationBuildingDefinition(typeId, nation).gridFootprint,
    hasDoor, reason: placementReason(context, building), width, workerApproach };
};

describe("nation-swap footprint invariant (campaign plan item 43)", () => {
  it("every catalog building placed as Roman places identically as each of the 8 nations", () => {
    expect(PLAYER_NATIONS).toHaveLength(8);
    let placedAsRoman = 0;
    for (const { id } of BUILDING_CATALOG) for (const rotation of [0, 1]) {
      const roman = placed("roman", id, rotation);
      if (roman.reason === null) placedAsRoman++;
      for (const nation of PLAYER_NATIONS) expect(placed(nation, id, rotation), `${id}/${nation}`).toEqual(roman);
    }
    // Harbour, jetties and mines need water or deposits; every other type places on flat land.
    expect(placedAsRoman).toBeGreaterThan(BUILDING_CATALOG.length);
  });
});
