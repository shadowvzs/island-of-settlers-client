import { describe, expect, it } from "vitest";

import { CATAPULT_PREPARE_SECONDS } from "../src/shared/settlement/catapult-cycle";
import { CATAPULT, CATAPULT_BASE_RANGE, catapultTarget, fireCatapultTowers, sweepCatapultBoulder } from "../src/shared/settlement/military-catapult";
import { garrisonDefenderPriority, isValidComposition, nextGarrisonTroop } from "../src/shared/settlement/military-garrison-rules";
import type { MilitaryArrow } from "../src/shared/settlement/military-projectiles";
import { createCombatCasualties } from "../src/shared/settlement/settlement-combat-core";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import { militarySupplyDemand } from "../src/shared/settlement/settlement-military-supplies";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

const tower = () => ({ uid: 1, typeId: 16, x: 4, y: 0, z: 4, width: 2, depth: 2, rotation: 0,
  construction: 1, input: { stone: 6 }, incoming: {} }) as unknown as SettlementBuilding;
const heavy = () => ({ actor: 2, building: 1, rank: 0, stationed: true,
  combat: { type: "heavy", hp: 100, faction: 0, cooldown: 0 } }) as SettlementSoldier;
const enemy = (x = 8) => ({ uid: 3, x, y: 0, z: 4, visible: true,
  phase: "militaryField" }) as SettlementActor;
const arrow = (): MilitaryArrow => ({ id: 1, shooter: 2, rank: 0, faction: 0,
  x: 4, y: 2, z: 4, vx: 4 / 1.5, vy: (0 - 2 + .5 * 9.8 * 1.5 ** 2) / 1.5,
  vz: 0, age: 0, boulder: { target: 3, x: 8, y: 0, z: 4 } });

describe("Catapult Tower", () => {
  it("kills commanders through authoritative casualty handling without a dodge or incapacitation", () => {
    const victim = { ...heavy(), actor: 3, commanderId: "enemy-commander" };
    let removed = false, incapacitated = false;
    const deaths: unknown[] = [];
    const deps = { actorById: () => enemy(), context: { options: {}, commander: { incapacitate: () => {
      incapacitated = true; return true;
    }, recordDeath: () => {} } }, deaths, initialize: (soldier: SettlementSoldier) => soldier.combat!,
      removeSoldier: () => { removed = true; } } as unknown as Parameters<typeof createCombatCasualties>[0];
    createCombatCasualties(deps).hit(heavy(), victim, true, false, 1, true, true);
    expect(victim.combat!.hp).toBe(0); expect(removed).toBe(true);
    expect(incapacitated).toBe(false); expect(deaths).toHaveLength(1);
  });
  it("lands at its fixed point and delegates all enemy area damage to the impact resolver", () => {
    const shot = arrow(); expect(sweepCatapultBoulder(shot, 1.5).stopped).toBe(true);
    expect(shot).toMatchObject({ x: 8, y: 0, z: 4 });
  });
  it("continues independently of its shooter and restores identically mid-flight", () => {
    const shot = arrow(); sweepCatapultBoulder(shot, .6);
    const restored = structuredClone(shot);
    expect(sweepCatapultBoulder(shot, .9)).toEqual(sweepCatapultBoulder(restored, .9));
    expect(restored).toEqual(shot); expect(shot.x).toBe(8);
  });
  it("keeps a landed boulder for three seconds, then sinks and removes it", () => {
    const shot = arrow();
    expect(sweepCatapultBoulder(shot, 1.5).stopped).toBe(true);
    expect(shot.boulder?.restAge).toBe(0);
    expect(sweepCatapultBoulder(shot, 3).removed).toBe(false);
    expect(sweepCatapultBoulder(shot, 1.49).removed).toBe(false);
    expect(sweepCatapultBoulder(shot, .02).removed).toBe(true);
  });

  it("spends one roof stone only at launch and preserves the five-second minimum while crew work takes longer", () => {
    const building = tower(), operator = heavy(), target = enemy();
    const foe = { ...heavy(), actor: 3, building: -3, stationed: false,
      combat: { ...heavy().combat!, faction: 1 } };
    const soldiers = new Map([[2, operator], [3, foe]]);
    const context = { buildings: [building], options: { world: { cellsX: 16, cellsZ: 16,
      heights: new Float32Array(17 * 17) } } } as unknown as SettlementContext;
    const launched: Omit<MilitaryArrow, "id">[] = [];
    const shotTimes: number[] = []; let time = 0;
    const update = (dt = .05) => {
      time += dt;
      fireCatapultTowers(context, soldiers, [target], dt, shot => { launched.push(shot); shotTimes.push(time); });
    };
    const advance = (seconds: number) => { for (let tick = 0; tick < Math.round(seconds * 20); tick++) update(.05); };
    const awaitShots = (count: number) => {
      for (let tick = 0; tick < 800 && launched.length < count; tick++) update();
      expect(launched).toHaveLength(count);
    };
    advance(1); expect(launched).toHaveLength(0); expect(building.input.stone).toBe(6);
    expect(building.catapultCycle?.phase).toBe("pick");
    advance(CATAPULT_PREPARE_SECONDS - 1 - .1);
    expect(launched).toHaveLength(0); expect(building.input.stone).toBe(6);
    awaitShots(1); expect(building.input.stone).toBe(5);
    expect(building.catapultReload).toBe(CATAPULT.reload);
    operator.combat!.cooldown = 999;
    advance(4.9); expect(launched).toHaveLength(1);
    awaitShots(2);
    expect(shotTimes[1]! - shotTimes[0]!).toBeGreaterThanOrEqual(CATAPULT.reload - 1e-8);
    for (let tick = 0; tick < 800 && building.catapultCycle?.phase !== "load"; tick++) update();
    expect(building.catapultCycle?.phase).toBe("load");
    target.x = 5.2; advance(.1); expect(building.catapultCycle?.ammo).toBe("loose");
    expect(building.input.stone).toBe(4); expect(launched).toHaveLength(2);
    target.x = 8; awaitShots(3);
    building.input.stone = 0; advance(30); expect(launched).toHaveLength(3);
    building.input.stone = 6; operator.stationed = false; advance(30); expect(launched).toHaveLength(3);
  });
  it("requests only stone and forbids archers", () => {
    const building = tower(); building.input.stone = 1; building.incoming.stone = 2;
    expect(militarySupplyDemand(building, [], true, "beer")).toEqual({ coins: 0, drink: 0, drinkWare: "beer", stone: 3 });
    expect(isValidComposition(16, { archer: 1, heavy: 1, shield: 1 })).toBe(false);
    expect(nextGarrisonTroop(16, { archer: 0, heavy: 0, shield: 0 }, undefined, () => true)).toBe("heavy");
  });
  it("takes the heavy operator off the engine before optional shield defenders", () => {
    expect(garrisonDefenderPriority(16, "heavy")).toBeLessThan(garrisonDefenderPriority(16, "shield"));
    expect(garrisonDefenderPriority(4, "heavy")).toBe(garrisonDefenderPriority(4, "shield"));
  });
  it("uses a round ten-tile base range, including exact boundaries", () => {
    expect(CATAPULT_BASE_RANGE).toBe(10);
    expect(CATAPULT.range).toBe(CATAPULT_BASE_RANGE);
    const site = tower();
    const target = (distance: number) => ({ ...enemy(site.x + distance), soldier: heavy() });
    expect(catapultTarget(site, [target(CATAPULT.range)], () => true)).toBeDefined();
    expect(catapultTarget(site, [target(CATAPULT.range + .0001)], () => true)).toBeUndefined();
    expect(catapultTarget(site, [target(CATAPULT.minimumRange)], () => true)).toBeDefined();
    expect(catapultTarget(site, [target(CATAPULT.minimumRange - .0001)], () => true)).toBeUndefined();
  });
  it("scales the target range by the loaded kind", () => {
    const target = (distance: number) => ({ ...enemy(4 + distance), soldier: heavy() });
    const withKind = (kind: "basalt" | "granite" | "limestone" | "marble") => {
      const site = tower(); site.input = {}; site.catapultAmmo = kind; return site;
    };
    for (const [kind, range] of [["basalt", 8], ["limestone", 13], ["marble", 10], ["granite", 10]] as const) {
      const site = withKind(kind);
      expect(catapultTarget(site, [target(range)], () => true)).toBeDefined();
      expect(catapultTarget(site, [target(range + .0001)], () => true)).toBeUndefined();
    }
  });

  it("selects the nearest visible enemy within range", () => {
    const candidates = [enemy(8), enemy(6), enemy(10)].map(body => ({ ...body, soldier: heavy() }));
    expect(catapultTarget(tower(), candidates, () => true)?.x).toBe(6);
    expect(catapultTarget(tower(), candidates, body => body.x !== 6)?.x).toBe(8);
  });
});
