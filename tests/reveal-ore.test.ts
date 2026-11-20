import { describe, expect, it } from "vitest";

import { prepareIslandWorld } from "../src/app/island-world-preparation";
import type { AppParams } from "../src/app/app-params";
import type { WorldData } from "../src/shared/world/world-data";

const world = () => ({
  cellsX: 4,
  cellsZ: 4,
  expeditionKind: undefined,
  fog: new Uint8Array(16),
  mineZones: [
    { id: 1, ore: 1, richness: 1, surveyed: false },
    { id: 2, ore: 2, richness: 1, surveyed: true }
  ],
  seed: 7
} as unknown as WorldData);

const params = { garden: false } as AppParams;

describe("reveal ore presentation override", () => {
  it("stores real survey flags outside the enumerable world and restores them", () => {
    const current = world();
    prepareIslandWorld(current, params, false, true);
    expect(current.mineZones.map(zone => zone.surveyed)).toEqual([true, true]);
    expect(current.surveyedBeforeReveal).toEqual([[1, false], [2, true]]);
    expect(Object.keys(current)).not.toContain("surveyedBeforeReveal");

    prepareIslandWorld(current, params, false, false);
    expect(current.mineZones.map(zone => zone.surveyed)).toEqual([false, true]);
    expect(current.surveyedBeforeReveal).toBeUndefined();
  });
});
