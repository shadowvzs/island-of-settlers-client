import { describe, expect, it, vi } from "vitest";

import type { EconomyClient } from "../src/app/cloud/economy-client";
import { createServerEconomy } from "../src/app/cloud/server-economy";
import { SaveApiError } from "../src/app/save-store/save-api-client";
import { createPlayerSession } from "../src/app/settlement/player-session";
import { createPlayerProgress } from "../src/shared/progression/player-progress";

const storage = () => {
  const values = new Map<string,string>();
  return { getItem:(key:string)=>values.get(key)??null,removeItem:(key:string)=>{ values.delete(key); },
    setItem:(key:string,value:string)=>{ values.set(key,value); },values };
};
const create = (client: Partial<EconomyClient>, pendingStorage = storage(), extra = {}) =>
  createServerEconomy({ client:client as EconomyClient,newKey:vi.fn(()=>"inventory-request-123"),
    pendingStorage,scope:"account",startGems:200,startInventory:{ chooseNation:1 },...extra });

describe("authoritative personal inventory recovery", () => {
  it("retries a lost purchase reply with the same idempotency key", async () => {
    const pending = storage(), buy = vi.fn().mockRejectedValueOnce(new SaveApiError(0,"NETWORK","lost reply"))
      .mockResolvedValueOnce({ goods:{},ok:true,wallet:{ gems:100,items:{ chooseNation:1 } } });
    const economy = create({ buyGemOffer:buy },pending);
    expect(await economy.buyGemOffer("choose-nation")).toMatchObject({ ok:true,gems:100,items:{ chooseNation:1 } });
    expect(buy.mock.calls).toEqual([
      ["choose-nation","inventory-request-123",undefined],
      ["choose-nation","inventory-request-123",undefined]
    ]);
    expect(pending.values.size).toBe(0);
  });

  it("retains the existing Choose nation purchase key across an update", async () => {
    const pending=storage();
    pending.setItem("island-of-settlers.inventory-request:account:purchase",JSON.stringify({
      body:"choose-nation",key:"purchase-before-update"
    }));
    const buy=vi.fn(async()=>({ goods:{},ok:true as const,wallet:{ gems:100,items:{ chooseNation:1 } } }));
    expect(await create({ buyGemOffer:buy },pending).buyGemOffer("choose-nation")).toMatchObject({ ok:true });
    expect(buy).toHaveBeenCalledWith("choose-nation","purchase-before-update",undefined);
    expect(pending.values.size).toBe(0);
  });

  it("retains local item while offline, persists its operation, and consumes only after confirmed retry", async () => {
    const pending = storage(), change = vi.fn().mockRejectedValue(new SaveApiError(0,"NETWORK","offline"));
    const economy = create({ changeNation:change },pending);
    const session = createPlayerSession({ economy,initial:createPlayerProgress(1),seed:1,now:()=>Date.UTC(2026,10,3) });
    await expect(session.changeNation("roman","persian")).rejects.toThrow("awaiting server confirmation");
    expect(session.progress().inventory).toEqual({ chooseNation:1 });
    expect(pending.values.size).toBe(1);
    change.mockResolvedValue({ changed:true,nation:"persian",ok:true,wallet:{ gems:200,items:{},chosenNation:"persian" } });
    expect(await session.changeNation("roman","persian")).toBe(true);
    expect(session.progress().inventory).toEqual({});
    expect(change.mock.calls.every(call=>call[2]==="inventory-request-123")).toBe(true);
    expect(pending.values.size).toBe(0);
    session.dispose();
  });

  it("reconciles a committed operation after reload and never trusts items from a local save", () => {
    const pending = storage();
    pending.setItem("island-of-settlers.inventory-request:account:nation",JSON.stringify({
      body:JSON.stringify({ currentNation:"roman",nation:"persian" }),key:"old-request"
    }));
    const economy = create({},pending,{ startInventory:{},startNation:"persian" });
    expect(pending.values.size).toBe(0);
    const session = createPlayerSession({ economy,initial:{ ...createPlayerProgress(1),inventory:{ chooseNation:1 } },
      seed:1,now:()=>Date.UTC(2026,10,3) });
    expect(session.progress().inventory).toEqual({});
    session.dispose();
  });

  it("preserves a token on explicit refusal and never sends same-nation no-ops", async () => {
    const change = vi.fn(async()=>({ ok:false as const,reason:"entrance busy" }));
    const economy = create({ changeNation:change });
    const session = createPlayerSession({ economy,seed:1,now:()=>Date.UTC(2026,10,3) });
    expect(await session.changeNation("roman","roman")).toBe(true);
    expect(change).not.toHaveBeenCalled();
    expect(await session.changeNation("roman","persian")).toBe("entrance busy");
    expect(session.progress().inventory).toEqual({ chooseNation:1 });
    session.dispose();
  });
});
