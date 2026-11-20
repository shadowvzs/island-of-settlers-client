import { expect, it } from "vitest";

import { createBugReplayRecorder, replaySettlementCommands } from "../src/shared/settlement/bug-replay";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

type Simulation = ReturnType<typeof createSettlementSimulation>;
const SIZE = 56;
const RALLY = { x: 44, z: 44 };

const fixture = () => {
  const world = { seed: 9, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 6.5, z: 6.5 },
    heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
    walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
    props: { count: 0, scale: new Float32Array(), types: new Uint8Array(), x: new Float32Array(),
      z: new Float32Array() }
  } as unknown as WorldData;
  let simulation: Simulation;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 20, roads, world });
  return simulation;
};
const shields = (count: number) =>
  Array.from({ length: count }, () => ({ hp: militaryHealth("shield", 0), rank: 0, type: "shield" as const }));
const advance = (simulation: Simulation, seconds: number) => {
  for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
};
const reload = (simulation: Simulation) =>
  expect(simulation.loadState(JSON.parse(JSON.stringify(simulation.saveState())))).toEqual({ ok: true });
const bodies = (simulation: Simulation) => {
  const ids = new Set(simulation.militarySoldiers().map(soldier => soldier.actor));
  return simulation.frames().filter(actor => ids.has(actor.uid));
};
/** No soldier keeps a rally march: no queued route, no ordered place, nobody near the old banner. */
const expectRallyForgotten = (simulation: Simulation) => {
  const military = simulation.saveState().military!;
  expect(military.combat?.pendingMarches ?? []).toHaveLength(0);
  expect(military.combat?.field?.memories.some(([, memory]) => memory.guardOnArrival) ?? false).toBe(false);
  expect(military.soldiers.every(soldier => !soldier.combat?.destination && !soldier.combat?.order)).toBe(true);
  expect(bodies(simulation).every(actor => Math.hypot(actor.x - RALLY.x, actor.z - RALLY.z) > 12)).toBe(true);
};
/** Back home: every soldier ends stored in its storage, not standing guard at the banner. */
const expectStoredAgain = (simulation: Simulation, count: number) => {
  for (let second = 0; second < 90 && bodies(simulation).some(actor => actor.phase !== "militaryReserve"); second++)
    advance(simulation, 1);
  expect(bodies(simulation).filter(actor => actor.phase === "militaryReserve")).toHaveLength(count);
};

it("sends soldiers walking to a cancelled rally banner back to their storage (save/reload)", () => {
  const simulation = fixture();
  expect(simulation.plantMilitaryRally(RALLY)).toBe(true);
  simulation.receiveTroops(shields(4));
  advance(simulation, 6);
  expect(bodies(simulation).filter(actor => actor.phase === "militaryField")).toHaveLength(4);
  simulation.cancelMilitaryRally();
  expect(simulation.militaryRally()).toBeUndefined();
  reload(simulation);
  expect(bodies(simulation).every(actor => actor.phase === "retire")).toBe(true);
  expectStoredAgain(simulation, 4);
  expectRallyForgotten(simulation);
});

it("keeps soldiers still in the storage door file inside once the banner is cancelled", () => {
  const simulation = fixture();
  expect(simulation.plantMilitaryRally(RALLY)).toBe(true);
  simulation.receiveTroops(shields(6));
  expect(bodies(simulation).every(actor => actor.phase === "militaryLeaving")).toBe(true);
  simulation.cancelMilitaryRally();
  reload(simulation);
  expectStoredAgain(simulation, 6);
  expectRallyForgotten(simulation);
});

it("drops queued rally routes not planned yet, also after save/reload", () => {
  const simulation = fixture();
  expect(simulation.plantMilitaryRally(RALLY)).toBe(true);
  simulation.receiveTroops(shields(12));
  expect(simulation.saveState().military!.combat!.pendingMarches).toHaveLength(12);
  advance(simulation, .2);
  simulation.cancelMilitaryRally();
  reload(simulation);
  expect(simulation.saveState().military!.combat!.pendingMarches).toHaveLength(0);
  expectStoredAgain(simulation, 12);
  expectRallyForgotten(simulation);
});

it("lands troops still at sea when the banner was cancelled into their storage", () => {
  const simulation = fixture();
  expect(simulation.plantMilitaryRally(RALLY)).toBe(true);
  simulation.cancelMilitaryRally();
  simulation.receiveTroops(shields(3));
  expect(bodies(simulation).every(actor => actor.phase === "militaryReserve")).toBe(true);
  advance(simulation, 5);
  expectRallyForgotten(simulation);
});

it("replays the cancel: queued and walking soldiers return home in the replay too", async () => {
  const recorded = fixture(), replayed = fixture();
  const recorder = createBugReplayRecorder(recorded, "test");
  await recorder.start(async () => ({ format: "island-settlers-game", version: 4 }) as GameSaveV1);
  const run = (seconds: number) => {
    for (let tick = 0; tick < seconds * 20; tick++) { recorded.update(.05); recorder.advance(.05); }
  };
  recorded.plantMilitaryRally(RALLY);
  recorded.receiveTroops(shields(10));
  run(4);
  recorded.cancelMilitaryRally();
  run(60);
  const report = recorder.report();
  recorder.dispose();
  expect(report.commands.map(command => command.name)).toContain("cancelMilitaryRally");
  replaySettlementCommands(report, replayed);
  expect(bodies(replayed).map(({ phase, uid, x, z }) => ({ phase, uid, x, z })))
    .toEqual(bodies(recorded).map(({ phase, uid, x, z }) => ({ phase, uid, x, z })));
  expectRallyForgotten(replayed);
  expectStoredAgain(replayed, 10);
});
