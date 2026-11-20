import { describe, expect, it } from "vitest";

import { colonyExpiryAssets } from "../src/shared/settlement/colony-expiry-assets";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { catapultLocalStone } from "../src/shared/settlement/military-catapult-resupply";
import { playerHoldings } from "../src/shared/settlement/plausibility-bounds";
import { depositOneItem } from "../src/shared/settlement/settlement-handcart-ledger";
import type { SettlementBuilding, SettlementContext, SettlementHandcartTrip } from "../src/shared/settlement/settlement-types";
import { storageDispatchLimit } from "../src/shared/settlement/storage-capacity";

const site = () => ({ uid: 1, typeId: 16, construction: 1, required: {}, input: { stone: 2 }, incoming: { stone: 0 },
  inventory: {}, output: {}, catapultSupply: { ground: 2, drops: [{ x: 3, y: 0, z: 4 }],
    porter: { actor: 2, carrying: true, elapsed: 0, phase: "inbound" } } }) as unknown as SettlementBuilding;

describe("Catapult supply conservation at shared logistics boundaries", () => {
  it("counts entrance, casualty and carried stones once in holdings and colony evacuation", () => {
    const tower = site();
    const saved = { settlement: { buildings: [tower], actors: [{ uid: 2, job: "Soldier", phase: "militaryField",
      ware: "stone" }], military: { soldiers: [{ actor: 2, rank: 0, combat: { faction: 0, type: "shield", hp: 100 } }] } } };
    const game = saved as unknown as GameSaveV1;
    expect(catapultLocalStone(tower)).toBe(6);
    expect(playerHoldings(game).stone).toBe(6);
    expect(colonyExpiryAssets(game).cargo.stone).toBe(6);
    expect(colonyExpiryAssets(game).troops).toEqual([{ type: "shield", rank: 0, hp: 100 }]);
  });

  it("manual dispatch refuses the seventh stone while construction keeps its remaining material limit", () => {
    const tower = site(), context = { buildings: [tower] } as SettlementContext;
    const source = { uid: 0, typeId: 0 } as SettlementBuilding;
    expect(storageDispatchLimit(context, source, tower, "stone", 100)).toBe(0);
    tower.catapultSupply!.ground--;
    expect(storageDispatchLimit(context, source, tower, "stone", 100)).toBe(1);
    tower.incoming.stone = 1;
    expect(storageDispatchLimit(context, source, tower, "stone", 100)).toBe(0);
    tower.construction = .5; tower.required.stone = 4; tower.constructionConsumed = { stone: 1 };
    tower.input.stone = 1; tower.incoming.stone = 1;
    expect(storageDispatchLimit(context, source, tower, "stone", 100)).toBe(1);
  });

  it("cart unloading preserves a full load and reservation, then commits exactly one ground stone", () => {
    const tower = site(), context = {} as SettlementContext;
    const trip = { ware: "stone", destination: 1, delivered: 0 } as SettlementHandcartTrip;
    tower.incoming.stone = 1;
    expect(depositOneItem(context, trip, tower)).toBe(false);
    expect(trip.delivered).toBe(0); expect(tower.incoming.stone).toBe(1);
    tower.input.stone = (tower.input.stone ?? 0) - 1;
    expect(depositOneItem(context, trip, tower)).toBe(true);
    expect(tower.input.stone).toBe(1); expect(tower.catapultSupply!.ground).toBe(3);
    expect(tower.incoming.stone).toBe(0); expect(trip.delivered).toBe(1);
    expect(catapultLocalStone(tower)).toBe(6);
  });
});
