import { expect, it, vi } from "vitest";

import { createRoadDecorationTool } from "../src/app/settlement/road-decoration-tool";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

it("road ghost plans stay read-only/cached; cancel keeps the stack and commit consumes exactly one", async () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  let held = 2;
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 0,
    roadDecorationCustody: { consume: () => { if (!held) return false; held--; return true; }, receive: () => true } });
  roads.addRoad({ x: 18, z: 10 }, { x: 18, z: 12 });
  const edge = roads.segments()[0]!, point = { x: (edge.start.x + edge.end.x) / 2 + 1,
    z: (edge.start.z + edge.end.z) / 2 };
  const plan = vi.spyOn(simulation, "planRoadDecoration"), changed = vi.fn(), message = vi.fn();
  const commit = vi.fn(async order => { const result = simulation.placeRoadDecoration(order); return result.ok ? true as const : result.reason; });
  const tool = createRoadDecorationTool({ world, simulation, held: () => held, commit, changed, message });
  const item = "roadDecoration:indigenous-flower-pot:native";
  tool.select(item);
  for (let tick = 0; tick < 200; tick++) tool.update(point);
  expect(plan).toHaveBeenCalledOnce(); expect(tool.ghost()?.valid).toBe(true);
  expect(held).toBe(2); expect(simulation.roadDecorations()).toHaveLength(0);
  tool.cancel(); expect(held).toBe(2); expect(commit).not.toHaveBeenCalled();
  tool.select(item); tool.update(point); await tool.place(); await tool.place();
  expect(held).toBe(1); expect(commit).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce();
  expect(simulation.roadDecorations()).toHaveLength(1); expect(tool.active()).toBe(false);
});

it("free ghost follows owned terrain with no road and R rotation changes the exact committed yaw", async () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  let held = 1;
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 0,
    roadDecorationCustody: { consume: () => { held--; return true; }, receive: () => true } });
  const commit = vi.fn(async order => { const result = simulation.placeRoadDecoration(order); return result.ok ? true as const : result.reason; });
  const tool = createRoadDecorationTool({ world, simulation, held: () => held, commit, changed: () => undefined, message: () => undefined });
  tool.select("roadDecoration:indigenous-flower-pot:native"); tool.update({ x: 18.25, z: 10.5 });
  expect(tool.ghost()).toMatchObject({ position: [18.25, 2, 10.5], yaw: 0, valid: true });
  tool.rotate(); tool.update({ x: 18.25, z: 10.5 });
  expect(tool.ghost()?.yaw).toBe(Math.PI / 4); await tool.place();
  expect(simulation.saveState().roadDecorations?.placed[0]).toMatchObject({ position: { x: 18.25, z: 10.5 }, yaw: Math.PI / 4 });
  expect(held).toBe(0);
});

it("moving uses the existing placed UID without a held item; cancel leaves the original and commit moves only once", async () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  let held = 1;
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 0,
    roadDecorationCustody: { consume: () => { held--; return true; }, receive: () => true } });
  const item = "roadDecoration:indigenous-flower-pot:native";
  expect(simulation.placeRoadDecoration({ item, position: { x: 18.25, z: 10.5 }, yaw: 0 }).ok).toBe(true);
  const before = simulation.saveState().roadDecorations, commit = vi.fn();
  const commitMove = vi.fn(async (uid, order) => {
    const result = simulation.moveRoadDecoration(uid, order.position, order.yaw);
    return result.ok ? true as const : result.reason;
  });
  const tool = createRoadDecorationTool({ world, simulation, held: () => held, commit, commitMove,
    changed: () => undefined, message: () => undefined });
  expect(tool.move(1)).toBe(true); tool.update({ x: 20.25, z: 10.5 });
  expect(tool.ghost()?.valid).toBe(true); expect(held).toBe(0);
  expect(simulation.saveState().roadDecorations).toEqual(before);
  tool.cancel(); expect(simulation.saveState().roadDecorations).toEqual(before);
  expect(commitMove).not.toHaveBeenCalled();
  expect(tool.move(1)).toBe(true); tool.rotate(); tool.update({ x: 20.25, z: 10.5 });
  await tool.place(); await tool.place();
  expect(commit).not.toHaveBeenCalled(); expect(commitMove).toHaveBeenCalledOnce();
  expect(held).toBe(0); expect(simulation.saveState().roadDecorations).toMatchObject({
    nextUid: 2, nextReturn: 1, returns: [], placed: [{ uid: 1, item, position: { x: 20.25, z: 10.5 }, yaw: Math.PI / 4 }]
  });
});
