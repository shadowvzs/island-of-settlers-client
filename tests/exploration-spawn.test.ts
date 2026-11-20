import { describe, expect, it, vi } from "vitest";

import type { ExplorationGroundQuery } from "../src/app/exploration/contracts";
import {
  findExplorationSpawn,
  isExplorationSpawnPointValid
} from "../src/app/exploration/spawn";

interface GridOptions {
  cellsX?: number;
  cellsZ?: number;
  clear?: (x: number, z: number, radius: number) => boolean;
  height?: (x: number, z: number) => number;
  owned?: (x: number, z: number) => boolean;
  walkable?: (x: number, z: number) => boolean;
  water?: (x: number, z: number) => boolean;
}

const createGrid = (options: GridOptions = {}): ExplorationGroundQuery => ({
  cellsX: options.cellsX ?? 16,
  cellsZ: options.cellsZ ?? 16,
  groundHeight: options.height ?? (() => 0),
  isClear: options.clear ?? (() => true),
  isOwned: options.owned ?? (() => true),
  isWalkable: options.walkable ?? (() => true),
  isWater: options.water ?? (() => false)
});

describe("exploration spawn", () => {
  it("prefers clear owned walkable land at the current focus", () => {
    const ground = createGrid();
    const result = findExplorationSpawn(ground, { focus: { x: 5, z: 5 } });
    expect(result).toEqual({ ok: true, point: { owned: true, x: 5, y: 0, z: 5 } });
  });

  it("allows a dry owned coast when the centre is not available", () => {
    const ground = createGrid({
      owned: x => x >= 7.5,
      walkable: x => x >= 7.5 && x < 8.6,
      water: x => x >= 8.6
    });
    const result = findExplorationSpawn(ground, { focus: { x: 5, z: 8 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.point.x).toBeGreaterThanOrEqual(7.5);
    expect(result.point.x).toBeLessThan(8.6);
    expect(result.point.owned).toBe(true);
    expect([-1, 0, 1].some(dz => ground.isWater(result.point.x + 1.8, result.point.z + dz * 1.8)))
      .toBe(true);
  });

  it("uses HQ/harbour-area landmarks after focus and coast candidates fail", () => {
    const ground = createGrid({
      cellsX: 24,
      cellsZ: 24,
      owned: (x, z) => x >= 16 && z >= 16,
      walkable: (x, z) => x >= 16 && z >= 16
    });
    const result = findExplorationSpawn(ground, {
      focus: { x: 4, z: 4 },
      landmarks: [{ x: 20, z: 20 }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.point).toMatchObject({ owned: true, x: 20, z: 20 });
  });

  it("refuses blocked, isolated, outside-map and water-only ground", () => {
    const blocked = createGrid({ walkable: () => false });
    expect(findExplorationSpawn(blocked, { focus: { x: 5, z: 5 } }))
      .toEqual({ ok: false, reason: "no-safe-spawn" });

    const isolated = createGrid({
      walkable: (x, z) => Math.abs(x - 8) < 0.2 && Math.abs(z - 8) < 0.2
    });
    expect(findExplorationSpawn(isolated, { focus: { x: 8, z: 8 } }))
      .toEqual({ ok: false, reason: "no-safe-spawn" });

    const outside = createGrid({ walkable: x => x > 100 });
    expect(findExplorationSpawn(outside, { focus: { x: 4, z: 4 } }))
      .toEqual({ ok: false, reason: "no-safe-spawn" });

    const water = createGrid({ water: () => true });
    expect(findExplorationSpawn(water, { focus: { x: 8, z: 8 } }))
      .toEqual({ ok: false, reason: "no-safe-spawn" });
  });

  it("invalidates a late spawn when clearance, ownership or height changes", () => {
    const state = { clear: true, height: 0, owned: true };
    const ground = createGrid({
      clear: () => state.clear,
      height: () => state.height,
      owned: () => state.owned
    });
    const result = findExplorationSpawn(ground, { focus: { x: 6, z: 6 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isExplorationSpawnPointValid(ground, result.point)).toBe(true);
    state.clear = false;
    expect(isExplorationSpawnPointValid(ground, result.point)).toBe(false);
    state.clear = true;
    state.owned = false;
    expect(isExplorationSpawnPointValid(ground, result.point)).toBe(false);
    state.owned = true;
    state.height = 1;
    expect(isExplorationSpawnPointValid(ground, result.point)).toBe(false);
  });

  it("bounds candidate attempts and injected search time without mutating the query", () => {
    const state = { calls: 0 };
    const ground = createGrid({
      walkable: () => { state.calls += 1; return false; }
    });
    const copy = { ...ground };
    const bounded = findExplorationSpawn(ground, {
      focus: { x: 8, z: 8 }, maxCandidates: 4, timeBudgetMs: 1_000
    });
    expect(bounded).toEqual({ ok: false, reason: "no-safe-spawn" });
    expect(state.calls).toBeLessThanOrEqual(4);
    expect(ground).toMatchObject(copy);

    let nowValue = 0;
    const now = () => {
      const current = nowValue;
      nowValue += 2;
      return current;
    };
    const timed = findExplorationSpawn(ground, {
      focus: { x: 8, z: 8 }, maxCandidates: 100, timeBudgetMs: 5, now
    });
    expect(timed).toEqual({ ok: false, reason: "no-safe-spawn" });
    expect(state.calls).toBeLessThanOrEqual(6);
  });

  it("keeps validation read-only", () => {
    const isOwned = vi.fn(() => true);
    const ground = createGrid({ owned: isOwned });
    const result = findExplorationSpawn(ground, { focus: { x: 3, z: 3 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    isOwned.mockClear();
    expect(isExplorationSpawnPointValid(ground, result.point)).toBe(true);
    expect(isOwned).toHaveBeenCalled();
  });
});
