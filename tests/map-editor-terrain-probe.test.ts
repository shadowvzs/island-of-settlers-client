import { describe, expect, it } from "vitest";

import type { WorldData } from "../src/shared/world/world-data";
import { digestWorld, findMovableContour } from "../tools/bench/map-editor-terrain-probe";
import { naturalContourPoints, naturalContourThresholds } from "../tools/bench/terrain-contour-candidates";

describe("bounded natural contour review probe", () => {
  it("stops at its contour budget across the complete grid and reports each attempted variant", async () => {
    const world = { cellsX: 64, cellsZ: 64, heights: new Float32Array(65 * 65).fill(10),
      waterDepth: new Float32Array(65 * 65), flow: new Float32Array(65 * 65 * 2), seaLevel: 0,
      generatedRivers: [], authoredRivers: [] } as unknown as WorldData;
    const report = await findMovableContour(world, { x: 60, z: 60 },
      { maxContours: 2, stopOnAcceptance: false });
    expect(report).toMatchObject({ accepted: null, acceptedContours: 0, tried: 2, trials: 48, successes: [] });
    expect(Object.values(report.reasons).reduce((sum, value) => sum + value, 0)).toBe(48);
    expect(Object.keys(report.reasons).every(reason => reason.endsWith("World-edge contours cannot move or resize.")))
      .toBe(true);
    expect(world.heights.every(height => height === 10)).toBe(true);
  });
  it("samples existing low natural peaks that the historical three-tile grid excluded", () => {
    const heights = new Float32Array(65 * 65).fill(1);
    heights[24 * 65 + 24] = 1.9;
    const world = { cellsX: 64, cellsZ: 64, heights, seaLevel: 0 } as WorldData;
    expect(naturalContourPoints(world, { x: 60, z: 60 }, "grid")).toEqual([]);
    expect(naturalContourPoints(world, { x: 60, z: 60 }, "local-peaks"))
      .toEqual([expect.objectContaining({ x: 24, z: 24 })]);
    const levels = naturalContourThresholds(1.9, 0, "local-peaks");
    expect(levels).toContain(1.8);
    expect(levels.every(level => Math.abs(level * 10 - Math.round(level * 10)) < 1e-8)).toBe(true);
    expect(levels.every(level => level >= .5 && level < 1.9)).toBe(true);
  });

  it("detects sub-centimeter prop movement and finite-ledger changes independently of identities", async () => {
    const world = {
      heights: Float32Array.of(1), flow: Float32Array.of(0, 0), splat: Uint8Array.of(1),
      waterSurface: Float32Array.of(0), mineZone: Uint16Array.of(1), oreAmount: Uint8Array.of(7),
      mineZones: [{ id: 1 }], props: { count: 1, types: Uint8Array.of(2), form: Uint8Array.of(0),
        phase: Float32Array.of(.5), rotation: Float32Array.of(0), scale: Float32Array.of(1),
        x: Float32Array.of(1.001), y: Float32Array.of(0), z: Float32Array.of(1) }
    } as unknown as WorldData;
    const before = await digestWorld(world);
    world.props.x[0] = 1.002;
    const moved = await digestWorld(world);
    expect(moved.props).not.toBe(before.props);
    expect(moved.propIdentities).toBe(before.propIdentities);
    expect(moved.ore).toBe(before.ore);
    world.oreAmount[0] = 8;
    expect((await digestWorld(world)).ore).not.toBe(before.ore);
  });

});
