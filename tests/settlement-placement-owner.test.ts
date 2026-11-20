import { describe, expect, it } from "vitest";

import { constructionStockReason } from "../src/shared/settlement/construction-stock-reason";
import { localConstructionStock } from "../src/shared/settlement/settlement-local-stock";
import { validateMilitarySave } from "../src/shared/settlement/settlement-military-state";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { reconcileStorageAccess } from "../src/shared/settlement/shared-storage";
import type { WorldData } from "../src/shared/world/world-data";
import { economyScenario } from "./helpers/economy-factions";

const ENEMY = 2;

const site = (uid: number, x: number, typeId: number, militaryFaction?: number) => ({
  uid, x, z: 1, access: { x, z: 1 }, workerApproach: { x, z: 1 }, doorThreshold: { x, z: 1 }, typeId,
  construction: typeId === 29 ? 1 : 0, inventory: {}, incoming: {}, input: {}, output: {}, required: {},
  shipReserve: {}, militaryFaction
}) as unknown as SettlementBuilding;

/** A player storage (7 logs), an economy faction's storage (5 logs) and that faction's site (3 logs) on one land. */
const island = (economyFactions?: readonly number[]) => {
  const world = { blocking: new Uint8Array(21), cellsX: 7, cellsZ: 3, scenario: economyScenario(economyFactions),
    terrainRevision: 0 } as unknown as WorldData;
  const player = Object.assign(site(1, 1, 29), { inventory: { logs: 7 } });
  const enemy = Object.assign(site(2, 3, 29, ENEMY), { inventory: { logs: 5 } });
  const enemySite = Object.assign(site(3, 5, 4, ENEMY), { required: { logs: 3 } });
  const context = {
    actors: [], buildings: [player, enemy, enemySite], options: { world }
  } as unknown as SettlementContext;
  reconcileStorageAccess(context);
  return context;
};

const militarySave = () => ({
  coinsAllowed: [], combat: { arrows: [], doors: [], nextArrow: 1 }, randomState: 0, recruitTimers: [],
  soldiers: [], targets: [], trainTimers: []
});

/** EAI1b step b7: construction stock and the owned-door rule per owner; the player's path is unchanged. */
describe("placement per owner", () => {
  it("pays a site from its owner's pool and keeps an economy faction's promises out of the player's", () => {
    const context = island([ENEMY]);
    const point = { x: 2, z: 1 };
    expect(localConstructionStock(context, "logs", point)).toBe(7);
    expect(localConstructionStock(context, "logs", point, ENEMY)).toBe(2);
    expect(constructionStockReason(context, { logs: 3 }, point, (ware, at, owner) =>
      localConstructionStock(context, ware, at, owner), ENEMY)).toMatch(/Not enough/);
    expect(constructionStockReason(context, { logs: 2 }, point, (ware, at, owner) =>
      localConstructionStock(context, ware, at, owner), ENEMY)).toBeNull();
  });

  it("still counts a site of a faction without an economy against the player's pool, as before", () => {
    const context = island();
    expect(localConstructionStock(context, "logs", { x: 2, z: 1 })).toBe(4);
  });

  it("exempts a site of an economy faction from the owned-door rule only", () => {
    const owned = [site(3, 5, 4, ENEMY)];
    const economy = (faction: number) => faction === ENEMY;
    expect(validateMilitarySave(militarySave(), owned, [])).toBe("Missing owned military door");
    expect(validateMilitarySave(militarySave(), owned, [], economy)).toBeNull();
    expect(validateMilitarySave(militarySave(), [site(4, 5, 4, 0)], [], economy)).toBe("Missing owned military door");
  });
});
