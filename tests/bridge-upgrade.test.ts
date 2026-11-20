import { describe, expect, it } from "vitest";

import { bridgeSiteProblem } from "../src/shared/settlement/bridge-construction";
import { bridgeRoadProblem } from "../src/shared/settlement/bridge-road";
import { bridgeUpgradeCost, bridgeUpgradeMaterial } from "../src/shared/settlement/bridge-upgrade";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { createBridgeCrossingSettlement,CROSSING_BRIDGE_ID } from "./helpers/bridge-crossing-settlement";

type Crossing = ReturnType<typeof createBridgeCrossingSettlement>;

const TIER_STOCK = { cedarPlanks: 4, granite: 4, hardwoodPlanks: 4, limestone: 4, mahoganyPlanks: 4,
  marble: 4, walnutPlanks: 4, basalt: 4 };

const advanceUntil = (fixture: Crossing, done: () => boolean, seconds = 600) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
    if (done()) return true;
    fixture.simulation.update(0.1);
  }
  return done();
};

const bridge = (fixture: Crossing) => fixture.simulation.bridges().find(entry => entry.id === CROSSING_BRIDGE_ID)!;
const stock = (fixture: Crossing, ware: string) => fixture.simulation.headquarters.inventory[ware] ?? 0;

describe("bridge upgrade materials", () => {
  it("costs two units of the target level's tier material: planks for wood, stone for stone", () => {
    expect(["wood", "stone"].map(kind => [0, 1, 2, 3].map(level =>
      bridgeUpgradeMaterial(kind as "wood" | "stone", level)))).toEqual([
      ["hardwoodPlanks", "cedarPlanks", "walnutPlanks", "mahoganyPlanks"],
      ["marble", "limestone", "basalt", "granite"]
    ]);
    expect(bridgeUpgradeCost("wood", 2)).toEqual({ walnutPlanks: 2 });
    expect(bridgeUpgradeCost("stone", 4)).toEqual({});
  });
});

describe("upgrading a bridge", () => {
  it("refuses without the tier material, then delivers it and raises the level with the bridge open", () => {
    const poor = createBridgeCrossingSettlement("wood");
    expect(poor.simulation.bridgeUpgradeAvailability(CROSSING_BRIDGE_ID)).toEqual({ available: false,
      cost: { hardwoodPlanks: 2 }, reason: "missing-material", supply: { hardwoodPlanks: 0 } });
    expect(poor.simulation.requestBridgeUpgrade(CROSSING_BRIDGE_ID)).toEqual({ ok: false, reason: "missing-material" });

    const fixture = createBridgeCrossingSettlement("wood", TIER_STOCK);
    const { roads, simulation } = fixture;
    expect(simulation.bridgeUpgradeAvailability(CROSSING_BRIDGE_ID).available).toBe(true);
    const requested = simulation.requestBridgeUpgrade(CROSSING_BRIDGE_ID);
    expect(requested.ok).toBe(true);
    const site = bridge(fixture).site!;
    expect(site.upgrade).toEqual({ level: 1 });
    expect(site.required).toEqual({ hardwoodPlanks: 2 });
    expect(bridgeSiteProblem(site)).toBeNull();
    expect(simulation.bridgeUpgradeAvailability(CROSSING_BRIDGE_ID).reason).toBe("busy");
    expect(simulation.cancelBridgeConstruction(CROSSING_BRIDGE_ID)).toBe(false);
    // The bridge stays open for traffic during the refit.
    expect(roads.route(fixture.westAnchor, fixture.eastAnchor)).not.toBeNull();
    expect(advanceUntil(fixture, () => bridge(fixture).site === undefined)).toBe(true);
    expect(bridge(fixture)).toMatchObject({ completed: true, level: 2 });
    const tiles = simulation.roadSegments().filter(segment => segment.bridge);
    expect(tiles.every(segment => segment.bridge!.level === 1)).toBe(true);
    expect(bridgeRoadProblem(tiles)).toBeNull();
    expect(stock(fixture, "hardwoodPlanks")).toBe(2);
    expect(roads.route(fixture.westAnchor, fixture.eastAnchor)).not.toBeNull();
    expect(simulation.bridgeUpgradeAvailability(CROSSING_BRIDGE_ID).cost).toEqual({ cedarPlanks: 2 });
  });

  it("climbs a stone bridge to level 5 with marble, limestone, basalt and granite, then stops", () => {
    const fixture = createBridgeCrossingSettlement("stone", TIER_STOCK);
    for (const [index, ware] of ["marble", "limestone", "basalt", "granite"].entries()) {
      expect(fixture.simulation.bridgeUpgradeAvailability(CROSSING_BRIDGE_ID).cost).toEqual({ [ware]: 2 });
      expect(fixture.simulation.requestBridgeUpgrade(CROSSING_BRIDGE_ID).ok).toBe(true);
      expect(advanceUntil(fixture, () => bridge(fixture).site === undefined)).toBe(true);
      expect(bridge(fixture).level).toBe(index + 2);
      expect(stock(fixture, ware)).toBe(2);
    }
    expect(fixture.simulation.bridgeUpgradeAvailability(CROSSING_BRIDGE_ID))
      .toEqual({ available: false, cost: {}, reason: "max-level", supply: {} });
  });

  it("returns delivered stock when the upgrade is cancelled or the bridge is removed", () => {
    for (const action of ["cancel", "remove"] as const) {
      const fixture = createBridgeCrossingSettlement("wood", TIER_STOCK);
      const { simulation } = fixture;
      expect(simulation.requestBridgeUpgrade(CROSSING_BRIDGE_ID).ok).toBe(true);
      expect(advanceUntil(fixture, () => (bridge(fixture).site?.delivered.hardwoodPlanks ?? 0) > 0)).toBe(true);
      const consumed = bridge(fixture).site!.consumed.hardwoodPlanks ?? 0;
      if (action === "cancel") expect(simulation.cancelBridgeUpgrade(CROSSING_BRIDGE_ID)).toBe(true);
      else expect(simulation.removeBridge(CROSSING_BRIDGE_ID)).toEqual({ completed: true, ok: true, site: true });
      expect(advanceUntil(fixture, () => !simulation.frames().some(actor => actor.ware === "hardwoodPlanks"), 120))
        .toBe(true);
      expect(stock(fixture, "hardwoodPlanks"), action).toBe(4 - consumed);
      expect(simulation.bridges().some(entry => entry.site)).toBe(false);
      expect(simulation.roadSegments().some(segment => segment.bridge), action).toBe(action === "cancel");
    }
  });

  it("saves and resumes an upgrade, and replays it to the same checksum", () => {
    const live = createBridgeCrossingSettlement("wood", TIER_STOCK);
    const base = live.simulation.saveState();
    const recorder = createCommandLogRecorder(live.simulation, { sourceVersion: "bridge-panel" });
    recorder.open();
    expect(live.simulation.requestBridgeUpgrade(CROSSING_BRIDGE_ID).ok).toBe(true);
    live.advance(8);
    const saved = JSON.parse(JSON.stringify(live.simulation.saveState()));
    const restored = createBridgeCrossingSettlement("wood", TIER_STOCK);
    const loaded = restored.simulation.loadState(saved);
    expect(loaded.ok, loaded.ok ? "" : loaded.reason).toBe(true);
    expect(bridge(restored).site?.upgrade).toEqual({ level: 1 });
    expect(advanceUntil(restored, () => bridge(restored).site === undefined)).toBe(true);
    expect(bridge(restored).level).toBe(2);

    live.advance(10);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name)).toContain("requestBridgeUpgrade");
    const replay = createBridgeCrossingSettlement("wood", TIER_STOCK);
    expect(replay.simulation.loadState(base).ok).toBe(true);
    expect(replayCommandLog(replay.simulation, interval, { rejectDebug: false }))
      .toEqual({ ok: true, endChecksum: interval.endChecksum });
    recorder.dispose();
  });

  it("refuses a saved upgrade site whose bridge is missing or at another level", () => {
    const fixture = createBridgeCrossingSettlement("wood", TIER_STOCK);
    expect(fixture.simulation.requestBridgeUpgrade(CROSSING_BRIDGE_ID).ok).toBe(true);
    const saved = JSON.parse(JSON.stringify(fixture.simulation.saveState()));
    const withoutBridge = { ...saved, roads: saved.roads.filter((segment: { bridge?: unknown }) => !segment.bridge) };
    expect(createBridgeCrossingSettlement().simulation.loadState(withoutBridge))
      .toEqual({ ok: false, reason: "Bridge upgrade has no matching bridge" });
    const raised = { ...saved, roads: saved.roads.map((segment: { bridge?: object }) =>
      segment.bridge ? { ...segment, bridge: { ...segment.bridge, level: 2 } } : segment) };
    expect(createBridgeCrossingSettlement().simulation.loadState(raised))
      .toEqual({ ok: false, reason: "Bridge upgrade has no matching bridge" });
  });
});
