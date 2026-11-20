import { describe, expect, it } from "vitest";

import { createBridgeSpotScan } from "../src/app/settlement/bridge-spot-scan";
import { bridgeDecks, deckPoint } from "../src/shared/settlement/bridge-deck";
import { planBridge } from "../src/shared/settlement/bridge-planning";
import { bridgeBankProblem } from "../src/shared/settlement/bridge-river-banks";
import {
  bridgeSpotPointers,
  createBridgeSpotCollector,
  nearestBridgeSpot
} from "../src/shared/settlement/bridge-spots";
import type { RoadPoint } from "../src/shared/settlement/road-types";
import type { WorldData } from "../src/shared/world/world-data";
import { createBridgeSettlement } from "./helpers/bridge-settlement";
import { bridgeRules, type BridgeTestWorld,bridgeTestWorld } from "./helpers/bridge-world";

/** The default north-south river plus a round pond on the east bank that a walker steps around. */
const riverAndPondWorld = () => {
  const world = bridgeTestWorld({ size: 32 });
  const stride = world.cellsX + 1;
  for (let z = 0; z <= world.cellsZ; z += 1) for (let x = 14; x <= world.cellsX; x += 1) {
    const distance = Math.hypot(x - 22, z - 16);
    if (distance > 2.2) continue;
    world.waterDepth[z * stride + x] = 1;
    world.riverDistance[z * stride + x] = 0;
  }
  return world;
};

const plannerPreview = (world: BridgeTestWorld) => (pointer: RoadPoint) => {
  const result = planBridge({ id: 0, kind: "wood", pointer, rules: bridgeRules(world), world });
  return result.ok ? { ok: true, plan: result.plan } : { ok: false, reason: result.reason };
};

const collectSpots = (world: BridgeTestWorld) => {
  const collector = createBridgeSpotCollector(), preview = plannerPreview(world);
  for (const pointer of bridgeSpotPointers(world, undefined, { x: 9, z: 16 })) collector.add(pointer, preview(pointer));
  return collector.spots();
};

describe("bridge placement spots", () => {
  it("lists only real river crossings, never the pond, without overlapping outlines", () => {
    const world = riverAndPondWorld();
    const spots = collectSpots(world);
    expect(spots.length).toBeGreaterThan(3);
    for (const spot of spots) {
      const { end, start } = spot.plan;
      expect(bridgeBankProblem(world, start, end)).toBeNull();
      // Opposite banks of the river at x 8..10, crossing it square on.
      expect(Math.min(start.x, end.x)).toBeLessThan(8);
      expect(Math.max(start.x, end.x)).toBeGreaterThan(10);
      expect(start.z).toBe(end.z);
      expect(spot.status).toBe("ready");
    }
    for (const [index, spot] of spots.entries())
      for (const other of spots.slice(index + 1)) expect(Math.abs(spot.plan.start.z - other.plan.start.z)).toBeGreaterThanOrEqual(3);
  });

  it("orders pointers nearest the focus and skips open sea and unowned cells", () => {
    const world = bridgeTestWorld();
    const owned = new Uint8Array(world.cellsX * world.cellsZ);
    for (let x = 0; x < world.cellsX; x += 1) owned[12 * world.cellsX + x] = 1;
    const pointers = bridgeSpotPointers(world, owned, { x: 9, z: 12 });
    expect(pointers.every(pointer => pointer.z === 12 || pointer.z === 12.5)).toBe(true);
    expect(pointers[0]).toEqual({ x: 9, z: 12 });
    expect(bridgeSpotPointers(bridgeTestWorld({ sea: true }), undefined, { x: 9, z: 12 })).toEqual([]);
  });

  it("snaps a pointer on or beside a crossing to it, and its pointer rebuilds the same span", () => {
    const world = riverAndPondWorld();
    const spots = collectSpots(world);
    const spot = spots[0]!;
    const deck = bridgeDecks(spot.plan.segments)[0]!;
    for (const point of [deckPoint(deck, deck.length / 2, 0), deckPoint(deck, -0.8, 0.5), deckPoint(deck, deck.length + 0.6, -0.4)])
      expect(nearestBridgeSpot(spots, point)).toBe(spot);
    expect(nearestBridgeSpot(spots, deckPoint(deck, deck.length / 2, 5))).not.toBe(spot);
    const again = plannerPreview(world)(spot.pointer);
    expect(again.plan && [again.plan.start, again.plan.end]).toEqual([spot.plan.start, spot.plan.end]);
  });

  it("scans the live settlement time sliced from the authoritative preview", () => {
    const { simulation, world } = createBridgeSettlement();
    let clock = 0;
    const scan = createBridgeSpotScan({
      now: () => (clock += 1),
      owned: () => undefined,
      preview: (pointer, kind) => simulation.previewBridge(pointer, kind),
      world: world as WorldData
    });
    for (let frame = 0; frame < 400 && (frame === 0 || scan.isScanning()); frame += 1)
      scan.update("stone", "revision", { x: 10.5, z: 16 }, 3);
    expect(scan.isScanning()).toBe(false);
    const spots = scan.spots();
    expect(spots.length).toBeGreaterThan(0);
    for (const spot of spots) {
      const preview = simulation.previewBridge(spot.pointer, "stone");
      expect(preview.plan?.start).toEqual(spot.plan.start);
      expect(["ready", "needs-road"]).toContain(spot.status);
    }
    // The connected crossing in front of the headquarters road is ready to build.
    expect(spots.some(spot => spot.status === "ready")).toBe(true);
    scan.update(null, "", { x: 0, z: 0 });
    expect(scan.spots()).toEqual([]);
  });
});
