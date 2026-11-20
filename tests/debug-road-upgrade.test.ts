import { ROAD_SPEED } from "@shared/catalog/balance";
import { describe, expect, it, vi } from "vitest";

import { createSettlementDebugActions } from "../src/app/settlement/settlement-debug-actions";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { ROAD_TIERS } from "../src/shared/settlement/road-types";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const island = (save?: SettlementSaveV1) => {
  const size = 96;
  const world = { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
  const roads = createRoadNetwork(world, { isBlocked: () => false, verifyRouteCache: 1 });
  const simulation = createSettlementSimulation({ clockStart: 0, initialSettlers: 20, initialStock: {},
    resourceTargets: () => [], roads, world });
  if (save) expect(simulation.loadState(save).ok).toBe(true);
  return { roads, simulation };
};

const mixed = () => {
  const result = island();
  result.roads.replaceSegments(ROAD_TIERS.map((tier, index) => ({ tier,
    start: { x: 8 + index * .5, z: 8 }, end: { x: 8.5 + index * .5, z: 8 } })).concat([
    { tier: "dirt", start: { x: 80, z: 80 }, end: { x: 80.5, z: 80 } }
  ]));
  return result;
};

describe("owned public road debug upgrade", () => {
  it("raises each mixed-tier owned edge once, keeps granite and foreign roads, and spends nothing", () => {
    const { roads, simulation } = mixed();
    const before = simulation.saveState(), revision = roads.revision;
    expect(simulation.debugUpgradeRoads()).toEqual({ upgraded: 5 });
    expect(roads.segments().map(segment => segment.tier)).toEqual([
      "stone", "marble", "limestone", "basalt", "granite", "granite", "dirt"
    ]);
    expect(roads.revision).toBe(revision + 1);
    const after = simulation.saveState();
    expect(after.navigationRevisions?.roads).toBe(revision + 1);
    expect({ ...after, navigationRevisions: before.navigationRevisions, roads: before.roads }).toEqual(before);
    expect(island(after).roads.segments()).toEqual(roads.segments());
    expect(simulation.debugUpgradeRoads().upgraded).toBe(4);
  });

  it("invalidates cached routes once and keeps live speed and connectivity consistent", () => {
    const { roads, simulation } = island();
    const start = { x: 8, z: 8 }, end = { x: 11, z: 8 };
    expect(roads.addRoad(start, end)).toBe(true);
    expect(roads.route(start, end)?.cost).toBe(3);
    expect(roads.route(start, end)?.cost).toBe(3);
    expect(simulation.debugUpgradeRoads().upgraded).toBe(6);
    expect(roads.route(start, end)?.cost).toBeCloseTo(3 / ROAD_SPEED.stone);
    expect(roads.speedAt({ x: 9, z: 8 })).toBe(ROAD_SPEED.stone);
    expect(roads.route(start, end)?.length).toBe(3);
    const revision = roads.revision;
    expect(roads.raiseTiersWhere(() => false)).toBe(0);
    expect(roads.revision).toBe(revision);
  });

  it("rejects a crossing edge and does not grant ownership around an enemy headquarters", () => {
    const { roads, simulation } = island();
    simulation.buildings().push({ ...simulation.headquarters, uid: 2, x: 80, z: 80, militaryFaction: 1 });
    const start = { x: 55.5, z: 8 }, end = { x: 56, z: 8 };
    expect(simulation.ownsTerritory(start)).toBe(true);
    expect(simulation.ownsTerritory(end)).toBe(false);
    expect(simulation.ownsTerritory({ x: 80, z: 80 })).toBe(false);
    roads.replaceSegments([{ start, end, tier: "dirt" },
      { start: { x: 80, z: 80 }, end: { x: 80.5, z: 80 }, tier: "basalt" }]);
    const before = roads.segments(), revision = roads.revision;
    expect(simulation.debugUpgradeRoads()).toEqual({ upgraded: 0 });
    expect(roads.segments()).toEqual(before);
    expect(roads.revision).toBe(revision);
  });

  it("journals one canonical click and deterministically replays its exact saved result", () => {
    const { simulation } = mixed(), base = simulation.saveState();
    simulation.loadState(base);
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "road-upgrade-test" });
    recorder.open();
    simulation.debugUpgradeRoads();
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command)).toMatchObject([{ name: "debugUpgradeRoads", args: [] }]);
    const replay = island(base);
    expect(replayCommandLog(replay.simulation, interval, { rejectDebug: false }).ok).toBe(true);
    expect(replay.simulation.saveState()).toEqual(simulation.saveState());
    expect(replayCommandLog(island(base).simulation, interval)).toMatchObject({ ok: false,
      mismatch: { kind: "invalid", reason: "Rejected command debugUpgradeRoads" } });
    const malformed = structuredClone(interval);
    malformed.entries[0]!.command.args = [1];
    expect(replayCommandLog(island(base).simulation, malformed, { rejectDebug: false })).toMatchObject({ ok: false,
      mismatch: { kind: "invalid", reason: "Road debug upgrade accepts no arguments" } });
    expect(() => Reflect.apply(simulation.debugUpgradeRoads, simulation, [1])).toThrow("no arguments");
    recorder.dispose();
  });

  it("denies nonadmin actions and invokes exactly one command for an authorized click", () => {
    const { simulation } = mixed(), command = vi.spyOn(simulation, "debugUpgradeRoads"), message = vi.fn();
    const updateUi = vi.fn();
    const context = { buildingName: () => "building", completed: new Set<number>(), message, simulation, updateUi };
    createSettlementDebugActions({ ...context, allowed: false }).upgradeOwnedRoads();
    expect(command).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalledWith(expect.any(String), true);
    createSettlementDebugActions({ ...context, allowed: true }).upgradeOwnedRoads();
    expect(command).toHaveBeenCalledTimes(1);
    expect(updateUi).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenLastCalledWith("Upgraded 5 owned road segments by one tier.");
  });
});
