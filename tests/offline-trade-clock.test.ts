import { TRADE_OFFER_LIFETIME_MS } from "@shared/catalog/balance";
import { beforeAll, describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { tradePaidCustody } from "../src/shared/trade/trade-custody";
import { createTradeState } from "../src/shared/trade/trade-ledger";
import { lateStockSave } from "./helpers/offline-measured-islands";

let source: GameSaveV1;
beforeAll(async () => {
  source = await lateStockSave();
  for (const building of source.settlement.buildings) building.productionPaused = true;
});
const offered = (fillAt: number | null = null) => {
  const save = structuredClone(source), home = save.settlement.buildings[0]!;
  const pool = save.settlement.storagePools.pools.find(entry => entry.id === home.storagePoolId)!;
  pool.available.planks = 7;
  const state = createTradeState();
  state.nextId = 3; state.elapsed = 100; state.buyerClock = 100;
  state.offers.push({ id: "o1", escrowId: "e2", give: { ware: "planks", amount: 3 },
    want: { ware: "stone", amount: 1 }, placedAt: 100, placedTime: save.savedAt, fillAt });
  state.escrow.push({ id: "e2", ref: "o1", purpose: "offer", goods: { planks: 3 },
    custody: tradePaidCustody(home), harbourUid: home.uid, held: [{ uid: home.uid, goods: { planks: 3 } }], staged: {} });
  save.settlement.trade = state;
  return save;
};
const planks = (save: GameSaveV1) => save.settlement.storagePools.pools[0]!.available.planks;

describe("fast offline trade calendar", () => {
  it("expires an unfilled offer and refunds its original pool once without a native prefix", async () => {
    const input = offered(), before = JSON.stringify(input), native: unknown[] = [];
    const now = input.savedAt + TRADE_OFFER_LIFETIME_MS + 1_000;
    const result = await advanceOfflineGame(input, now, () => {}, { onIslandMetrics: value => native.push(value) });
    expect(result.settlement.trade!.offers).toEqual([]);
    expect(result.settlement.trade!.escrow).toEqual([]);
    expect(planks(result)).toBe(10);
    expect(result.settlement.trade!.history).toContainEqual(expect.objectContaining({
      at: input.savedAt + TRADE_OFFER_LIFETIME_MS, kind: "expired" }));
    expect(result.settlement.trade!.elapsed).toBe(100 + (now - input.savedAt) / 1_000);
    expect(result.settlement.trade!.buyerClock).toBe(100);
    expect(native).toEqual([]); expect(JSON.stringify(input)).toBe(before);
    expect(await advanceOfflineGame(result, now)).toBe(result);
    await expect(stageGameSession(result)).resolves.toBeDefined();
  });

  it("fills a due offer before its expiry while keeping new delivery cargo uncredited", async () => {
    const input = offered(160); input.settlement.trade!.npcTraders = true;
    const result = await advanceOfflineGame(input, input.savedAt + TRADE_OFFER_LIFETIME_MS + 1_000);
    expect(result.settlement.trade!.offers).toEqual([]);
    expect(result.settlement.trade!.history).toContainEqual(expect.objectContaining({
      at: input.savedAt + 60_000, kind: "sold" }));
    expect(result.settlement.trade!.escrow[0]!.purpose).toBe("sale");
    expect(result.settlement.trade!.deliveries[0]).toMatchObject({ kind: "sale", goods: { stone: 1 } });
    expect(planks(result)).toBe(7);
    expect(result.settlement.storagePools.pools[0]!.available.stone).toBe(source.settlement.storagePools.pools[0]!.available.stone);
    await expect(stageGameSession(result)).resolves.toBeDefined();
  });

  it("refunds a legacy held/staged reservation once and returns a transferable plain save", async () => {
    const input = offered(), escrow = input.settlement.trade!.escrow[0]!;
    delete escrow.custody;
    escrow.held[0]!.goods.planks = 2; escrow.staged.planks = 1;
    const result = await advanceOfflineGame(input, input.savedAt + TRADE_OFFER_LIFETIME_MS + 1_000);
    expect(result.settlement.trade!.offers).toEqual([]);
    expect(planks(result)).toBe(10);
    expect(structuredClone(result)).toEqual(result);
    await expect(stageGameSession(result)).resolves.toBeDefined();
  });

  it("ages the calendar beyond the production cap and preserves unresolved donor custody", async () => {
    const input = offered(), state = input.settlement.trade!;
    state.escrow[0]!.custody!.poolId = 999;
    // This intentionally orphaned reservation cannot refund to an arbitrary surviving pool.
    const { advanceOfflineTradeCalendar } = await import("../src/app/settlement/offline-trade-calendar");
    const loaded = await stageGameSession(source);
    advanceOfflineTradeCalendar(input, loaded.map.world, input.savedAt + 40 * 3_600_000);
    expect(state.elapsed).toBe(100 + 40 * 3_600);
    expect(state.offers).toHaveLength(1); expect(state.escrow).toHaveLength(1);
    expect(planks(input)).toBe(7);
  });
});
