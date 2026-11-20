import { expect, it } from "vitest";

import { createBugReplayRecorder, replaySettlementCommands } from "../src/shared/settlement/bug-replay";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createReplaySceneAdapter, createReplaySceneJournal } from "../src/shared/settlement/replay-scene";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementOptions } from "../src/shared/settlement/settlement-types";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(SMALL_EDITOR_WORLD);

it("replays wildlife observations and prop transitions at their original frame boundaries", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD), original = structuredClone(world);
  const recorder = createReplaySceneJournal(world);
  let fleeing = false;
  const wrapped = recorder.wrap({ world, roads: createRoadNetwork(world), getHuntTarget: () =>
    ({ x: 12, z: 13, fleeing, dead: false, collectible: false }),
    canHarvestTree: () => true } as SettlementOptions);
  recorder.begin(); recorder.beforeUpdate();
  expect(wrapped.getHuntTarget!(2)?.fleeing).toBe(false);
  world.props.types[0] = 255; fleeing = true;
  recorder.beforeUpdate(); expect(wrapped.getHuntTarget!(2)?.fleeing).toBe(true);
  recorder.stop();
  const replay = createReplaySceneAdapter(original, recorder.snapshot());
  replay.beforeUpdate(); expect(replay.hooks.getHuntTarget!(2)?.fleeing).toBe(false);
  expect(original.props.types[0]).not.toBe(255);
  replay.beforeUpdate(); expect(original.props.types[0]).toBe(255);
  expect(replay.hooks.getHuntTarget!(2)?.fleeing).toBe(true); replay.finish();
});
it("rejects mismatched hook arguments instead of inventing a response", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD), recorder = createReplaySceneJournal(world);
  const wrapped = recorder.wrap({ world, roads: createRoadNetwork(world), getHuntTarget: () => null } as SettlementOptions);
  recorder.begin(); recorder.beforeUpdate(); wrapped.getHuntTarget!(5);
  const replay = createReplaySceneAdapter(world, recorder.snapshot()); replay.beforeUpdate();
  expect(() => replay.hooks.getHuntTarget!(6)).toThrow("arguments diverged");
});

it("records the real clock across pauses and commands instead of inferring it from simulation time", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD), journal = createReplaySceneJournal(world);
  let time = 100;
  const options = journal.wrap({ world, roads: createRoadNetwork(world), now: () => time });
  journal.begin(); expect(options.now!()).toBe(100);
  time = 90000; journal.beforeUpdate(); expect(options.now!()).toBe(90000); journal.stop();
  const replay = createReplaySceneAdapter(world, journal.snapshot(), 50);
  expect(replay.hooks.now!()).toBe(50); replay.start();
  expect(replay.hooks.now!()).toBe(100); replay.beforeUpdate(); expect(replay.hooks.now!()).toBe(90000);
  replay.stop(); expect(replay.hooks.now!()).toBe(90000); replay.finish();
});

it("records player-level observations used by new colony discovery after debug levelling", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  const recorder = createReplaySceneJournal(world);
  let level = 1;
  const wrapped = recorder.wrap({ world, roads: createRoadNetwork(world), playerLevel: () => level });
  recorder.begin();
  expect(wrapped.playerLevel!()).toBe(1);
  level = 31;
  expect(wrapped.playerLevel!()).toBe(31);
  recorder.stop();
  const replay = createReplaySceneAdapter(structuredClone(world), recorder.snapshot());
  expect(replay.hooks.playerLevel!()).toBe(1);
  expect(replay.hooks.playerLevel!()).toBe(31);
  expect(() => replay.finish()).not.toThrow();
});

it("flushes final external prop changes even without another simulation frame", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD), initial = structuredClone(world);
  const journal = createReplaySceneJournal(world);
  journal.wrap({ world, roads: createRoadNetwork(world) });
  journal.begin();
  world.props.types[0] = 255;
  journal.stop();
  const recorded = journal.snapshot();
  expect(recorded.some(event => "props" in event)).toBe(true);
  const replay = createReplaySceneAdapter(initial, recorded);
  replay.finish();
  expect(initial.props.types[0]).toBe(255);
  // Re-export/stop cannot append a duplicate terminal transition.
  journal.stop(); expect(journal.snapshot()).toEqual(recorded);
});

it("replays external animal-production acceptance with compact stable building identity", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD), journal = createReplaySceneJournal(world);
  let accepted = false;
  const options = journal.wrap({ world, roads: createRoadNetwork(world), onAnimalProduced: () => accepted });
  const building = { uid: 8, typeId: 28, inventory: { grain: 999 }, input: {}, output: {} } as unknown as
    import("../src/shared/settlement/settlement-types").SettlementBuilding;
  journal.begin();
  expect(options.onAnimalProduced!(building)).toBe(false);
  accepted = true;
  expect(options.onAnimalProduced!(building)).toBe(true);
  journal.stop();
  const events = journal.snapshot();
  expect(events.filter(event => "hook" in event).map(event => "hook" in event && event.args))
    .toEqual([[{ uid: 8, typeId: 28 }], [{ uid: 8, typeId: 28 }]]);
  const replay = createReplaySceneAdapter(structuredClone(world), events);
  expect(replay.hooks.onAnimalProduced!({ ...building, inventory: {} })).toBe(false);
  expect(replay.hooks.onAnimalProduced!(building)).toBe(true);
  replay.finish();
});


it("replays placement with its captured unlock context and preserves normal level checks", async () => {
  for (const unlockAllBuildings of [true, false]) {
    const world = cachedWorld(SMALL_EDITOR_WORLD), restoredWorld = structuredClone(world);
    const scene = createReplaySceneJournal(world);
    const simulation = createSettlementSimulation(scene.wrap({
      playerLevel: () => 1, roads: createRoadNetwork(world), unlockAllBuildings, world
    }));
    let baseline = simulation.saveState();
    const recorder = createBugReplayRecorder(simulation, "placement-context", undefined, scene);
    await recorder.start(async () => {
      baseline = simulation.saveState();
      return { format: "island-settlers-game", version: 4 } as GameSaveV1;
    });
    const placed = simulation.placeBuilding(37, 30, 30);
    if (!unlockAllBuildings) expect(placed).toEqual({ ok: false, reason: "Reach level 4 to build this" });
    else expect(placed.reason).not.toBe("Reach level 4 to build this");
    expect(scene.snapshot().some(event => "hook" in event && event.hook === "playerLevel")).toBe(!unlockAllBuildings);
    scene.beforeUpdate(); simulation.update(.05); recorder.advance(.05);
    const report = recorder.report();
    const adapter = createReplaySceneAdapter(restoredWorld, report.scene!);
    const replay = adapter.whileConstructing(() => createSettlementSimulation({
      ...adapter.hooks, roads: createRoadNetwork(restoredWorld), world: restoredWorld }));
    expect(replay.loadState(baseline)).toEqual({ ok: true });
    const update = replay.update;
    replay.update = dt => { adapter.beforeUpdate(); update(dt); };
    adapter.start();
    const differences: unknown[] = [];
    const result = replaySettlementCommands(report, replay, (_command, actual) => differences.push(actual),
      adapter.stop, adapter.afterCommand);
    adapter.finish();
    expect(differences).toEqual([]);
    expect(result).toEqual(report.finalSettlement);
    recorder.dispose();
  }
}, 30_000);

it("rejects malformed placement context while enforcing scene observation order", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD), journal = createReplaySceneJournal(world);
  journal.wrap({ world, roads: createRoadNetwork(world), playerLevel: () => 1 });
  journal.begin(); journal.beforeUpdate(); journal.stop();
  const events = journal.snapshot();
  expect(() => createReplaySceneAdapter(world, [{ hooks: [], unlockAllBuildings: "yes" }, ...events.slice(1)] as never))
    .toThrow("Invalid scene hook configuration");
  const adapter = createReplaySceneAdapter(world, events);
  expect(() => adapter.hooks.playerLevel!()).toThrow("Scene observation order diverged");
});

it("replays level-gated commands while ignoring read-only UI level queries between frames", async () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD), restoredWorld = structuredClone(world);
  const scene = createReplaySceneJournal(world);
  const simulation = createSettlementSimulation(scene.wrap({
    playerLevel: () => 1, roads: createRoadNetwork(world), world
  }));
  const originalUpdate = simulation.update;
  let baseline = simulation.saveState();
  const recorder = createBugReplayRecorder(simulation, "ui-queries", undefined, scene);
  await recorder.start(async () => {
    baseline = simulation.saveState();
    return { format: "island-settlers-game", version: 4 } as GameSaveV1;
  });
  const beforeUi = scene.snapshot();
  expect(simulation.buildingLockLevel(37)).toBe(4);
  expect(scene.snapshot()).toEqual(beforeUi);
  scene.beforeUpdate(); simulation.update(.05); recorder.advance(.05);
  expect(simulation.allowsBuilding(37)).toBe(false);
  expect(simulation.placeBuilding(37, 30, 30)).toEqual({ ok: false, reason: "Reach level 4 to build this" });
  expect(simulation.buildingLockLevel(37)).toBe(4);
  const report = recorder.report();
  const adapter = createReplaySceneAdapter(restoredWorld, report.scene!);
  const replay = adapter.whileConstructing(() => createSettlementSimulation({
      ...adapter.hooks, roads: createRoadNetwork(restoredWorld), world: restoredWorld }));
  expect(replay.loadState(baseline)).toEqual({ ok: true });
  const update = replay.update;
  replay.update = dt => { adapter.beforeUpdate(); update(dt); };
  adapter.start();
  const differences: unknown[] = [];
  const result = replaySettlementCommands(report, replay, (_command, actual) => differences.push(actual),
    adapter.stop, adapter.afterCommand);
  adapter.finish();
  expect(differences).toEqual([]);
  expect(result).toEqual(report.finalSettlement);
  recorder.dispose();
  expect(simulation.update).toBe(originalUpdate);
}, 30_000);
