import { describe, expect, it } from "vitest";

import { createBugReplayRecorder, replaySettlementCommands } from "../src/shared/settlement/bug-replay";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import {
  ROAD_GRID_STEP, type RoadPoint, type RoadSegment
} from "../src/shared/settlement/road-types";
import { createPlacementSession } from "./helpers/placement-session";

const VERGE_STOCK = { hammer: 4, planks: 60, stone: 60 };

const advanceUntil = (
  simulation: ReturnType<typeof createPlacementSession>["simulation"],
  done: () => boolean,
  maxSeconds = 1200
) => {
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += 0.1) {
    if (done()) return true;
    simulation.update(0.1);
  }
  return done();
};

const straightRun = (start: RoadPoint, dx: number, dz: number, count: number): RoadSegment[] =>
  Array.from({ length: count }, (_, index) => ({
    start: { x: start.x + dx * index, z: start.z + dz * index },
    end: { x: start.x + dx * (index + 1), z: start.z + dz * (index + 1) },
    tier: "dirt"
  }));

const bridgeRun = (start: RoadPoint, count = 6): RoadSegment[] =>
  straightRun(start, 0, ROAD_GRID_STEP, count).map((segment, tile) => ({
    ...segment,
    bridge: { id: 1, kind: "wood" as const, width: 2.6, tile, tiles: count }
  }));

/** Familiar island with a finished headquarters and a straight three-unit road south of it. */
const connectedSession = (clockStart?: number) => {
  const session = createPlacementSession({ initialSettlers: 12, initialStock: { ...VERGE_STOCK },
    ...(clockStart === undefined ? {} : { clockStart }) });
  const { access } = session.simulation.headquarters;
  const far = { x: access.x, z: access.z + 3 };
  expect(session.simulation.connectRoads(access, far)).toBe(true);
  return { ...session, access, far };
};

const deliveredPlanks = (
  simulation: ReturnType<typeof createPlacementSession>["simulation"]
) => simulation.roadVergeSites()[0]?.delivered.planks ?? 0;

describe("road verge planting", () => {
  it("connects new roads without an automatic plank charge", () => {
    const { simulation } = createPlacementSession();
    const { access } = simulation.headquarters;
    simulation.headquarters.inventory.planks = 0;
    expect(simulation.connectRoads(access, { x: access.x - 4, z: access.z })).toBe(true);
    expect(simulation.roadSegments().length).toBeGreaterThan(0);
    expect(simulation.resourceTotal("planks")).toBe(0);
  });

  it("prices the stretch and refuses unplantable requests", () => {
    const { roads, simulation } = createPlacementSession();
    const { access } = simulation.headquarters;
    const far = { x: access.x, z: access.z + 2 };
    expect(simulation.previewRoadVerge(access, far, "iris" as never))
      .toMatchObject({ ok: false, reason: "invalid-kind", planks: 0 });
    expect(simulation.previewRoadVerge(access, far, "flowers"))
      .toMatchObject({ ok: false, reason: "no-road" });
    expect(simulation.connectRoads(access, far)).toBe(true);
    const preview = simulation.previewRoadVerge(access, far, "flowers");
    expect(preview.ok).toBe(true);
    expect(preview.segments).toHaveLength(4);
    expect(preview.planks).toBe(4);
    // A road outside the storage network cannot receive delivered planks.
    const isolated = straightRun({ x: 70, z: 70 }, ROAD_GRID_STEP, 0, 2);
    expect(roads.replaceSegments([...roads.segments(), ...isolated])).toBe(true);
    expect(simulation.previewRoadVerge({ x: 70, z: 70 }, { x: 71, z: 70 }, "flowers"))
      .toMatchObject({ ok: false, reason: "no-storage" });
    const planted = roads.segments().map(segment => ({ ...segment, verge: "flowers" as const }));
    expect(roads.replaceSegments(planted)).toBe(true);
    expect(simulation.previewRoadVerge(access, far, "flowers"))
      .toMatchObject({ ok: false, reason: "nothing-to-plant" });
  });

  it("delivers planks by carrier and plants only the ordered stretch", () => {
    const { access, far, simulation } = connectedSession();
    expect(simulation.previewRoadVerge(access, far, "flowers")).toMatchObject({ ok: true, planks: 6 });
    const result = simulation.plantRoadVerge(access, far, "flowers");
    if (!result.ok) throw new Error(result.reason);
    const site = simulation.roadVergeSites()[0]!;
    expect(site).toMatchObject({
      siteUid: result.siteUid,
      kind: "flowers",
      progress: 0,
      required: { planks: 6 }
    });
    expect(simulation.buildings().some(building => building.vergeSite)).toBe(false);
    let sawDelivery = false;
    const complete = advanceUntil(simulation, () => {
      sawDelivery ||= deliveredPlanks(simulation) > 0;
      return simulation.roadVergeSites().length === 0;
    });
    expect(complete).toBe(true);
    expect(sawDelivery).toBe(true);
    expect(simulation.roadSegments().every(segment => segment.verge === "flowers")).toBe(true);
    expect(simulation.previewRoadVerge(access, far, "flowers"))
      .toMatchObject({ ok: false, reason: "nothing-to-plant" });
  });

  it("refunds delivered planks when the order is cancelled", () => {
    const { access, far, simulation } = connectedSession();
    expect(simulation.plantRoadVerge(access, far, "flowers").ok).toBe(true);
    expect(advanceUntil(simulation, () => deliveredPlanks(simulation) > 0)).toBe(true);
    const site = simulation.roadVergeSites()[0]!;
    const before = simulation.resourceTotal("planks");
    expect(simulation.cancelRoadVerge(site.siteUid)).toBe(true);
    expect(simulation.roadVergeSites()).toEqual([]);
    expect(simulation.resourceTotal("planks")).toBe(before + (site.delivered.planks ?? 0));
    expect(simulation.roadSegments().some(segment => segment.verge)).toBe(false);
    expect(simulation.cancelRoadVerge(site.siteUid)).toBe(false);
  });

  it("finds the nearest running order for the remove tool and nothing far away", () => {
    const { access, far, simulation } = connectedSession();
    expect(simulation.nearestRoadVergeSite(access)).toBeNull();
    expect(simulation.plantRoadVerge(access, far, "flowers").ok).toBe(true);
    const site = simulation.roadVergeSites()[0]!;
    const middle = site.segments[Math.floor(site.segments.length / 2)]!;
    expect(simulation.nearestRoadVergeSite(middle.start)?.siteUid).toBe(site.siteUid);
    expect(simulation.nearestRoadVergeSite({ x: access.x + 40, z: access.z })).toBeNull();
  });

  it("refuses a stretch another order is already planting", () => {
    const { access, far, simulation } = connectedSession();
    expect(simulation.plantRoadVerge(access, far, "flowers").ok).toBe(true);
    expect(simulation.previewRoadVerge(access, far, "flowers"))
      .toMatchObject({ ok: false, reason: "busy" });
    const middle = { x: access.x, z: access.z + 1.5 };
    expect(simulation.previewRoadVerge(access, middle, "flowers"))
      .toMatchObject({ ok: false, reason: "busy" });
  });

  it("skips bridge tiles and refuses a stretch with nothing left to plant", () => {
    const { roads, simulation } = connectedSession();
    const { access } = simulation.headquarters;
    const bridgeStart = { x: access.x, z: access.z + 4 };
    expect(simulation.connectRoads(access, bridgeStart)).toBe(true);
    const ordinaryEdges = simulation.roadSegments().length;
    const bridgeEnd = { x: bridgeStart.x, z: bridgeStart.z + 3 };
    expect(roads.replaceSegments([...roads.segments(), ...bridgeRun(bridgeStart),
      ...straightRun(bridgeEnd, 0, ROAD_GRID_STEP, 1)])).toBe(true);
    const afterEnd = { x: bridgeEnd.x, z: bridgeEnd.z + ROAD_GRID_STEP };
    const preview = simulation.previewRoadVerge(access, afterEnd, "flowers");
    expect(preview.ok).toBe(true);
    expect(preview.segments).toHaveLength(ordinaryEdges + 1);
    expect(preview.planks).toBe(ordinaryEdges + 1);
    expect(simulation.previewRoadVerge(bridgeStart, bridgeEnd, "flowers"))
      .toMatchObject({ ok: false, reason: "nothing-to-plant" });
  });

  it("saves and restores a running order, then persists the planted stretch", () => {
    const first = connectedSession();
    expect(first.simulation.plantRoadVerge(first.access, first.far, "flowers").ok).toBe(true);
    expect(advanceUntil(first.simulation, () => {
      const site = first.simulation.roadVergeSites()[0];
      return !!site && site.progress > 0 && (site.delivered.planks ?? 0) > 0;
    })).toBe(true);
    const before = first.simulation.roadVergeSites()[0]!;
    const planterUids = (simulation: typeof first.simulation) => simulation.saveState().actors
      .filter(actor => actor.job === "Builder" && actor.building === before.siteUid)
      .map(actor => actor.uid).sort((left, right) => left - right);
    expect(planterUids(first.simulation).length).toBeGreaterThan(0);
    const saved = first.simulation.saveState();

    const restored = createPlacementSession({ initialSettlers: 12, initialStock: { ...VERGE_STOCK } });
    const loaded = restored.simulation.loadState(saved);
    expect(loaded.ok, loaded.ok ? "" : loaded.reason).toBe(true);
    const after = restored.simulation.roadVergeSites()[0]!;
    expect(after.siteUid).toBe(before.siteUid);
    expect(after.progress).toBeCloseTo(before.progress, 8);
    expect(after.delivered).toEqual(before.delivered);
    expect(after.required).toEqual({ planks: 6 });
    expect(after.stockPoint).toEqual(before.stockPoint);
    expect(after.segments).toEqual(before.segments);
    expect(planterUids(restored.simulation)).toEqual(planterUids(first.simulation));
    expect(advanceUntil(restored.simulation, () => restored.simulation.roadVergeSites().length === 0)).toBe(true);
    expect(restored.simulation.roadSegments().every(segment => segment.verge === "flowers")).toBe(true);
    const savedAgain = restored.simulation.saveState();
    const reloaded = createPlacementSession({ initialSettlers: 12, initialStock: { ...VERGE_STOCK } });
    expect(reloaded.simulation.loadState(savedAgain).ok).toBe(true);
    expect(reloaded.simulation.roadSegments().every(segment => segment.verge === "flowers")).toBe(true);
  });

  it("rejects a saved verge order with an unknown kind or a mismatched cost", () => {
    const first = connectedSession();
    expect(first.simulation.plantRoadVerge(first.access, first.far, "flowers").ok).toBe(true);
    const saved = first.simulation.saveState();
    type SavedShell = { required: Record<string, number>; vergeSite?: { kind: string } };
    const shellsOf = (value: ReturnType<typeof first.simulation.saveState>) =>
      value.buildings as unknown as SavedShell[];
    const wrongKind = structuredClone(saved);
    shellsOf(wrongKind).find(building => building.vergeSite)!.vergeSite!.kind = "iris";
    const wrongCost = structuredClone(saved);
    shellsOf(wrongCost).find(building => building.vergeSite)!.required.planks = 999;
    expect(createPlacementSession().simulation.loadState(wrongKind)).toMatchObject({ ok: false });
    expect(createPlacementSession().simulation.loadState(wrongCost)).toMatchObject({ ok: false });
  });

  it("keeps the planted kind through an upgrade and drops it with the removed segment", () => {
    const { access, far, simulation } = connectedSession();
    expect(simulation.plantRoadVerge(access, far, "flowers").ok).toBe(true);
    expect(advanceUntil(simulation, () => simulation.roadVergeSites().length === 0)).toBe(true);
    expect(simulation.upgradeRoad(access, far, "stone")).toBe(true);
    expect(simulation.roadSegments().every(segment =>
      segment.tier === "stone" && segment.verge === "flowers")).toBe(true);
    const removed = simulation.roadSegments().at(-1)!;
    expect(simulation.removeRoad(removed.start, removed.end)).toBe(true);
    expect(simulation.roadSegments()).toHaveLength(5);
    expect(simulation.roadSegments().every(segment => segment.verge === "flowers")).toBe(true);
  });

  it("finishes the remaining edges when one ordered segment disappears mid-job", () => {
    const { access, far, simulation } = connectedSession();
    expect(simulation.plantRoadVerge(access, far, "flowers").ok).toBe(true);
    expect(advanceUntil(simulation, () => deliveredPlanks(simulation) > 0)).toBe(true);
    const removed = simulation.roadSegments().at(-1)!;
    expect(simulation.removeRoad(removed.start, removed.end)).toBe(true);
    expect(advanceUntil(simulation, () => simulation.roadVergeSites().length === 0)).toBe(true);
    expect(simulation.roadSegments()).toHaveLength(5);
    expect(simulation.roadSegments().every(segment => segment.verge === "flowers")).toBe(true);
  });

  it("replays a recorded plant and cancel sequence to the same state", async () => {
    const recorded = connectedSession(0);
    const recorder = createBugReplayRecorder(recorded.simulation, "verge-planting-test");
    await recorder.start(async () => ({ format: "island-settlers-game", version: 4 }) as GameSaveV1);
    const run = (ticks: number) => {
      for (let tick = 0; tick < ticks; tick++) {
        recorded.simulation.update(.05);
        recorder.advance(.05);
      }
    };
    const planted = recorded.simulation.plantRoadVerge(recorded.access, recorded.far, "flowers");
    if (!planted.ok) throw new Error(planted.reason);
    // Long enough for a carrier to bring the first plank to the middle road node.
    run(400);
    const shell = recorded.simulation.saveState().buildings.find(building => building.vergeSite);
    expect(shell?.input.planks ?? 0).toBeGreaterThan(0);
    expect(recorded.simulation.cancelRoadVerge(planted.siteUid)).toBe(true);
    run(40);
    const report = recorder.report();
    recorder.dispose();
    expect(report.commands.map(command => command.name)).toEqual(["plantRoadVerge", "cancelRoadVerge"]);

    const replayed = connectedSession(0);
    replaySettlementCommands(report, replayed.simulation);
    expect(replayed.simulation.saveState()).toEqual(recorded.simulation.saveState());
  });

  it("cancels and refunds when the whole ordered stretch is removed", () => {
    const { access, far, roads, simulation } = connectedSession();
    expect(simulation.plantRoadVerge(access, far, "flowers").ok).toBe(true);
    expect(advanceUntil(simulation, () => deliveredPlanks(simulation) > 0)).toBe(true);
    const site = simulation.roadVergeSites()[0]!;
    const before = simulation.resourceTotal("planks");
    expect(roads.replaceSegments([])).toBe(true);
    simulation.update(0.1);
    expect(simulation.roadVergeSites()).toEqual([]);
    expect(simulation.resourceTotal("planks")).toBeGreaterThanOrEqual(
      before + (site.delivered.planks ?? 0));
  });
});
