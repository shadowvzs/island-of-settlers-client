import { expect, it } from "vitest";

import { mutateSavedRoadDecoration } from "../src/app/settlement/server-road-decoration";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import { createGameSave } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

it("actual headless operation uses trusted wallet custody and round-trips placed/picked-up proof", async () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 0 });
  roads.addRoad({ x: 18, z: 10 }, { x: 18, z: 12 });
  const save = await createGameSave(world, simulation.saveState(), { name: "Road custody",
    source: "generated", savedAt: 1_000_000, animals: [] });
  const item = "roadDecoration:indigenous-flower-pot:native" as const;
  save.player = { ...createPlayerProgress(world.seed), inventory: { [item]: 99 } };
  const edge = roads.segments()[0]!;
  const action = { kind: "place" as const, order: { item, position: {
    x: (edge.start.x + edge.end.x) / 2 + 1, z: (edge.start.z + edge.end.z) / 2 }, yaw: 0 } };
  const missing = await mutateSavedRoadDecoration(save, action, {});
  expect(missing).toMatchObject({ ok: false });
  const placed = await mutateSavedRoadDecoration(save, action, { [item]: 1 });
  expect(placed, JSON.stringify(placed)).toMatchObject({ ok: true, placed: { uid: 1, item }, returned: [] });
  if (!placed?.ok) throw new Error("Expected real headless placement");
  const rotated = await mutateSavedRoadDecoration(placed.game, { kind: "rotate", uid: 1 }, {});
  expect(rotated).toMatchObject({ ok: true, updated: { uid: 1, item }, returned: [],
    game: { settlement: { roadDecorations: { nextUid: 2, nextReturn: 1,
      placed: [{ uid: 1, item, yaw: Math.PI / 2 }], returns: [] } } } });
  if (!rotated?.ok) throw new Error("Expected real headless rotation without inventory");
  const moved = await mutateSavedRoadDecoration(rotated.game, { kind: "move", uid: 1,
    position: { x: action.order.position.x + 2, z: action.order.position.z }, yaw: Math.PI / 4 }, {});
  expect(moved).toMatchObject({ ok: true, updated: { uid: 1, item }, returned: [],
    game: { settlement: { roadDecorations: { nextUid: 2, nextReturn: 1,
      placed: [{ uid: 1, item, yaw: Math.PI / 4, position: { x: action.order.position.x + 2 } }], returns: [] } } } });
  if (!moved?.ok) throw new Error("Expected real headless move without inventory");
  const picked = await mutateSavedRoadDecoration(moved.game, { kind: "pick-up", uid: 1 }, {});
  expect(picked).toMatchObject({ ok: true, returned: [{ source: 1, item }] });
  if (!picked?.ok) throw new Error("Expected real headless pickup");
  const retry = await mutateSavedRoadDecoration(picked.game, { kind: "pick-up", uid: 1 }, {});
  expect(retry).toMatchObject({ ok: true, returned: [] });
});
