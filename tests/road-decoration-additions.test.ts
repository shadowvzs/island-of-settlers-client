import { expect, it } from "vitest";

import {
  getRoadDecorationItem, type RoadDecorationItemId, roadDecorationItemIdsReleasedBy, roadDecorationItemsTagged
} from "../../island-of-settlers-shared/src/road-decoration-items";
import { roadDecorationMessages } from "../src/app/player-inventory/road-decoration-presentation";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

it("releases accepted additive content with complete names and stable custody identity", () => {
  const items = Object.keys(roadDecorationItemsTagged("addition"));
  const released = roadDecorationItemIdsReleasedBy("decoration");
  expect(items).toHaveLength(17);
  for (const id of items) {
    const item = getRoadDecorationItem(id)!;
    // Bamboo models are building/editor content, never sold.
    expect(item.shopAvailable).toBe(item.uses.includes("shop"));
    expect(item.shopAvailable).toBe(released.has(id as RoadDecorationItemId));
    expect(getRoadDecoration(item.decoration)).toBeDefined();
    expect(roadDecorationMessages(id)?.name).toBeDefined();
  }
});

it.each(Object.keys(roadDecorationItemsTagged("addition")) as RoadDecorationItemId[])(
  "%s preserves actual held/placed/returned custody through rotation and save/load", item => {
    const world = huntingWorld(), roads = createRoadNetwork(world);
    let held = 1;
    const custody = { consume: () => { if (!held) return false; held--; return true; },
      receive: (items: Readonly<Record<string, number>>) => { held += items[item] ?? 0; return true; } };
    const simulation = createSettlementSimulation({ world, roads, initialSettlers: 0, roadDecorationCustody: custody });
    const order = [{ x: 18, z: 10 }, { x: 10, z: 18 }, { x: 18, z: 18 }, { x: 21, z: 10 },
      { x: 22, z: 18 }, { x: 7, z: 22 }, { x: 22, z: 22 }]
      .map(position => ({ item, position, yaw: Math.PI / 4 }))
      .find(candidate => simulation.planRoadDecoration(candidate).ok);
    expect(order, `No legitimate free-terrain site for ${item}`).toBeDefined();
    if (!order) throw new Error("Missing valid additive decoration site");
    expect(simulation.placeRoadDecoration(order)).toEqual({ ok: true, uid: 1 });
    expect(held).toBe(0);
    const before = simulation.saveState(), identity = structuredClone(before.roadDecorations!.placed);
    const restored = createSettlementSimulation({ world, roads, initialSettlers: 0, roadDecorationCustody: custody });
    expect(restored.loadState(before).ok).toBe(true);
    expect(restored.saveState().roadDecorations!.placed).toEqual(identity);
    expect(restored.pickUpRoadDecoration(1)).toEqual({ ok: true, returned: 1 });
    expect(restored.pickUpRoadDecoration(1)).toEqual({ ok: true, returned: 0 });
    const ids = restored.pendingRoadDecorationReturns().map(row => row.id);
    expect(restored.claimRoadDecorationReturns(ids)).toEqual({ ok: true, returned: 1 });
    expect(restored.claimRoadDecorationReturns(ids)).toEqual({ ok: true, returned: 0 });
    expect(held).toBe(1); expect(restored.saveState().roadDecorations!.nextUid).toBe(2);
  }
);
