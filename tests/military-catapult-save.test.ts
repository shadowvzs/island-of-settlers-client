import { describe, expect, it } from "vitest";

import { CATAPULT_PHASE_SECONDS } from "../src/shared/settlement/catapult-cycle";
import { validateMilitarySave } from "../src/shared/settlement/settlement-military-state";
import { validateSavedBuildings } from "../src/shared/settlement/settlement-save-buildings";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";

const tower = () => ({
  uid: 1, typeId: 16, x: 10, y: 0, z: 10, width: 5, depth: 5, rotation: 0,
  construction: 1, working: false, selected: false, cycle: 0, door: 0, hasDoor: true, status: "",
  access: { x: 10, z: 13 }, workerApproach: { x: 10, z: 12 }, doorThreshold: { x: 10, z: 12 },
  accepts: {}, input: { stone: 3 }, incoming: { stone: 2 }, inventory: {}, output: {}, required: {},
  catapultReload: 4,
  catapultCycle: { operator: 2, target: 3, phase: "load", elapsed: .2 }
});
const validate = (building: unknown) => validateSavedBuildings([building],
  { cellsX: 40, cellsZ: 40 } as SettlementContext["options"]["world"], new Set(), 0);

describe("saved Catapult supplies and actions", () => {
  it("preserves a bounded in-progress action and a six-stone store including incoming reservations", () => {
    expect(validate(tower())).toBeNull();
    const site = tower();
    site.input.stone = 4;
    expect(validate(site)).toBeNull();
    site.incoming.stone++;
    expect(validate(site)).toBe("Invalid catapult supply or action");
  });

  it("rejects unsupported ammunition, malformed phases and misplaced action state", () => {
    for (const change of [
      (site: ReturnType<typeof tower>) => { Object.assign(site.input, { coins: 1 }); },
      (site: ReturnType<typeof tower>) => { Object.assign(site.incoming, { beer: 1 }); },
      (site: ReturnType<typeof tower>) => { site.catapultCycle.phase = "unknown"; },
      (site: ReturnType<typeof tower>) => { site.catapultCycle.elapsed = CATAPULT_PHASE_SECONDS.load + .01; },
      (site: ReturnType<typeof tower>) => { site.catapultCycle.operator = -1; },
      (site: ReturnType<typeof tower>) => { Object.assign(site.catapultCycle, { stoneSlot: 6 }); },
      (site: ReturnType<typeof tower>) => { site.catapultReload = 5.1; },
      (site: ReturnType<typeof tower>) => { site.typeId = 4; },
      (site: ReturnType<typeof tower>) => { site.construction = .5; }
    ]) {
      const site = tower();
      change(site);
      expect(validate(site)).toBe("Invalid catapult supply or action");
    }
  });

  it("preserves elapsed manual traverse and park without allowing non-finite or unbounded turn speed", () => {
    for (const phase of ["traverse", "park"]) {
      const site = tower(); site.catapultCycle.phase = phase; site.catapultCycle.elapsed = 3;
      Object.assign(site.catapultCycle, { turnVelocity: .5 });
      expect(validate(site)).toBeNull();
      Object.assign(site.catapultCycle, { turnVelocity: Infinity });
      expect(validate(site)).toBe("Invalid catapult supply or action");
      Object.assign(site.catapultCycle, { turnVelocity: 1_000 });
      expect(validate(site)).toBe("Invalid catapult supply or action");
    }
  });

  it("validates optional boulder diameter without requiring its already destroyed tower or shooter", () => {
    const boulder: { target: number; x: number; y: number; z: number; diameter?: number } = {
      target: 3, x: 8, y: 0, z: 4, diameter: .3
    };
    const saved = { randomState: 0, soldiers: [], targets: [], coinsAllowed: [], recruitTimers: [], trainTimers: [],
      combat: { doors: [], nextArrow: 1, arrows: [{ id: 0, shooter: 2, building: 99, faction: 0, rank: 0,
        x: 4, y: 2, z: 4, vx: 1, vy: 1, vz: 1, age: .5, boulder }] } };
    expect(validateMilitarySave(saved, [], [])).toBeNull();
    for (const diameter of [0, -.1, 1.01, NaN, Infinity]) {
      boulder.diameter = diameter;
      expect(validateMilitarySave(saved, [], [])).toBe("Invalid catapult boulder");
    }
    delete boulder.diameter;
    expect(validateMilitarySave(saved, [], [])).toBeNull();
  });

  it("allows construction materials before completion and empty consumed-material entries afterward", () => {
    const site = tower();
    const { catapultCycle: _cycle, catapultReload: _reload, ...unfinished } = site;
    unfinished.construction = .5;
    Object.assign(unfinished.input, { planks: 3 });
    expect(validate(unfinished)).toBeNull();
    Object.assign(site.input, { planks: 0 });
    expect(validate(site)).toBeNull();
  });
});
