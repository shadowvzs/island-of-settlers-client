import { describe, expect, it } from "vitest";

import { TICK_MS } from "../../island-of-settlers-shared/src/time/constants";
import { createGameClock, isGameTick, ticksForSeconds } from "../src/shared/settlement/game-clock";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const START = Date.UTC(2026, 11, 13, 10, 33, 11);

const flatWorld = () => {
  const size = 40;
  return {
    seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() }
  } as unknown as WorldData;
};

const createIsland = (clockStart: number) => {
  let simulation: SettlementSimulation | undefined;
  const world = flatWorld();
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ clockStart, roads, world });
  return simulation;
};

describe("game clock", () => {
  it("reads anchor + tick × 50 ms in whole ticks", () => {
    const clock = createGameClock(START);
    expect(clock.now()).toBe(START);
    clock.advance(3);
    expect(clock.tick()).toBe(3);
    expect(clock.now()).toBe(START + 3 * TICK_MS);
    for (let step = 0; step < 72_000; step++) clock.advance(1);
    // An hour of ticks lands exactly on the hour: no float drift.
    expect(clock.now()).toBe(START + 150 + 3_600_000);
  });

  it("restores a saved tick so the clock still reads the session start", () => {
    const clock = createGameClock(START);
    clock.restore(1234);
    expect(clock.tick()).toBe(1234);
    expect(clock.now()).toBe(START);
    clock.advance(2);
    expect(clock.now()).toBe(START + 100);
  });

  it("converts seconds to whole ticks and validates saved ticks", () => {
    expect(ticksForSeconds(1)).toBe(20);
    expect(ticksForSeconds(0.074)).toBe(1);
    expect(ticksForSeconds(-5)).toBe(0);
    expect(isGameTick(12)).toBe(true);
    expect(isGameTick(1.5)).toBe(false);
    expect(isGameTick(-1)).toBe(false);
  });

  it("ticks with the simulation and round-trips the tick through the island save", () => {
    const source = createIsland(START);
    source.update(0.5);
    source.update(0.5);
    expect(source.gameTick()).toBe(20);
    expect(source.gameNow()).toBe(START + 1000);
    const saved = source.saveState();
    expect(saved.gameTick).toBe(20);
    const later = START + 86_400_000;
    const restored = createIsland(later);
    expect(restored.loadState(saved)).toEqual({ ok: true });
    expect(restored.gameTick()).toBe(20);
    expect(restored.gameNow()).toBe(later);
    restored.update(0.05);
    expect(restored.gameTick()).toBe(21);
    expect(restored.gameNow()).toBe(later + 50);
  });

  it("keeps game time continuous across the in-place upload reload and later loads", () => {
    const island = createIsland(1000);
    for (let tick = 0; tick < 100; tick++) island.update(0.05);
    expect(island.gameNow()).toBe(6000);
    expect(island.reloadSnapshot(island.saveState()).ok).toBe(true);
    expect(island.gameNow()).toBe(6000);
    island.update(0.05);
    expect(island.gameNow()).toBe(6050);
    expect(island.loadState(island.saveState()).ok).toBe(true);
    expect(island.gameNow()).toBe(6050);
  });

  it("refuses a fractional saved tick", () => {
    const saved = { ...createIsland(START).saveState(), gameTick: 2.5 };
    expect(createIsland(START).loadState(saved))
      .toEqual({ ok: false, reason: "Invalid population or simulation timing" });
  });
});
