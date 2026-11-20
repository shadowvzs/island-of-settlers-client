import { describe, expect, it } from "vitest";

import { createBuildingDemolitionFrames } from "../src/app/settlement/building-demolition-frames";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";

const building = { uid: 3, typeId: 32, construction: 1, x: 10, y: 1, z: 20,
  width: 4, depth: 4, rotation: 1 } as SettlementBuilding;

describe("building burn-down visual lifecycle", () => {
  it("keeps a completed building for the entire burn interval and then shows its ruins", () => {
    const effects = createBuildingDemolitionFrames(); effects.start(building, "roman");
    const frame = effects.update(14.9, [])[0]!;
    expect(frame.demolitionAge).toBeCloseTo(14.9);
    expect(frame.rotation).toBeCloseTo(Math.PI / 2);
    expect(effects.update(.2, [])).toHaveLength(1);
    expect(effects.update(14.8, [])).toHaveLength(1);
    expect(effects.update(.2, [])).toEqual([]);
    expect(building).not.toHaveProperty("demolitionAge");
  });
  it("does not burn an unfinished site or overlay replacement construction", () => {
    const effects = createBuildingDemolitionFrames();
    effects.start({ ...building, construction: .99 }, "roman");
    expect(effects.update(1, [])).toEqual([]);
    effects.start(building, "roman");
    expect(effects.update(.1, [{ ...building, uid: 4, construction: 0 }])).toEqual([]);
  });
  it("is cleared in a new session and does not create stock or crew", () => {
    const effects = createBuildingDemolitionFrames(); effects.start(building, "viking");
    const frame = effects.update(1, [])[0]!;
    expect(frame.inputStock).toEqual({}); expect(frame.outputStock).toEqual({});
    expect(frame.nation).toBe("viking");
    expect(createBuildingDemolitionFrames().update(1, [])).toEqual([]);
  });
});
