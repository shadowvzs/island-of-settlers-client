import { describe, expect, it } from "vitest";

import { validPlayerInventory } from "../../island-of-settlers-shared/src/player-inventory";
import { consumePersonalItem, purchasePersonalItem } from "../src/shared/progression/personal-item-purchase";
import { createPlayerProgress } from "../src/shared/progression/player-progress";

describe("independent personal item limits",()=>{
  it("buys recovery while holding nation, refuses its own duplicate and allows rebuy after consumption",()=>{
    const start={ ...createPlayerProgress(1),gems:200,inventory:{ chooseNation:1 } };
    const before=structuredClone(start);
    const bought=purchasePersonalItem(start,"commanderRecovery");
    expect(bought.ok).toBe(true);if (!bought.ok) throw new Error(bought.reason);
    expect(bought.progress).toMatchObject({ gems:150,inventory:{ chooseNation:1,commanderRecovery:1 } });
    expect(start).toEqual(before);
    expect(purchasePersonalItem(bought.progress,"commanderRecovery").ok).toBe(false);
    const used=consumePersonalItem(bought.progress,"commanderRecovery")!;
    expect(used.inventory).toEqual({ chooseNation:1 });
    expect(used.gems).toBe(150);
    expect(purchasePersonalItem(used,"commanderRecovery").ok).toBe(true);
    expect(consumePersonalItem(used,"commanderRecovery")).toBeNull();
  });
  it("rejects unaffordable purchases and forged counts without mutation",()=>{
    const poor={ ...createPlayerProgress(1),gems:49 };
    expect(purchasePersonalItem(poor,"commanderRecovery")).toEqual({ ok:false,reason:"Needs 1 more gems" });
    expect(poor.gems).toBe(49);
    expect(validPlayerInventory({ chooseNation:1,commanderRecovery:1 })).toBe(true);
    for (const inventory of [{ chooseNation:2 },{ commanderRecovery:2 },{ commanderRecovery:0 },{ bogus:1 }])
      expect(validPlayerInventory(inventory)).toBe(false);
  });
});
