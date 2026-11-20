import { expect, it } from "vitest";

import type { RoadDecorationItemId } from "../../island-of-settlers-shared/src/road-decoration-items";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const ITEM: RoadDecorationItemId = "roadDecoration:indigenous-flower-pot:native";
const fixture = () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  let held = 2;
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 0,
    roadDecorationCustody: {
      consume: () => { if (!held) return false; held--; return true; },
      receive: items => { held += items[ITEM] ?? 0; return true; }
    } });
  roads.addRoad({ x: 18, z: 10 }, { x: 18, z: 12 });
  const edge = roads.segments()[0]!, anchor = { x: (edge.start.x + edge.end.x) / 2, z: (edge.start.z + edge.end.z) / 2 };
  return { world, roads, simulation, held: () => held, edge, order: { item: ITEM, position: { x: anchor.x + 1, z: anchor.z }, yaw: 0 } };
};

it("road deletion leaves absolute decoration identity intact; manual pickup returns once and preserves UID history", () => {
  const { edge, held, order, simulation } = fixture();
  expect(simulation.planRoadDecoration(order).ok).toBe(true);
  expect(simulation.placeRoadDecoration(order)).toEqual({ ok: true, uid: 1 });
  expect(held()).toBe(1); expect(simulation.roadDecorations()).toHaveLength(1);
  const before = structuredClone(simulation.saveState().roadDecorations!.placed);
  expect(simulation.removeRoad(edge.start, edge.end)).toBe(true);
  expect(simulation.saveState().roadDecorations!.placed).toEqual(before);
  expect(simulation.pendingRoadDecorationReturns()).toHaveLength(0);
  expect(simulation.pickUpRoadDecoration(1)).toEqual({ ok: true, returned: 1 });
  expect(simulation.roadDecorations()).toHaveLength(0);
  const returns = simulation.pendingRoadDecorationReturns(); expect(returns).toHaveLength(1);
  expect(simulation.claimRoadDecorationReturns(returns.map(row => row.id))).toEqual({ ok: true, returned: 1 });
  expect(held()).toBe(2);
  const saved = simulation.saveState();
  expect(saved.roadDecorations).toMatchObject({ nextUid: 2, nextReturn: 2, placed: [], returns: [] });
  expect(simulation.loadState(saved).ok).toBe(true);
  expect(simulation.saveState().roadDecorations).toEqual(saved.roadDecorations);
});

it("loaded real geometry blocks only its actual separate support and leaves the road centre usable", () => {
  const { order, simulation } = fixture();
  expect(simulation.placeRoadDecoration(order).ok).toBe(true);
  const frame = simulation.roadDecorations()[0]!;
  expect(simulation.isOccupied(frame.position[0], frame.position[2])).toBe(true);
  expect(simulation.isOccupied(order.position.x - 1, order.position.z)).toBe(false);
  const saved = simulation.saveState();
  expect(simulation.loadState(saved).ok).toBe(true);
  expect(simulation.roadDecorations()).toHaveLength(1);
});

it("future buildings reserve actual paid decoration volume and require manual pickup first", () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 0,
    roadDecorationCustody: { consume: () => true, receive: () => true } });
  const [width, depth] = getBuildingDefinition(1).gridFootprint;
  const position = { x: 18 + width % 2 / 2, z: 10 + depth % 2 / 2 };
  expect(simulation.validatePlacement(1, position.x, position.z)).toBeNull();
  expect(simulation.placeRoadDecoration({ item: ITEM, position, yaw: 0 }).ok).toBe(true);
  expect(simulation.validatePlacement(1, position.x, position.z)).toMatch(/placed road decoration/);
  expect(simulation.pendingRoadDecorationReturns()).toHaveLength(0);
  simulation.pickUpRoadDecoration(1);
  expect(simulation.validatePlacement(1, position.x, position.z)).toBeNull();
});

it("future roads cannot silently consume a paid solid when a route would cross it", () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 0,
    roadDecorationCustody: { consume: () => true, receive: () => true } });
  const start = { x: 17, z: 10.5 }, end = { x: 21, z: 10.5 };
  expect(simulation.planRoad(start, end, "dirt")).not.toBeNull();
  expect(simulation.placeRoadDecoration({ item: ITEM, position: { x: 19, z: 10.5 }, yaw: 0 }).ok).toBe(true);
  const identity = structuredClone(simulation.saveState().roadDecorations!.placed);
  expect(simulation.connectRoads(start, end)).toBe(false);
  expect(simulation.saveState().roadDecorations!.placed).toEqual(identity);
  expect(simulation.pendingRoadDecorationReturns()).toHaveLength(0);
});
