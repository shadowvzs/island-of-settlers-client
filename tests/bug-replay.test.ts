import { expect, it } from "vitest";

import {
  createBugReplayRecorder,
  replaySettlementCommands
} from "../src/shared/settlement/bug-replay";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const fixture = () => {
  let elapsed = 0,
    accepted = true;
  const simulation = {
    setStorageAcceptance: (_uid: number, _ware: string, next: boolean) => {
      accepted = next;
      return true;
    },
    update: (dt: number) => {
      elapsed += dt;
    },
    saveState: () => ({ accepted, elapsed })
  } as unknown as SettlementSimulation;
  return { simulation, values: () => ({ accepted, elapsed }) };
};
const baseline = { format: "island-settlers-game", version: 4 } as GameSaveV1;
it("records and replays copied voyage orders after freezing offered islands into the baseline", async () => {
  const orders: unknown[][] = [], replayed: unknown[][] = [];
  let offers = 0;
  const first = { ...fixture().simulation,
    colonyIslands: () => { offers++; return []; },
    adventureIslands: () => { offers++; return []; },
    queueSeaTransport: (...args: unknown[]) => { orders.push(args); return { ok: true }; }
  } as unknown as SettlementSimulation;
  const second = { ...fixture().simulation,
    queueSeaTransport: (...args: unknown[]) => { replayed.push(args); return { ok: true }; }
  } as unknown as SettlementSimulation;
  const recorder = createBugReplayRecorder(first, "version");
  await recorder.start(async () => { expect(offers).toBe(2); return baseline; });
  const cargo = { planks: 5 };
  first.queueSeaTransport(1, 2, cargo);
  cargo.planks = 999;
  const report = recorder.report();
  replaySettlementCommands(report, second);
  expect(report.commands).toEqual([{ at: 0, name: "queueSeaTransport", args: [1, 2, { planks: 5 }], result: { ok: true } }]);
  expect(replayed).toEqual([[1, 2, { planks: 5 }]]);
  recorder.dispose();
});
it("records copied commands and replays their simulation timing without wrapping unrelated queries", async () => {
  const first = fixture(),
    second = fixture();
  const recorder = createBugReplayRecorder(first.simulation, "version");
  first.simulation.setStorageAcceptance(1, "fish", true);
  await recorder.start(async () => baseline);
  recorder.advance(0.2);
  first.simulation.update(0.2);
  expect(first.simulation.setStorageAcceptance(1, "fish", false)).toBe(true);
  recorder.advance(0.1);
  first.simulation.update(0.1);
  const report = JSON.parse(JSON.stringify(recorder.report()));
  expect(report.commands).toHaveLength(1);
  replaySettlementCommands(report, second.simulation);
  expect(second.values().accepted).toBe(false);
  expect(second.values().elapsed).toBeCloseTo(first.values().elapsed);
  recorder.dispose();
  expect(first.simulation.setStorageAcceptance(1, "fish", true)).toBe(true);
});
it("bounds the journal and refuses arbitrary methods or reversed command time", async () => {
  const { simulation } = fixture();
  const recorder = createBugReplayRecorder(simulation, "version");
  await recorder.start(async () => baseline);
  for (let index = 0; index < 520; index++) simulation.setStorageAcceptance(1, "fish", false);
  const report = recorder.report();
  expect(report.commands).toHaveLength(512);
  expect(report.limited).toBe(true);
  expect(recorder.recording()).toBe(false);
  expect(() =>
    replaySettlementCommands(
      { ...report, commands: [{ at: 0, name: "loadState", args: [] }] },
      simulation
    )
  ).toThrow("Unsupported replay command");
  expect(() =>
    replaySettlementCommands(
      { ...report, commands: [{ at: -1, name: "setStorageAcceptance", args: [] }] },
      simulation
    )
  ).toThrow("Invalid replay time");
});
it("abandons a failed baseline capture without affecting game commands", async () => {
  const { simulation } = fixture();
  const recorder = createBugReplayRecorder(simulation, "version");
  await expect(
    recorder.start(async () => {
      throw new Error("Capture failed");
    })
  ).rejects.toThrow("Capture failed");
  expect(() => recorder.report()).toThrow("Start recording");
  expect(simulation.setStorageAcceptance(1, "fish", true)).toBe(true);
});
it("journals during asynchronous compression and rejects overlapping starts", async () => {
  const { simulation } = fixture();
  const recorder = createBugReplayRecorder(simulation, "version");
  let complete!: (save: GameSaveV1) => void;
  const pending = recorder.start(() => new Promise(resolve => { complete = resolve; }));
  simulation.update(.5); recorder.advance(.5);
  simulation.setStorageAcceptance(1, "fish", false);
  await expect(recorder.start(async () => baseline)).rejects.toThrow("already recording");
  complete(baseline); await pending;
  const report = recorder.report();
  expect(report.elapsed).toBe(.5);
  expect(report.commands[0]!.at).toBe(.5);
  simulation.update(3);
  expect(recorder.report()).toEqual(report);
  report.commands.length = 0;
  expect(recorder.report().commands).toHaveLength(1);
});
it("freezes the ending after the final accepted command and does not revive a disposed recorder", async () => {
  const { simulation } = fixture();
  const recorder = createBugReplayRecorder(simulation, "version");
  await recorder.start(async () => baseline);
  for (let index = 0; index < 512; index++) simulation.setStorageAcceptance(1, "fish", false);
  simulation.update(5); simulation.setStorageAcceptance(1, "fish", true);
  expect(recorder.report().finalSettlement).toEqual({ elapsed: 0, accepted: false });
  let complete!: (save: GameSaveV1) => void;
  const pending = recorder.start(() => new Promise(resolve => { complete = resolve; }));
  recorder.dispose(); complete(baseline);
  await expect(pending).rejects.toThrow("cancelled");
  expect(recorder.recording()).toBe(false);
});
it("rejects a bad later command before executing an earlier one", async () => {
  const first = fixture();
  const recorder = createBugReplayRecorder(first.simulation, "version");
  await recorder.start(async () => baseline);
  first.simulation.setStorageAcceptance(1, "fish", false);
  const report = recorder.report(), second = fixture();
  report.commands.push({ at: 0, name: "loadState", args: [] });
  expect(() => replaySettlementCommands(report, second.simulation)).toThrow("Unsupported replay command");
  expect(second.values().accepted).toBe(true);
});
it("marks unsupported edits and retains the replayable prefix before the mutation", async () => {
  const { simulation } = fixture();
  const recorder = createBugReplayRecorder(simulation, "version");
  await recorder.start(async () => baseline);
  recorder.unsupported("Terrain editing");
  simulation.update(3);
  expect(recorder.report().gaps).toEqual(["Terrain editing"]);
  expect(recorder.report().limited).toBe(true);
  expect(recorder.report().finalSettlement).toEqual({ elapsed: 0, accepted: true });
});
it("retains the original update schedule for frame-sensitive simulation and compares command results", async () => {
  const build = () => {
    let value = 0;
    return { update: (dt: number) => { value += dt * dt; },
      setStorageAcceptance: () => value,
      saveState: () => ({ value }) } as unknown as SettlementSimulation;
  };
  const simulation = build(), replay = build(), recorder = createBugReplayRecorder(simulation, "version");
  await recorder.start(async () => baseline);
  for (const dt of [.017, .2, .033]) { simulation.update(dt); recorder.advance(dt); }
  simulation.setStorageAcceptance(0, "fish", false);
  const report = recorder.report(), differences: unknown[] = [];
  expect(replaySettlementCommands(report, replay, (_, actual) => differences.push(actual))).toEqual(report.finalSettlement);
  expect(differences).toEqual([]);
  report.commands[0]!.result = "wrong";
  replaySettlementCommands(report, build(), (_, actual) => differences.push(actual));
  expect(differences).toHaveLength(1);
});

it("captures random debug choices", async () => {
  const build = () => {
    let enemy: unknown, troop: unknown, soldier: unknown;
    return { ...fixture().simulation,
      grantDebugTroop: (choice: unknown) => { troop = choice; return choice; },
      spawnDebugEnemy: (_point: unknown, choice: unknown) => { enemy = choice; return choice; },
      spawnDebugSoldier: (_point: unknown, choice: unknown) => { soldier = choice; return choice; },
      saveState: () => ({ enemy, soldier, troop }) } as unknown as SettlementSimulation;
  };
  const simulation = build(), recorder = createBugReplayRecorder(simulation, "test");
  await recorder.start(async () => baseline);
  simulation.spawnDebugEnemy({ x: 2, z: 3 });
  simulation.grantDebugTroop();
  simulation.spawnDebugSoldier({ x: 4, z: 5 });
  const report = recorder.report();
  expect(report.commands).toHaveLength(3);
  expect(report.commands[0]!.args[1]).toMatchObject({ rank: expect.any(Number), type: expect.any(String) });
  expect(report.commands[1]).toMatchObject({ args: [{ rank: expect.any(Number), type: expect.any(String) }],
    name: "grantDebugTroop" });
  expect(report.commands[2]).toMatchObject({ args: [{ x: 4, z: 5 }, { rank: expect.any(Number),
    type: expect.any(String) }], name: "spawnDebugSoldier" });
  expect(replaySettlementCommands(report, build())).toEqual(report.finalSettlement);
});

it("records direct external military registration, recruitment and opponent orders", async () => {
  const operations: unknown[][] = [], replayed: unknown[][] = [];
  const create = (calls: unknown[][]) => ({ ...fixture().simulation,
    registerMilitaryDoor: (...args: unknown[]) => { calls.push(["door", ...args]); return true; },
    recruitStoredMilitary: (...args: unknown[]) => { calls.push(["recruit", ...args]); return 42; },
    spawnMilitaryOpponent: (...args: unknown[]) => { calls.push(["spawn", ...args]); return 43; },
    commandMilitaryOpponent: (...args: unknown[]) => { calls.push(["order", ...args]); return true; }
  }) as unknown as SettlementSimulation;
  const simulation = create(operations), recorder = createBugReplayRecorder(simulation, "version");
  await recorder.start(async () => baseline);
  simulation.registerMilitaryDoor(7, 1, 200);
  simulation.recruitStoredMilitary(1, "shield");
  simulation.spawnMilitaryOpponent({ x: 10, z: 12 }, "archer");
  simulation.commandMilitaryOpponent([43], { x: 14, z: 16 }, 1, "move");
  const report = recorder.report();
  replaySettlementCommands(report, create(replayed));
  expect(replayed).toEqual(operations);
  expect(report.commands).toHaveLength(4);
  recorder.dispose();
});

it("marks a scene limit discovered by the terminal flush instead of claiming a complete recording", async () => {
  let overflow = false;
  const scene = { begin: () => undefined, scopeToSimulation: () => undefined, stop: () => { overflow = true; },
    overflow: () => overflow, snapshot: () => [] } as unknown as
    import("../src/shared/settlement/replay-scene").ReplaySceneJournal;
  const recorder = createBugReplayRecorder(fixture().simulation, "version", undefined, scene);
  await recorder.start(async () => baseline);
  const report = recorder.report();
  expect(report.limited).toBe(true);
  expect(report.gaps).toContain("Scene observation journal limit exceeded");
  expect(recorder.report()).toEqual(report);
  recorder.dispose();
});

it("ends a stable replayable prefix before an external restore rather than silently missing it", async () => {
  const source = fixture();
  Object.assign(source.simulation, { loadState: () => {
    source.simulation.setStorageAcceptance(1, "fish", false); return { ok: true };
  } });
  const recorder = createBugReplayRecorder(source.simulation, "version");
  await recorder.start(async () => baseline);
  source.simulation.loadState({});
  const report = recorder.report();
  expect(source.values().accepted).toBe(false);
  expect(report.finalSettlement).toMatchObject({ accepted: true });
  expect(report.commands).toEqual([]);
  expect(report.limited).toBe(true);
  expect(report.gaps).toContain("External settlement restore: recording stopped before the state replacement");
  recorder.dispose();
});

preloadWorlds(SMALL_EDITOR_WORLD);
it("applies a command's external prop clearance before the next command in the same frame", async () => {
  const { createReplaySceneAdapter, createReplaySceneJournal } = await import("../src/shared/settlement/replay-scene");
  const { createRoadNetwork } = await import("../src/shared/settlement/road-network");
  const world = cachedWorld(SMALL_EDITOR_WORLD), restoredWorld = structuredClone(world);
  const scene = createReplaySceneJournal(world);
  scene.wrap({ world, roads: createRoadNetwork(world) });
  const build = (live: typeof world, clearance: boolean) => {
    let observed = false;
    return { placeBuilding: () => { if (clearance) live.props.types[0] = 255; return { ok: true }; },
      setStorageAcceptance: () => { observed = live.props.types[0] === 255; return observed; },
      update: () => undefined, saveState: () => ({ observed }) } as unknown as SettlementSimulation;
  };
  const simulation = build(world, true), recorder = createBugReplayRecorder(simulation, "version", undefined, scene);
  await recorder.start(async () => baseline);
  simulation.placeBuilding(1, 10, 10);
  expect(simulation.setStorageAcceptance(1, "logs", false)).toBe(true);
  const report = recorder.report(), adapter = createReplaySceneAdapter(restoredWorld, report.scene!);
  const differences: unknown[] = [];
  const final = replaySettlementCommands(report, build(restoredWorld, false), (_command, actual) => differences.push(actual),
    undefined, adapter.afterCommand);
  adapter.finish();
  expect(differences).toEqual([]);
  expect(final).toEqual(report.finalSettlement);
  recorder.dispose();
});
