import { describe, expect, it } from "vitest";

import { createEdgePassages, edgeBeyond, leavingPose, planEdgePassage } from "../src/render-common/ships/ship-edge-passage";
import type { ShipFrame } from "../src/render-common/ships/ship-frame";

const BOUNDS = { cellsX: 128, cellsZ: 128 };
/** Seed 123's channel exit: 6.5 tiles inside the east edge, the hull heading north up the channel. */
const EXIT = { x: 121.5, y: 0, yaw: Math.PI, z: 108.5 };
const ship = (id: number, phase: ShipFrame["phase"] = "sailing", extra: Partial<ShipFrame> = {}): ShipFrame =>
  ({ cargoCount: 0, id, phase, ...EXIT, ...extra });

describe("ships passing over the map edge (presentation only, 2026-11-17)", () => {
  it("heads for the nearest edge and ends beyond it", () => {
    expect(edgeBeyond(EXIT, BOUNDS)).toMatchObject({ x: 134, yaw: Math.PI / 2, z: 108.5 });
    const passage = planEdgePassage(EXIT, BOUNDS, 10);
    expect(leavingPose(passage, 10)).toMatchObject({ x: EXIT.x, yaw: EXIT.yaw, z: EXIT.z });
    const end = leavingPose(passage, 10 + passage.seconds);
    expect(end.x).toBeCloseTo(134);
    expect(Math.cos(end.yaw - Math.PI / 2)).toBeCloseTo(1);
  });

  it("keeps drawing a ship gone off the map over the edge (empty deck), then brings it back in from there", () => {
    const passages = createEdgePassages(BOUNDS);
    passages.apply([ship(4, "sailing", { deckPassengers: 3, passengers: [7, 8, 9] })], 0);
    const gone = passages.apply([], 0);
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ deckPassengers: 0, id: 4, passengers: [], x: EXIT.x });
    expect(passages.apply([], 2)[0]!.x).toBeGreaterThan(EXIT.x);
    expect(passages.apply([], 60)).toHaveLength(0);
    // It comes back in at the exit: drawn from beyond the edge, easing onto its live pose.
    expect(passages.apply([ship(4)], 100)[0]!.x).toBeCloseTo(134);
    expect(passages.apply([ship(4)], 200)[0]).toMatchObject({ x: EXIT.x, z: EXIT.z });
  });

  it("drops a hull that sank or was dismantled as before, and passes frames through without bounds", () => {
    const passages = createEdgePassages(BOUNDS);
    passages.apply([ship(5, "sailing", { sinkProgress: .5 }), ship(6, "dismantling")], 0);
    expect(passages.apply([], 0)).toHaveLength(0);
    const frames = [ship(7)];
    expect(createEdgePassages().apply(frames, 0)).toBe(frames);
  });
});
