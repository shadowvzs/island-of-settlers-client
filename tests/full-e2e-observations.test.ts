import { describe, expect, it } from "vitest";

import type { ActorSample } from "../tools/e2e/full/observations";
import { compareGoodsLedger, compareTerrain,createAcceptanceManifest, createProgressTracker }
  from "../tools/e2e/full/observations";

describe("full journey independent observations", () => {
  it("requires catalog modes and upgrades without interpreting coverage as a pass", () => {
    const manifest = createAcceptanceManifest("japanese");
    // Retired buildings stay out of the manifest (30 was a removed building; 16 is the active catapult).
    expect(manifest.buildings.some(row => row.id === 30)).toBe(false);
    expect(manifest.buildings.some(row => row.id === 16)).toBe(true);
    expect(manifest.buildings.find(row => row.id === 36)?.modes).toEqual(["boats", "ships"]);
    // One sawmill type with five cumulative recipe levels (owner 2026-10-18), plus the hand-cart order.
    expect(manifest.buildings.find(row => row.id === 33)?.modes).toEqual(
      ["planks", "hardwoodPlanks", "cedarPlanks", "walnutPlanks", "mahoganyPlanks", "handcart"]);
    // The per-tier sawmills retired into type 33; the Farm is the level-1 marble workshop receipt now.
    expect(manifest.buildings.find(row => row.id === 37)?.upgrade?.cost.marble).toBe(2);
    expect(manifest.buildings.find(row => row.id === 6)?.outputs).toEqual(["sake"]);
  });

  it("does not excuse changes elsewhere in an affected terrain chunk", () => {
    const before = { cellsX: 2, cellsZ: 2, layers: { heights: Array(9).fill(0) } };
    const after = { ...before, layers: { heights: [1, 0, 0, 0, 0, 0, 0, 0, 2] } };
    const result = compareTerrain(before, after,
      [{ reason: "foundation", minX: 0, maxX: 0, minZ: 0, maxZ: 0, layers: ["heights"] }]);
    expect(result.changed).toBe(2);
    expect(result.unauthorized).toBe(1);
    expect(result.examples[0]).toMatchObject({ x: 2, z: 2 });
  });

  it("counts queue/transfer advancement but flags prolonged supplied immobility", () => {
    const track = createProgressTracker();
    const sample = { uid: 1, time: 0, x: 0, z: 0, role: "carrier", phase: "walking", action: "walk",
      building: 1, ware: "stone", pathIndex: 0, target: null, queueKind: null, queueWait: 0,
      transfer: null, timer: 0 } satisfies ActorSample;
    expect(track([sample]).suspected).toHaveLength(0);
    expect(track([{ ...sample, time: 61 }]).suspected).toHaveLength(1);
    expect(track([{ ...sample, time: 62, transfer: .3 }]).suspected).toHaveLength(0);
    expect(track([{ ...sample, time: 200, wait: "full-output" }]).suspected).toHaveLength(0);
  });

  it("distinguishes declared recipe consumption from unexplained loss", () => {
    const ledger = (totals: Record<string, number>) => ({ totals, reservations: {}, invalid: [] });
    const result = compareGoodsLedger(ledger({ logs: 4 }), ledger({ logs: 2, planks: 1 }),
      [{ reason: "one sawmill cycle", goods: { logs: -1, planks: 1 } }]);
    expect(result.unexplained).toEqual([{ ware: "logs", actual: -2, expected: -1, unexplained: -1 }]);
  });
});
