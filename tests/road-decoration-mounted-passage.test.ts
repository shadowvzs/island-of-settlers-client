import { expect, it } from "vitest";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../island-of-settlers-shared/src/road-decoration-items";
import { CART_STONE_LANE, HANDCART } from "../src/render-common/logistics/handcart-rules";
import { placeRoadDecorationBounds, roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { planRoadDecorationPlacement } from "../src/shared/settlement/road-decoration-placement";
import { createRoadDecorationState } from "../src/shared/settlement/road-decoration-state";
import { decorationClearsRoadTraffic } from "../src/shared/settlement/road-decoration-traffic";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { isMountedNavigationClear } from "../src/shared/settlement/settlement-navigation";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const item = "roadDecoration:plant-lavender-roadside-ground-0:native" as const;
const definition = ROAD_DECORATION_ITEM_DEFINITIONS[item]!;
const roads = [{ start: { x: 20, z: 10 }, end: { x: 20, z: 50 }, tier: "stone" as const }];
const environment = { nation: "roman" as const, roads, heightAt: () => 2, isOwned: () => true, isFree: () => true };
const world = huntingWorld();
/** A legal placement under the prior cart-only contract, established independently of the new validator. */
const oldRoadsideOrder = () => {
  const contract = roadDecorationClearance(getRoadDecoration(definition.decoration)!);
  for (let offset = .8; offset < 3; offset += .025) {
    const position = { x: 20 + offset, z: 30 };
    const volumes = contract.volumes.map(box => placeRoadDecorationBounds(box, [position.x, 2, position.z], 0));
    if (decorationClearsRoadTraffic(volumes, roads, environment.heightAt)) return { item, position, yaw: 0 };
  }
  throw new Error("Expected the old cart-only roadside fixture");
};

it("keeps actual mounted centreline navigation and loaded-cart lanes clear beside planted decorations", () => {
  const old = oldRoadsideOrder();
  expect(planRoadDecorationPlacement({ ...old, decoration: definition.decoration }, environment))
    .toEqual({ ok: false, reason: "road-traffic-obstructed" });
  const owner = createRoadDecorationState(() => environment);
  const safe = { ...old, position: { x: old.position.x + .4, z: old.position.z } };
  expect(owner.place(safe, () => true).ok).toBe(true);
  const context = { options: { world }, buildings: [], actors: [], occupied: new Uint8Array(64 * 64),
    roadDecorations: owner } as unknown as SettlementContext;
  for (let step = 0; step <= 40; step++) {
    const z = 28 + step * .1;
    expect(isMountedNavigationClear(context, { x: 20, z })).toBe(true);
    expect(owner.isSupportClear({ x: 20 + CART_STONE_LANE, z }, HANDCART.width / 2 + HANDCART.clearance)).toBe(true);
  }
  expect(planRoadDecorationPlacement({ decoration: "viking-timber-portal",
    position: { x: 20, z: 30 }, yaw: 0 }, environment).ok).toBe(true);
});

it("returns a too-close saved botanical item once through existing inventory custody", () => {
  const owner = createRoadDecorationState(() => environment);
  owner.load({ nextReturn: 1, nextUid: 2, placed: [{ ...oldRoadsideOrder(), uid: 1 }], returns: [] });
  expect(owner.frames()).toHaveLength(0);
  expect(owner.returns()).toMatchObject([{ item, source: 1, reason: "road-traffic-obstructed" }]);
  let received = 0;
  const receive = (items: Readonly<Record<string, number>>) => { received += items[item] ?? 0; return true; };
  const ids = owner.returns().map(row => row.id);
  expect(owner.claimReturns(ids, receive)).toEqual({ ok: true, returned: 1 });
  expect(owner.claimReturns(ids, receive)).toEqual({ ok: true, returned: 0 });
  owner.load(owner.save());
  expect(received).toBe(1); expect(owner.returns()).toHaveLength(0);
});

it("future roads preserve the same mounted margin and never consume paid botanical custody", () => {
  const terrain = huntingWorld(), roadNetwork = createRoadNetwork(terrain);
  const sim = createSettlementSimulation({ world: terrain, roads: roadNetwork, initialSettlers: 0,
    roadDecorationCustody: { consume: () => true, receive: () => true } });
  const start = { x: 18, z: 11 }, end = { x: 18, z: 14 };
  expect(sim.planRoad(start, end, "dirt")).not.toBeNull();
  const old = oldRoadsideOrder();
  const order = { ...old, position: { x: old.position.x - 2, z: 12.5 } };
  expect(sim.placeRoadDecoration(order).ok).toBe(true);
  const before = structuredClone(sim.saveState().roadDecorations);
  expect(sim.connectRoads(start, end)).toBe(false);
  expect(sim.saveState().roadDecorations).toEqual(before);
  expect(sim.pendingRoadDecorationReturns()).toHaveLength(0);
});
