import { describe, expect, it, vi } from "vitest";

import { applyPaidNationChange } from "../src/app/settings/customization/nation-change";
import { createPlayerSession } from "../src/app/settlement/player-session";
import { getGemShopOfferCards } from "../src/app/settlement-ui/gem-shop/helpers";
import { GEM_SHOP_CATEGORIES } from "../src/shared/progression/gem-shop";
import { CHOOSE_NATION_OFFER_ID, consumeChooseNation, purchaseChooseNation } from "../src/shared/progression/player-inventory";
import { createPlayerProgress, validatePlayerProgress } from "../src/shared/progression/player-progress";

const progress = () => ({ ...createPlayerProgress(1), gems: 200 });

describe("personal inventory", () => {
  it("buys exactly one, saves it, consumes once on a changed nation, and allows rebuy", () => {
    const original = progress(), bought = purchaseChooseNation(original);
    expect(bought.ok).toBe(true);
    if (!bought.ok) throw new Error("Purchase failed");
    expect(original.gems).toBe(200);
    expect(bought.progress).toMatchObject({ gems:100,inventory:{ chooseNation:1 } });
    expect(validatePlayerProgress(JSON.parse(JSON.stringify(bought.progress)))).toBe(true);
    expect(purchaseChooseNation(bought.progress).ok).toBe(false);
    expect(consumeChooseNation(bought.progress,"roman","roman")).toBe(bought.progress);
    const consumed = consumeChooseNation(bought.progress,"roman","persian")!;
    expect(consumed.inventory).toEqual({});
    expect(consumeChooseNation(consumed,"roman","persian")).toBeNull();
    expect(purchaseChooseNation(consumed)).toMatchObject({ ok:true,progress:{ gems:0,inventory:{ chooseNation:1 } } });
    expect(purchaseChooseNation({ ...original,gems:99 }).ok).toBe(false);
    for (const inventory of [{ chooseNation:2 },{ unknown:1 },[],null])
      expect(validatePlayerProgress({ ...original,inventory })).toBe(false);
  });

  it("needs no warehouse room, publishes inventory changes and never credits an item as a ware", async () => {
    const session = createPlayerSession({ initial:progress(),seed:1,now:()=>Date.UTC(2026,10,3) });
    const changed = vi.fn(); session.subscribeInventory(changed);
    expect(session.buyGemOffer(CHOOSE_NATION_OFFER_ID)).toBe(true);
    expect(session.progress()).toMatchObject({ gems:100,inventory:{ chooseNation:1 } });
    expect(changed).toHaveBeenCalledOnce();
    expect(await session.changeNation("roman","roman")).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    expect(await session.changeNation("roman","maya")).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(session.progress().inventory).toEqual({});
    expect(session.buyGemOffer(CHOOSE_NATION_OFFER_ID)).toBe(true);
    session.dispose();
  });

  it("shows the100gem Items offer and disables duplicate ownership", () => {
    const category = GEM_SHOP_CATEGORIES.findIndex(item=>item.id==="items");
    expect(getGemShopOfferCards(category,{ gems:100,level:1 })[0]).toMatchObject({
      id:CHOOSE_NATION_OFFER_ID,price:"100",disabled:false,item:"chooseNation"
    });
    expect(getGemShopOfferCards(category,{ gems:100,level:1,inventory:{ chooseNation:1 } })[0]!.disabled).toBe(true);
  });
});

describe("paid nation preparation", () => {
  const setup = () => {
    const prepared = { commit:vi.fn(()=>true),dispose:vi.fn() };
    const options = { apply:vi.fn(),consume:vi.fn(async()=>true as const),current:"roman" as const,
      hasItem:()=>true,next:"persian" as const,prepare:vi.fn(async()=>prepared),validate:()=>true };
    return { options,prepared };
  };
  it("prepares and validates before consuming, then applies exactly once", async () => {
    const { options,prepared } = setup();
    await applyPaidNationChange(options);
    expect(options.prepare.mock.invocationCallOrder[0]).toBeLessThan(options.consume.mock.invocationCallOrder[0]!);
    expect(options.consume).toHaveBeenCalledOnce();
    expect(prepared.commit).toHaveBeenCalledOnce(); expect(options.apply).toHaveBeenCalledOnce();
    expect(prepared.dispose).toHaveBeenCalledOnce();
  });
  it("keeps the item on no-op, missing item, invalid state, failed assets or rejected server request", async () => {
    const same = setup(); await applyPaidNationChange({ ...same.options,next:"roman" });
    expect(same.options.consume).not.toHaveBeenCalled();
    for (const changes of [{ hasItem:()=>false },{ validate:()=>false },{ prepare:async()=>null },
      { prepare:async()=>{ throw new Error("asset offline"); } }]) {
      const { options } = setup();
      await expect(applyPaidNationChange({ ...options,...changes })).rejects.toThrow(/item|required|replacement|offline/);
      expect(options.consume).not.toHaveBeenCalled();
    }
    const refused = setup();
    await expect(applyPaidNationChange({ ...refused.options,consume:async()=>"refused" })).rejects.toThrow("refused");
    expect(refused.prepared.commit).not.toHaveBeenCalled(); expect(refused.options.apply).not.toHaveBeenCalled();
    expect(refused.prepared.dispose).toHaveBeenCalledOnce();
  });
  it("disposes stale preparations before payment and reports confirmed recovery after payment", async () => {
    const stale = setup();
    const validate = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(applyPaidNationChange({ ...stale.options, validate })).rejects.toThrow("Nation replacement failed");
    expect(stale.options.consume).not.toHaveBeenCalled();
    expect(stale.prepared.dispose).toHaveBeenCalledOnce();
    for (const commitFails of [false, true]) {
      const paid = setup();
      const afterReceipt = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(commitFails);
      paid.prepared.commit.mockReturnValue(false);
      await expect(applyPaidNationChange({ ...paid.options, validate:afterReceipt }))
        .rejects.toThrow("Nation change confirmed; reload to finish");
      expect(paid.options.consume).toHaveBeenCalledOnce();
      expect(paid.options.apply).not.toHaveBeenCalled();
      expect(paid.prepared.commit).toHaveBeenCalledTimes(Number(commitFails));
      expect(paid.prepared.dispose).toHaveBeenCalledOnce();
    }
  });
});
