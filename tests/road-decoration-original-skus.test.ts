import { expect, it } from "vitest";

import { type RoadDecorationItemId, roadDecorationItemsTagged } from "../../island-of-settlers-shared/src/road-decoration-items";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

it.each(Object.keys(roadDecorationItemsTagged("original")) as RoadDecorationItemId[])("original SKU %s freely places, reloads and returns once across cultures", item => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  let held = 1;
  const custody = { consume: () => { if (!held) return false; held--; return true; },
    receive: (items: Readonly<Record<string, number>>) => { held += items[item] ?? 0; return true; } };
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 0, roadDecorationCustody: custody });
  const order = [{ x: 18, z: 10 }, { x: 10, z: 18 }, { x: 18, z: 18 }, { x: 21, z: 10 }]
    .map(position => ({ item, position, yaw: Math.PI / 4 })).find(candidate => simulation.planRoadDecoration(candidate).ok);
  expect(order, `No legitimate off-road site for ${item}`).toBeDefined();
  if (!order) throw new Error("Missing valid original decoration site");
  expect(roads.segments()).toHaveLength(0);
  expect(simulation.placeRoadDecoration(order)).toEqual({ ok: true, uid: 1 }); expect(held).toBe(0);
  const before = simulation.saveState(), identity = structuredClone(before.roadDecorations!.placed);
  expect(identity).toEqual([{ ...order, uid: 1 }]);
  const restored = createSettlementSimulation({ world, roads, initialSettlers: 0, roadDecorationCustody: custody });
  expect(restored.loadState(before).ok).toBe(true);
  expect(restored.saveState().roadDecorations!.placed).toEqual(identity); expect(held).toBe(0);
  expect(restored.pickUpRoadDecoration(1)).toEqual({ ok: true, returned: 1 });
  expect(restored.pickUpRoadDecoration(1)).toEqual({ ok: true, returned: 0 });
  const ids = restored.pendingRoadDecorationReturns().map(row => row.id);
  expect(restored.claimRoadDecorationReturns(ids)).toEqual({ ok: true, returned: 1 });
  expect(restored.claimRoadDecorationReturns(ids)).toEqual({ ok: true, returned: 0 });
  expect(held).toBe(1); expect(restored.saveState().roadDecorations!.nextUid).toBe(2);
});
