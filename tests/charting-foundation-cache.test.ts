import { describe, expect, it } from "vitest";

import { createChartingCandidates } from "../src/shared/settlement/settlement-charting-candidates";
import {
  beginFoundationChange, finishFoundationChange, foundationRevision, localFoundationChanges
} from "../src/shared/settlement/settlement-foundation-changes";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BLOCKING, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 160;
  const world = { cellsX: size, cellsZ: size, seaLevel: 0, seed: 3,
    heights: new Float32Array((size + 1) ** 2).fill(1),
    blocking: new Uint8Array(size ** 2), props: { count: 0 }, terrainRevision: 0,
    buildRevision: 0 } as unknown as WorldData;
  const sea = new Uint8Array(size ** 2);
  for (let z = 70; z <= 75; z++) for (let x = 0; x < size; x++) {
    sea[z * size + x] = 1;
    world.blocking[z * size + x] = BLOCKING.water;
  }
  const context = { buildings: [], navigationRevision: 0, occupied: new Uint8Array(size ** 2),
    options: { roads: { revision: 0 }, world } } as unknown as SettlementContext;
  const calls: number[] = [];
  const site = (point: { x: number; z: number; rotation: number }) => {
    calls.push(point.x);
    if (![15, 132].includes(point.x) || point.z !== 63 || point.rotation !== 0) return null;
    if (point.x === 15 && world.heights[40 * 161 + 15]! > 1.5) return null;
    return { ...point, water: { x: point.x, z: 72 } };
  };
  const building = { x: 15, z: 40, width: 4, depth: 4 } as SettlementBuilding;
  return { building, calls, context, sea, site, world };
};

describe("foundation-local charting proofs", () => {
  it("prewarms the same ordered rotation proofs and leaves later queries cached", () => {
    const { calls, context, sea, site } = fixture();
    const warmed = createChartingCandidates(context, sea, site), order: string[] = [];
    const cold = createChartingCandidates(context, sea, point => {
      order.push(`${point.x}:${point.z}:${point.rotation}`); return site(point);
    });
    const progress = [...warmed.prewarm()];
    const warmedCalls = calls.slice();
    expect(progress[0]?.completed).toBe(1);
    expect(progress.at(-1)?.completed).toBe(progress.at(-1)?.total);
    const before = calls.length;
    const warmSites = warmed.list();
    expect(calls).toHaveLength(before);
    expect(warmSites).toEqual(cold.list());
    expect(order.map(entry => Number(entry.split(":")[0]))).toEqual(warmedCalls);
  });

  it("restarts yielded geometry work after an unknown world revision instead of publishing mixed proofs", () => {
    const { context, sea, site, world } = fixture();
    const warmed = createChartingCandidates(context, sea, site), work = warmed.prewarm();
    expect(work.next().done).toBe(false);
    world.heights[40 * 161 + 15] = 2;
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    let step = work.next();
    while (!step.done) step = work.next();
    expect(step.value).toEqual(createChartingCandidates(context, sea, site).list());
    expect(warmed.list()).toEqual(step.value);
  });

  it("matches a full recomputation while retaining distant coastal proofs", () => {
    const { building, calls, context, sea, site, world } = fixture();
    const cache = createChartingCandidates(context, sea, site);
    expect(cache.list()).toHaveLength(2);
    const before = foundationRevision(world), change = beginFoundationChange(world, building);
    world.heights[40 * 161 + 15] = 2;
    world.terrainRevision = (world.terrainRevision ?? 0) + 1; world.buildRevision!++;
    finishFoundationChange(world, change);
    expect(localFoundationChanges(world, before)).toHaveLength(1);
    calls.length = 0;
    const local = cache.list();
    expect(calls).not.toContain(132);
    expect(calls).toContain(15);
    expect(local).toEqual(createChartingCandidates(context, sea, site).list());
  });

  it("reuses topology-matched candidates for fog observation when only buildings move", () => {
    const { calls, context, sea, site, world } = fixture();
    const cache = createChartingCandidates(context, sea, site);
    const sites = cache.list();
    calls.length = 0;
    world.buildRevision = (world.buildRevision ?? 0) + 1;
    context.navigationRevision = 1;
    expect(cache.observe()).toEqual(sites);
    expect(calls).toHaveLength(0);
    world.heights[40 * 161 + 15] = 2;
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    expect(cache.observe()).toEqual(cache.list());
    expect(calls.length).toBeGreaterThan(0);
  });

  it("re-proves nothing for a bare revision move and everything for changes that can alter the sea", () => {
    const { building, calls, context, sea, site, world } = fixture();
    const cache = createChartingCandidates(context, sea, site);
    cache.list();
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    calls.length = 0;
    cache.list();
    expect(calls).toHaveLength(0);
    const before = foundationRevision(world), change = beginFoundationChange(world, building);
    world.heights[40 * 161 + 15] = -1;
    world.terrainRevision = (world.terrainRevision ?? 0) + 1; world.buildRevision!++;
    finishFoundationChange(world, change);
    expect(localFoundationChanges(world, before)).toBeNull();
    calls.length = 0;
    expect(cache.list()).toEqual(createChartingCandidates(context, sea, site).list());
    expect(calls).toContain(132);
  });

  it("bounds the retained change log and refuses a missing revision chain", () => {
    const { building, world } = fixture();
    const before = foundationRevision(world);
    for (let index = 0; index < 70; index++) {
      const change = beginFoundationChange(world, building);
      world.buildRevision!++;
      finishFoundationChange(world, change);
    }
    expect(localFoundationChanges(world, before)).toBeNull();
  });
});
