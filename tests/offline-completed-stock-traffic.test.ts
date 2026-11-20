import { expect, it } from "vitest";

import { settleOfflineStorageTraffic } from "../src/app/settlement/offline-economy-storage-traffic";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import type { SavedStockTraffic } from "../src/shared/settlement/settlement-stock-traffic";
import { validateStockTraffic } from "../src/shared/settlement/settlement-stock-traffic-save";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";

it("retires only completed courier court custody and obsolete rival waits, preserving every other timer/owner", () => {
  const traffic: SavedStockTraffic = { clock: 120, owners: [
    { building: 10, actor: 1 }, { building: 11, actor: 2, watch: { elapsed: 3,
      point: { x: 2, z: 3 }, goal: { x: 4, z: 5 }, yielded: false } }
  ], actors: [
    { actor: 1, phase: "deliver", cooldown: 110, queued: { building: 10, phase: "deliveryStockWalk", since: 90 } },
    { actor: 2, phase: "inputApproach", cooldown: 118, queued: { building: 11, phase: "inputApproach", since: 80 },
      entry: { rival: 1, since: 95 } },
    { actor: 3, phase: "pickupStockWalk", entry: { rival: 2, since: 89 } }
  ] };
  const actor = { uid: 1, phase: "inside", visible: false } as SettlementActor;
  const state = { stockTraffic: traffic } as SettlementSaveV1;
  const owner = traffic.owners[1]!, waiting = traffic.actors[1]!, unaffected = structuredClone(traffic.actors[2]!);
  settleOfflineStorageTraffic(state, actor); // No storageTraffic exists: stock cleanup still runs.
  expect(traffic.clock).toBe(120); expect(traffic.owners).toEqual([owner]);
  expect(traffic.owners[0]).toBe(owner);
  expect(traffic.actors).toEqual([
    { actor: 2, phase: "inputApproach", cooldown: 118, queued: { building: 11, phase: "inputApproach", since: 80 },
      entry: undefined }, unaffected
  ]);
  expect(traffic.actors[0]).toBe(waiting);
  expect(validateStockTraffic(traffic, [actor, { uid: 2, phase: "inputApproach" }, { uid: 3, phase: "pickupStockWalk" }],
    [{ uid: 10 }, { uid: 11 }])).toBeNull();
});

it("keeps active couriers' admission ownership and queued times untouched", () => {
  const traffic: SavedStockTraffic = { clock: 20, owners: [{ building: 10, actor: 1 }],
    actors: [{ actor: 1, phase: "deliver", cooldown: 17 }] };
  const before = structuredClone(traffic), state = { stockTraffic: traffic } as SettlementSaveV1;
  settleOfflineStorageTraffic(state, { uid: 1, phase: "deliver", visible: true } as SettlementActor);
  expect(traffic).toEqual(before);
});
