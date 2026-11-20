import { describe, expect, it } from "vitest";

import { reliefCollectionCandidates } from "../src/shared/settlement/settlement-relief-collections";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { applyStockStorageMove } from "../src/shared/trade/stock-storage";
import { reserveFromStorages } from "../src/shared/trade/trade-island";

const storage = (uid: number, poolId: number, inventory: Record<string, number>, typeId = 39) =>
  ({ uid, storagePoolId: poolId, inventory, construction: 1, typeId, access: { x: uid, z: 0 } }) as unknown as SettlementBuilding;

describe("one-pool trade, aid and committed wallet moves", () => {
  it("refuses a fifteen-log payment against two doors exposing the same ten logs without partial debit", () => {
    const stock = { logs: 10 }, home = storage(1, 0, stock, 0), harbour = storage(2, 0, stock);
    expect(reserveFromStorages([home, harbour], { logs: 15 }, harbour.uid)).toBeNull();
    expect(stock.logs).toBe(10);
    const receipt = reserveFromStorages([home, harbour], { logs: 10 }, harbour.uid)!;
    expect(receipt).toEqual({ custody: { version: 1, poolId: 0, anchor: { x: 2, z: 0 } },
      held: [], staged: { logs: 10 }, harbourUid: 2 });
    expect(stock.logs).toBe(0);
  });

  it("does not borrow overseas ten logs to satisfy a local five-log donor pool", () => {
    const local = { logs: 5 }, other = { logs: 10 };
    const home = storage(1, 0, local, 0), harbour = storage(2, 0, local), overseas = storage(3, 1, other);
    expect(reserveFromStorages([home, harbour, overseas], { logs: 10 }, harbour.uid)).toBeNull();
    expect([local.logs, other.logs]).toEqual([5, 10]);
    expect(reserveFromStorages([home, harbour, overseas], { logs: 1 }, 999)).toBeNull();
  });

  it("reports only one reachable aid pool and cannot aggregate a different connected donor", () => {
    const local = { logs: 5 }, other = { logs: 10 };
    const home = storage(1, 0, local, 0), harbour = storage(2, 0, local), overseas = storage(3, 1, other);
    const context = { buildings: [home, harbour, overseas], options: { roads: { route: () => ({}) } } } as unknown as SettlementContext;
    expect(reliefCollectionCandidates(context, "logs").find(row => row.harbourUid === 2)!.available).toBe(5);
  });

  it("the local wallet mirror cannot double-count doors, borrow overseas stock or move local boats", () => {
    const local = { logs: 10, boat: 1 }, other = { logs: 100 };
    const home = storage(1, 0, local, 0), warehouse = storage(2, 0, local, 29), overseas = storage(3, 1, other);
    expect(applyStockStorageMove([home, warehouse, overseas], { direction: "deposit", goods: { logs: 15 } }).ok)
      .toBe(false);
    expect([local.logs, other.logs]).toEqual([10, 100]);
    expect(applyStockStorageMove([home, warehouse, overseas], { direction: "withdraw", goods: { logs: 2 } }))
      .toEqual({ ok: true, storage: { logs: 12 } });
    expect(local.boat).toBe(1); expect(other.logs).toBe(100);
  });
});
