import { describe, expect, it } from "vitest";

import { buildingSoldierDetails, soldierBelongsToBuilding } from "../src/app/settlement/building-soldier-details";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";

const building = (typeId = 0, extra: Partial<SettlementBuilding> = {}) =>
  ({ uid: 10, typeId, construction: 1, ...extra }) as SettlementBuilding;
const actor = (extra: Partial<SettlementActor> = {}) =>
  ({ uid: 20, home: 10, building: 10, phase: "militaryReserve", ...extra }) as SettlementActor;
const soldier = (extra: Partial<SettlementSoldier> = {}): SettlementSoldier =>
  ({ actor: 20, rank: 1, building: -1, stationed: false,
    combat: { type: "shield", faction: 0, hp: militaryHealth("shield", 1) / 2, cooldown: 0 }, ...extra });
const simulation = (troops: SettlementSoldier[]) =>
  ({ militarySoldiers: () => troops }) as unknown as SettlementSimulation;

describe("building soldier detail ownership and equipment eligibility", () => {
  it("shows reserves only at their actual local storage, excluding hostile, dead or voyage-committed troops", () => {
    const home = building(), troop = soldier();
    expect(soldierBelongsToBuilding(home, troop, actor())).toBe(true);
    for (const other of [actor({ home: 11 }), actor({ building: 11 }), actor({ phase: "militaryField" }),
      actor({ phase: "militaryDead" }), actor({ navalOrder: 4 })])
      expect(soldierBelongsToBuilding(home, troop, other)).toBe(false);
    expect(soldierBelongsToBuilding(building(0, { militaryFaction: 1 }), troop, actor())).toBe(false);
    expect(soldierBelongsToBuilding(home, soldier({ combat: { ...troop.combat!, faction: 1 } }), actor())).toBe(false);
    expect(soldierBelongsToBuilding(home, soldier({ combat: { ...troop.combat!, hp: 0 } }), actor())).toBe(false);
  });
  it("lists assigned garrison troops as read-only identities without equipment eligibility", () => {
    const site = building(1), troop = soldier({ building: 10 });
    const travelling = actor({ phase: "assigned", home: 99 });
    expect(soldierBelongsToBuilding(site, troop, travelling)).toBe(true);
    travelling.phase = "garrison";
    const stationed = buildingSoldierDetails(simulation([troop]), site, new Map([[20, travelling]]))!;
    expect(stationed[0]).toEqual({
      actor: 20, health: 75, maximumHealth: 150, phase: "garrison", rank: 1, type: "shield"
    });
    expect(soldierBelongsToBuilding(building(1, { uid: 11 }), troop, travelling)).toBe(false);
  });
  it("reports individual fixed type, rank and current/maximum HP without mutating simulation", () => {
    const troop = soldier(), source = structuredClone(troop);
    const details = buildingSoldierDetails(simulation([troop]), building(), new Map([[20, actor()]]))!;
    expect(details[0]).toMatchObject({ actor: 20, rank: 1, type: "shield", phase: "militaryReserve" });
    expect(details[0]?.health).toBe(Math.floor(troop.combat!.hp));
    expect(details[0]?.maximumHealth).toBe(Math.ceil(militaryHealth("shield", 1)));
    expect(troop).toEqual(source);
    expect(buildingSoldierDetails(simulation([troop]), building(33), new Map([[20, actor()]]))).toBeUndefined();
    expect(buildingSoldierDetails(simulation([troop]), building(0, { construction: .5 }), new Map([[20, actor()]]))).toBeUndefined();
  });
  it("never rounds a wounded fractional-health soldier up to full", () => {
    const maximum = militaryHealth("archer", 1), troop = soldier({ rank: 1,
      combat: { type: "archer", faction: 0, hp: maximum, cooldown: 0 } });
    const full = buildingSoldierDetails(simulation([troop]), building(), new Map([[20, actor()]]))!;
    expect(full[0]).toMatchObject({ health: Math.ceil(maximum), maximumHealth: Math.ceil(maximum) });
    troop.combat!.hp = maximum - .1;
    const wounded = buildingSoldierDetails(simulation([troop]), building(), new Map([[20, actor()]]))!;
    expect(wounded[0]!.health).toBeLessThan(wounded[0]!.maximumHealth);
  });
});
