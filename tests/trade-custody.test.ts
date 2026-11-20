import { expect, it } from "vitest";

import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { reconcileStorageAccess } from "../src/shared/settlement/shared-storage";
import { cancelPlayerOffer, foldIslandTrade, placePlayerOffer, updateTrade } from "../src/shared/trade/trade-commands";
import { tradeCustodyReason } from "../src/shared/trade/trade-custody";
import { reconcileEscrows } from "../src/shared/trade/trade-escrow";
import { settlementTradePort } from "../src/shared/trade/trade-island";
import { addDelivery, createTradeState } from "../src/shared/trade/trade-ledger";
import { migrateTradeSave, validateTradeSave } from "../src/shared/trade/trade-save";
import { dispatchTradeShips } from "../src/shared/trade/trade-shipping";
import { BLOCKING, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const world = { seed: 9, cellsX: 8, cellsZ: 3, terrainRevision: 0, blocking: new Uint8Array(24) } as unknown as WorldData;
  for (let z = 0; z < 3; z++) world.blocking[z * 8 + 4] = BLOCKING.water;
  const access = (uid: number, typeId: number, x: number) => ({ uid, typeId, x, z: 1,
    access: { x, z: 1 }, construction: 1, inventory: {}, input: {}, incoming: {}, required: {} }) as unknown as SettlementBuilding;
  const home = access(0, 0, 1), harbour = access(1, 39, 2), overseas = access(2, 39, 6);
  home.inventory.planks = 30; overseas.inventory.planks = 90;
  const context = { options: { world, now: () => 5000, playerLevel: () => 1 }, actors: [],
    buildings: [home, harbour, overseas] } as unknown as SettlementContext;
  reconcileStorageAccess(context);
  const state = createTradeState(), port = settlementTradePort(context, state);
  expect(placePlayerOffer(state, port, { ware: "planks", amount: 10 }, { ware: "fish", amount: 10 })).toBe(true);
  return { access, context, harbour, home, overseas, port, state };
};

it("persists original paid pool and never substitutes an overseas harbour after loss", () => {
  const { context, harbour, home, overseas, state } = fixture();
  const custody = structuredClone(state.escrow[0]!.custody);
  expect(custody?.poolId).toBe(home.storagePoolId);
  expect(validateTradeSave(state)).toBeNull();
  const restored = migrateTradeSave(JSON.parse(JSON.stringify(state))).state;
  expect(restored.escrow[0]!.custody).toEqual(custody);
  context.buildings = [home, overseas];
  reconcileEscrows(restored, context);
  expect(restored.escrow[0]!.harbourUid).toBeUndefined();
  expect(overseas.inventory.planks).toBe(90);
  const delivery = addDelivery(restored, "sale", "o1", { fish: 10 }, restored.escrow[0]!.id);
  let sent = false;
  dispatchTradeShips(restored, overseas.uid, { ready: () => {}, send: () => { sent = true; return 1; }, shipIds: () => new Set() });
  expect(sent).toBe(false);
  expect(delivery.shipId).toBeUndefined();
  expect(cancelPlayerOffer(restored, settlementTradePort(context, restored), restored.offers[0]!.id)).toBe(true);
  expect(home.inventory.planks).toBe(30);
  expect(overseas.inventory.planks).toBe(90);
  expect(harbour.uid).toBe(1);
});

it("refunds paid held and staged goods into an orphaned original pool once", () => {
  const { context, home, overseas, state } = fixture();
  const pool = context.storagePools!.pools.find(row => row.id === home.storagePoolId)!;
  const escrow = state.escrow[0]!;
  escrow.staged = { planks: 4 }; escrow.held = [{ uid: home.uid, goods: { planks: 6 } }];
  context.buildings = [overseas];
  reconcileEscrows(state, context);
  expect(cancelPlayerOffer(state, settlementTradePort(context, state), state.offers[0]!.id)).toBe(true);
  expect(pool.available.planks).toBe(30);
  expect(overseas.inventory.planks).toBe(90);
  expect(cancelPlayerOffer(state, settlementTradePort(context, state), "o1")).not.toBe(true);
  expect(pool.available.planks).toBe(30);
});

it("uses a new same-pool harbour and validates the versioned custody payload", () => {
  const { access, context, home, overseas, state } = fixture();
  const replacement = access(3, 39, 3);
  context.buildings = [home, overseas, replacement];
  reconcileStorageAccess(context);
  reconcileEscrows(state, context);
  expect(state.escrow[0]!.harbourUid).toBe(replacement.uid);
  expect(settlementTradePort(context, state).store({ planks: 1 }, overseas.uid, state.escrow[0]!.custody)).toBe(false);
  expect(overseas.inventory.planks).toBe(90);
  const bad = structuredClone(state);
  bad.escrow[0]!.custody!.poolId = overseas.storagePoolId!;
  expect(tradeCustodyReason(context, bad.escrow)).toBe("Trade paid custody does not match its original pool");
  const before = overseas.inventory.planks;
  expect(settlementTradePort(context, state).refund!(bad.escrow[0]!)).toBe(false);
  expect(overseas.inventory.planks).toBe(before);
  bad.escrow[0]!.custody!.poolId = -1;
  expect(validateTradeSave(bad)).toBe("Invalid trade escrow or deliveries");
  bad.escrow[0]!.custody = { version: 1, poolId: 0, anchor: { x: NaN, z: 1 } };
  expect(validateTradeSave(bad)).toBe("Invalid trade escrow or deliveries");
});

it("retains an unbound historical escrow when its lost donor cannot be proved", () => {
  const { context, home, overseas, state } = fixture();
  delete state.escrow[0]!.custody;
  context.buildings = [home, overseas];
  reconcileEscrows(state, context);
  expect(cancelPlayerOffer(state, settlementTradePort(context, state), state.offers[0]!.id)).not.toBe(true);
  expect(state.escrow).toHaveLength(1);
  expect(state.offers).toHaveLength(1);
  expect(home.inventory.planks).toBe(20);
  expect(overseas.inventory.planks).toBe(90);
});

it("expires paid stock into its orphaned donor exactly once and retains ambiguous off-home jobs", () => {
  const { context, home, overseas, state } = fixture();
  const pool = context.storagePools!.pools.find(row => row.id === home.storagePoolId)!;
  context.buildings = [overseas];
  context.options.now = () => 100_000_000;
  updateTrade(state, settlementTradePort(context, state), 0);
  expect(pool.available.planks).toBe(30);
  expect(state.offers).toHaveLength(0);
  expect(state.escrow).toHaveLength(0);
  updateTrade(state, settlementTradePort(context, state), 0);
  expect(pool.available.planks).toBe(30);
  const ambiguous = fixture();
  delete ambiguous.state.escrow[0]!.custody;
  ambiguous.context.buildings = [ambiguous.overseas];
  expect(foldIslandTrade(ambiguous.state, settlementTradePort(ambiguous.context, ambiguous.state))).toBe(false);
  expect(validateTradeSave(ambiguous.state)).toBeNull();
  expect(ambiguous.state.escrow).toHaveLength(1);
});
