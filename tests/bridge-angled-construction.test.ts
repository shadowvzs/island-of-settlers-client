import { describe, expect, it } from "vitest";

import { bridgeSiteProblem } from "../src/shared/settlement/bridge-construction";
import { bridgeDecks, deckPoint } from "../src/shared/settlement/bridge-deck";
import { bridgeLatticeSpan } from "../src/shared/settlement/bridge-lattice";
import { bridgeDeckGroundClear, roadPlanCrossesBridgeSite } from "../src/shared/settlement/bridge-placement-conflicts";
import { bridgeRoadProblem } from "../src/shared/settlement/bridge-road";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { bridgeCost } from "../src/shared/settlement/road-types";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BLOCKING } from "../src/shared/world/world-data";
import { ANGLED_RIVER, createAngledBridgeSettlement } from "./helpers/bridge-settlement";
import { riverCentreDistance } from "./helpers/bridge-world";

type Fixture = ReturnType<typeof createAngledBridgeSettlement>;

const advanceUntil = (fixture: Fixture, done: () => boolean, maxSeconds = 1200) => {
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += 0.1) {
    if (done()) return true;
    fixture.simulation.update(0.1);
  }
  return done();
};

const delivered = (goods: Record<string, number>) => Object.values(goods).reduce((sum, count) => sum + count, 0);

describe("angled bridge construction", () => {
  it("previews both golden shore anchors of an angled span and refuses until both shores have roads", () => {
    const unconnected = createAngledBridgeSettlement({ eastRoad: false });
    const missing = unconnected.simulation.previewBridge(unconnected.pointer, "wood", unconnected.westAnchor);
    expect(missing).toMatchObject({ ok: false, reason: "shore-road-missing",
      connections: { start: true, end: false, stock: true } });

    const { eastAnchor, pointer, simulation, westAnchor } = createAngledBridgeSettlement();
    const preview = simulation.previewBridge(pointer, "stone", westAnchor);
    expect(preview.ok).toBe(true);
    expect(preview.connections).toEqual({ start: true, end: true, stock: true });
    const plan = preview.plan!;
    expect(plan.start).toEqual(westAnchor);
    expect(plan.end).toEqual(eastAnchor);
    expect(plan.start.x !== plan.end.x && plan.start.z !== plan.end.z).toBe(true);
    expect(plan.tiles).toBe(bridgeLatticeSpan(plan.start, plan.end)!.tiles);
    expect(plan.cost).toEqual(bridgeCost("stone", plan.tiles));
  });

  it("treats building plots, blocking props and cliffs on the bank under a deck as obstructions", () => {
    const { world } = createAngledBridgeSettlement();
    const occupied = new Uint8Array(world.cellsX * world.cellsZ);
    const context = { occupied, options: { world } } as unknown as SettlementContext;
    const point = { x: 3.5, z: 3.5 }, cell = 3 * world.cellsX + 3;
    expect(bridgeDeckGroundClear(context, point)).toBe(true);
    occupied[cell] = 1;
    expect(bridgeDeckGroundClear(context, point)).toBe(false);
    occupied[cell] = 0;
    world.blocking[cell] = BLOCKING.prop;
    expect(bridgeDeckGroundClear(context, point)).toBe(false);
    world.blocking[cell] = BLOCKING.cliff;
    expect(bridgeDeckGroundClear(context, point)).toBe(false);
    world.blocking[cell] = BLOCKING.water;
    expect(bridgeDeckGroundClear(context, point)).toBe(true);
  });

  it("refuses an angled crossing where a prop or a cliff stands on the bank under the deck", () => {
    for (const blocker of ["prop", "cliff"] as const) {
      const { pointer, simulation, westAnchor, world } = createAngledBridgeSettlement();
      const plan = simulation.previewBridge(pointer, "wood", westAnchor).plan!;
      // Obstruct the dry bank strip along both waterlines near the crossing, keeping only the chosen
      // anchors' own cells clear: every candidate deck must pass over an obstructed bank.
      const anchorCells = new Set([plan.start, plan.end].map(point =>
        Math.floor(point.z) * world.cellsX + Math.floor(point.x)));
      for (let z = 8; z < 24; z += 1) for (let x = 9; x < 25; x += 1) {
        const cell = z * world.cellsX + x;
        const distance = riverCentreDistance(ANGLED_RIVER, { x: x + 0.5, z: z + 0.5 });
        if (anchorCells.has(cell) || world.blocking[cell] !== BLOCKING.free ||
          distance > ANGLED_RIVER.halfWidth + 1.2) continue;
        world.blocking[cell] = blocker === "prop" ? BLOCKING.prop : BLOCKING.cliff;
      }
      const refused = simulation.previewBridge(pointer, "wood", westAnchor);
      expect(refused.ok, blocker).toBe(false);
      expect(refused.reason, blocker).toBe("unsafe-shore");
    }
  });

  it("builds the angled span through staged construction, saves mid-build and opens the crossing at 100%", () => {
    const first = createAngledBridgeSettlement();
    const result = first.simulation.buildBridge(first.pointer, "wood", first.westAnchor);
    expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const site = first.simulation.bridgeConstructions()[0]!;
    expect(bridgeSiteProblem(site)).toBeNull();
    expect(site.segments).toHaveLength(bridgeLatticeSpan(site.start, site.end)!.edges);
    expect(first.roads.route(first.westAnchor, first.eastAnchor)).toBeNull();
    expect(first.simulation.buildBridge(first.pointer, "wood", first.westAnchor))
      .toEqual({ ok: false, reason: "bridge-overlaps-construction" });

    expect(advanceUntil(first, () => {
      const current = first.simulation.bridgeConstructions()[0];
      return !!current && delivered(current.delivered) > 0 && current.progress > 0;
    })).toBe(true);
    const before = first.simulation.bridgeConstructions()[0]!;
    const saved = JSON.parse(JSON.stringify(first.simulation.saveState()));

    const restored = createAngledBridgeSettlement();
    const loaded = restored.simulation.loadState(saved);
    expect(loaded.ok, loaded.ok ? "" : loaded.reason).toBe(true);
    const after = restored.simulation.bridgeConstructions()[0]!;
    expect(after.segments).toEqual(before.segments);
    expect(after.progress).toBeCloseTo(before.progress, 8);
    expect(after.delivered).toEqual(before.delivered);
    expect(restored.simulation.roadSegments().some(segment => segment.bridge)).toBe(false);

    expect(advanceUntil(restored, () => restored.simulation.bridgeConstructions().length === 0)).toBe(true);
    const bridge = restored.simulation.roadSegments().filter(segment => segment.bridge);
    expect(bridge).toHaveLength(before.segments.length);
    expect(bridgeRoadProblem(bridge)).toBeNull();
    const route = restored.roads.route(restored.westAnchor, restored.eastAnchor)!;
    expect(route).not.toBeNull();
    expect(route.length).toBeCloseTo(Math.hypot(restored.eastAnchor.x - restored.westAnchor.x,
      restored.eastAnchor.z - restored.westAnchor.z), 9);
    expect(restored.roads.route(restored.simulation.headquarters.access, restored.eastEnd)).not.toBeNull();

    // A completed angled bridge survives a further save and load unchanged.
    const completed = JSON.parse(JSON.stringify(restored.simulation.saveState()));
    const reloaded = createAngledBridgeSettlement();
    expect(reloaded.simulation.loadState(completed).ok).toBe(true);
    expect(reloaded.simulation.roadSegments().filter(segment => segment.bridge)).toEqual(bridge);
    expect(reloaded.roads.route(reloaded.westAnchor, reloaded.eastAnchor)?.length).toBeCloseTo(route.length, 12);
  });

  it("refuses a new road under an angled deck that is still being built", () => {
    const { pointer, simulation, westAnchor } = createAngledBridgeSettlement();
    expect(simulation.buildBridge(pointer, "wood", westAnchor).ok).toBe(true);
    const site = simulation.bridgeConstructions()[0]!;
    const context = { buildings: [{ bridgeSite: site }] } as unknown as SettlementContext;
    const deck = bridgeDecks(site.segments)[0]!;
    const crossing = { end: deckPoint(deck, 1.2, 2.5), start: deckPoint(deck, 1.2, -2.5), tier: "dirt" as const };
    const joining = { end: site.start, start: { x: site.start.x - 0.5, z: site.start.z }, tier: "dirt" as const };
    const away = { end: { x: 3, z: 3.5 }, start: { x: 3, z: 3 }, tier: "dirt" as const };
    expect(roadPlanCrossesBridgeSite(context, [crossing])).toBe(true);
    expect(roadPlanCrossesBridgeSite(context, [joining, away])).toBe(false);
  });

  it("replays the angled bridge command log to the same checksum (verifier parity)", () => {
    const live = createAngledBridgeSettlement();
    const base = live.simulation.saveState();
    const recorder = createCommandLogRecorder(live.simulation, { sourceVersion: "angled-bridges" });
    recorder.open();
    expect(live.simulation.buildBridge(live.pointer, "stone", live.westAnchor).ok).toBe(true);
    live.advance(30);
    const interval = recorder.close("home")!;
    expect(interval.entries.map(entry => entry.command.name)).toContain("buildBridge");
    const replay = createAngledBridgeSettlement();
    expect(replay.simulation.loadState(base).ok).toBe(true);
    expect(replayCommandLog(replay.simulation, interval, { rejectDebug: false }))
      .toEqual({ ok: true, endChecksum: interval.endChecksum });
    expect(replay.simulation.bridgeConstructions()).toEqual(live.simulation.bridgeConstructions());
    recorder.dispose();
  });
});
