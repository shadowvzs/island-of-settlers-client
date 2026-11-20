import { describe, expect, it } from "vitest";

import { homeStorage } from "../src/shared/settlement/colony-economy";
import {
  findHomeBuilding, findOwnHeadquarters, homeUid, isDemolitionProtected, isHomeBuilding, isOwnHeadquarters
} from "../src/shared/settlement/settlement-home";
import { homePoolSources } from "../src/shared/settlement/shared-storage-ware-sources";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { mannedFixture } from "./helpers/military-assault-fixture";

/**
 * BD1 (plan review B1, owner Q-BD2): an enemy headquarters reuses type 0 with an enemy faction, so every
 * home lookup is faction-aware. An enemy HQ never becomes the player's home, storage or territory source.
 */
const building = (uid: number, typeId: number, extra: Partial<SettlementBuilding> = {}) => ({
  access: { x: uid, z: 1 }, construction: 1, depth: 3, input: {}, inventory: {}, output: {}, typeId, uid,
  width: 3, x: uid, z: 0, ...extra
}) as unknown as SettlementBuilding;

describe("faction-aware home helpers", () => {
  const enemyHq = building(1, 0, { militaryFaction: 1 });
  const ownHq = building(2, 0);
  const colonyHarbour = building(3, 39, { colonyHome: true });

  it("tells the player's headquarters from an enemy one", () => {
    expect(isOwnHeadquarters(ownHq)).toBe(true);
    expect(isOwnHeadquarters(enemyHq)).toBe(false);
    expect(isHomeBuilding(enemyHq)).toBe(false);
    expect(isHomeBuilding(colonyHarbour)).toBe(true);
    expect(isHomeBuilding({ ...colonyHarbour, militaryFaction: 2 })).toBe(false);
    expect(isDemolitionProtected(enemyHq)).toBe(false);
  });

  it("finds the player's home even when an enemy HQ comes first", () => {
    const context = { buildings: [enemyHq, ownHq] };
    expect(findHomeBuilding(context)?.uid).toBe(2);
    expect(findOwnHeadquarters(context)?.uid).toBe(2);
    expect(homeUid({ buildings: [enemyHq, colonyHarbour] })).toBe(3);
    expect(homeUid({ buildings: [enemyHq] })).toBe(-1);
  });

  it("never spends or credits the enemy HQ's stock as the home pool", () => {
    expect(homeStorage([enemyHq, ownHq])?.uid).toBe(2);
    expect(homePoolSources([{ ...enemyHq, storagePoolId: 7 }, { ...ownHq, storagePoolId: 8 }])
      .map(source => source.storagePoolId)).toEqual([8]);
  });

  it("keeps the player's territory, home and island role with an enemy HQ on the island", () => {
    const { sim } = mannedFixture(1);
    const ownTerritory = sim.territory().sources.map(source => source.uid);
    const saved = sim.saveState();
    const hq = saved.buildings.find(entry => entry.uid === sim.headquarters.uid)!;
    const enemy = { ...structuredClone(hq), access: { x: 50, z: 52 }, doorThreshold: { x: 50, z: 51.5 },
      handcarts: 0, idleSettlers: 0, inventory: {}, militaryFaction: 1, storagePoolId: undefined, uid: saved.nextBuilding, x: 50,
      z: 50 };
    saved.nextBuilding++;
    saved.buildings.unshift(enemy);
    saved.military!.combat!.doors.push({ building: enemy.uid, faction: 1, hp: 200, maximum: 200 });
    const loaded = sim.loadState(saved);
    expect(loaded, JSON.stringify(loaded)).toEqual({ ok: true });
    expect(sim.islandRole()).toBe("home");
    expect(sim.headquarters.uid).toBe(hq.uid);
    expect(sim.territory().sources.map(source => source.uid)).toEqual(ownTerritory);
  });
});
