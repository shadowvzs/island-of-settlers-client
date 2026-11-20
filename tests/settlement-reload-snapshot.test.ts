import { describe, expect, it, vi } from "vitest";

import { createHeldFrameJobs } from "../src/app/settlement/held-frame-jobs";
import type { IslandSettlement } from "../src/app/settlement/island-settlement";
import { queueSnapshotReload } from "../src/app/settlement/snapshot-reload";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { WOODCUTTER_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const playedIsland = () => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ initialSettlers: 12, roads, world });
  const [width, depth] = getBuildingDefinition(WOODCUTTER_TYPE_ID).gridFootprint;
  const placed = simulation.placeBuilding(WOODCUTTER_TYPE_ID, 34 + width / 2, 30 + depth / 2);
  expect(placed.ok).toBe(true);
  simulation.connectRoads(simulation.headquarters.access, placed.building!.access);
  for (let tick = 0; tick < 200; tick++) simulation.update(.05);
  return { roads, simulation, world };
};

describe("in-place snapshot reload (D3)", () => {
  it("restores the island's own snapshot without renewing its navigation or road caches", () => {
    const { roads, simulation, world } = playedIsland();
    const revisions = () => [simulation.navigationRevision(), roads.revision, world.buildRevision];
    const before = revisions(), snapshot = simulation.saveState();
    expect(simulation.reloadSnapshot(snapshot)).toEqual({ ok: true });
    expect(revisions()).toEqual(before);
    expect(simulation.saveState()).toEqual(snapshot);
  });

  it("still renews the caches when a load really changes the island", () => {
    const { roads, simulation } = playedIsland();
    const snapshot = simulation.saveState(), navigation = simulation.navigationRevision();
    expect(simulation.loadState({ ...snapshot, roads: [] })).toEqual({ ok: true });
    expect(simulation.navigationRevision()).toBeGreaterThan(navigation);
    const revision = roads.revision;
    expect(simulation.loadState(snapshot)).toEqual({ ok: true });
    expect(roads.revision).toBeGreaterThan(revision);
  });

  it("reloads a captured snapshot in the next frame, which does not tick; a recording keeps playing", () => {
    const { simulation } = playedIsland();
    const jobs = createHeldFrameJobs(() => false), recording = { value: true };
    const settlement = { bugReplay: { recording: () => recording.value }, simulation } as unknown as IslandSettlement;
    queueSnapshotReload(settlement, jobs, simulation.saveState());
    expect(jobs.holding()).toBe(false);
    recording.value = false;
    const reload = vi.spyOn(simulation, "reloadSnapshot");
    const snapshot = simulation.saveState();
    queueSnapshotReload(settlement, jobs, snapshot);
    expect(jobs.frameSeconds(.016)).toBe(0);
    expect(reload).toHaveBeenCalledWith(snapshot);
    expect(simulation.saveState()).toEqual(snapshot);
    expect(jobs.frameSeconds(.016)).toBeCloseTo(.032);
  });

  it("takes ownership only when persistence already copied the captured settlement", () => {
    const { simulation } = playedIsland();
    const jobs = createHeldFrameJobs(() => false);
    const settlement = { bugReplay: { recording: () => false }, simulation } as unknown as IslandSettlement;
    const reload = vi.spyOn(simulation, "reloadSnapshot");
    const snapshot = simulation.saveState();
    queueSnapshotReload(settlement, jobs, snapshot, undefined, undefined, () => true);
    jobs.frameSeconds(.016);
    expect(reload).toHaveBeenCalledWith(snapshot, true);
    expect(simulation.saveState()).toEqual(snapshot);
  });
});
