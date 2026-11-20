import { describe, expect, it } from "vitest";

import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { createSeaMask } from "../src/shared/settlement/settlement-sea-navigation";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 64, heights = new Float32Array((size + 1) ** 2).fill(-3);
  for (let z = 0; z <= size; z++) for (let x = 0; x <= 22; x++) heights[z * (size + 1) + x] = 1;
  const world = { seed: 1, cellsX: size, cellsZ: size, seaLevel: 0, start: { x: 8, z: 8 }, heights,
    blocking: new Uint8Array(size ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ clockStart: 0, initialSettlers: 20, initialStock: {},
    resourceTargets: () => [], roads, world });
  return { simulation, world };
};

describe("admin exact-click real ship placement", () => {
  it("refuses land, shallow draft, shore, map edges and nonfinite coordinates without allocating a ship", () => {
    const { simulation, world } = fixture();
    for (let z = 28; z <= 36; z++) for (let x = 42; x <= 50; x++) world.heights[z * 65 + x] = -.1;
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    for (const point of [{ x: 10, z: 30 }, { x: 23.5, z: 20 }, { x: 46, z: 32 },
      { x: -1, z: 20 }, { x: 64, z: 20 }, { x: 63.5, z: 20 }, { x: NaN, z: 20 }, { x: 40, z: Infinity }])
      expect(simulation.spawnDebugShip(point).ok).toBe(false);
    expect(simulation.ships()).toHaveLength(0);
    expect(simulation.spawnDebugShip({ x: 35.25, z: 18.75 })).toEqual({ ok: true, id: 1 });
  });

  it("rejects a centre-wet narrow channel using full hull and turning clearance", () => {
    const { world } = fixture();
    world.heights.fill(1);
    for (let z = 0; z <= 64; z++) for (let x = 30; x <= 34; x++) world.heights[z * 65 + x] = -3;
    const sea = createSeaMask(world);
    expect(sea[30 * 64 + 32]).toBe(1);
    const context = { options: { world }, actors: [], buildings: [] } as unknown as SettlementContext;
    const fleet = createNavalFleet(context, sea);
    expect(fleet.spawnDebugShip({ x: 32.5, z: 30.5 })).toEqual({ ok: false, reason: "clearance" });
    expect(fleet.snapshot()).toHaveLength(0);
  });

  it("keeps exact coordinates and refuses overlapping live and reserved construction hulls", () => {
    const { world } = fixture();
    const context = { options: { world }, actors: [], buildings: [] } as unknown as SettlementContext;
    const fleet = createNavalFleet(context, createSeaMask(world), undefined,
      () => [{ x: 48, z: 45, yaw: Math.PI / 2 }]);
    expect(fleet.spawnDebugShip({ x: 48, z: 45 })).toEqual({ ok: false, reason: "occupied" });
    expect(fleet.spawnDebugShip({ x: 37.25, z: 20.75 })).toEqual({ ok: true, id: 1 });
    expect(fleet.spawnDebugShip({ x: 39.25, z: 25.75 })).toEqual({ ok: false, reason: "occupied" });
    expect(fleet.saveState().ships[0]).toMatchObject({ x: 37.25, z: 20.75, yaw: 0, phase: "idle", cargo: {} });
    expect(fleet.saveState().ships[0]?.visitor).toBeUndefined();
  });

  it("protects a sailing vessel's reserved endpoint and refreshes draft after terrain changes", () => {
    const { world } = fixture();
    const context = { options: { world }, actors: [], buildings: [] } as unknown as SettlementContext;
    const fleet = createNavalFleet(context, createSeaMask(world));
    fleet.addShip({ x: 40, z: 20 });
    const moving = fleet.saveState().ships[0]!;
    moving.phase = "sailing"; moving.route = [{ x: 40, z: 45 }];
    expect(fleet.spawnDebugShip({ x: 40, z: 45 })).toEqual({ ok: false, reason: "occupied" });
    for (let z = 40; z <= 50; z++) for (let x = 48; x <= 58; x++) world.heights[z * 65 + x] = -.1;
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    expect(fleet.spawnDebugShip({ x: 53, z: 45 })).toEqual({ ok: false, reason: "water" });
  });

  it("saves a real owned fleet ship and replays the recorded command only with admin debug authority", () => {
    const { simulation } = fixture();
    const base = structuredClone(simulation.saveState());
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    recorder.open();
    expect(simulation.spawnDebugShip({ x: 40.25, z: 20.75 })).toEqual({ ok: true, id: 1 });
    expect(simulation.spawnDebugShip({ x: 41, z: 20 })).toEqual({ ok: false, reason: "occupied" });
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name)).toEqual(["spawnDebugShip", "spawnDebugShip"]);
    const replay = fixture().simulation;
    expect(replay.loadState(base)).toEqual({ ok: true });
    expect(replayCommandLog(replay, interval, { rejectDebug: false })).toEqual({ ok: true,
      endChecksum: interval.endChecksum });
    expect(replayCommandLog(fixture().simulation, interval)).toMatchObject({ ok: false,
      mismatch: { kind: "invalid", reason: "Rejected command spawnDebugShip" } });
    const saved = structuredClone(simulation.saveState()), restored = fixture().simulation;
    expect(restored.loadState(saved)).toEqual({ ok: true });
    expect(restored.ships()).toEqual(simulation.ships());
    expect(restored.spawnDebugShip({ x: 40, z: 44 })).toEqual({ ok: true, id: 2 });
    recorder.dispose();
  });
});
