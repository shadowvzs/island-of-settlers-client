import { describe, expect, it } from "vitest";

import { createLiveFog } from "../src/render-common/live-fog";
import {
  createSharedSight,
  createWorkerVision,
  WORKER_SIGHT_RADIUS
} from "../src/render-common/workers/worker-vision";
import { FOG, type WorldData } from "../src/shared/world/world-data";
const island = () => ({ cellsX: 64, cellsZ: 64, fog: new Uint8Array(64 * 64) }) as WorldData;
const fogAt = (world: WorldData, x: number, z: number) => world.fog[z * world.cellsX + x];
describe("worker sight and exploration", () => {
  it("does not rebuild fog while moving or disappearing inside permanent sight", () => {
    const world = island(); world.fog.fill(FOG.visible);
    const vision = createWorkerVision(world), fog = createLiveFog(world);
    vision.update(20, 20); vision.update(22, 22); vision.suspend();
    expect(world.fogRevision ?? 0).toBe(0);
    expect(fog.update()).toBe(false);
  });

  it("does not dirty fog while another viewer covers the entire moving footprint", () => {
    const world = island(), shared = createSharedSight(world);
    const broad = createWorkerVision(world, 30, shared), moving = createWorkerVision(world, 4, shared);
    broad.update(30, 30);
    const revision = world.fogRevision;
    moving.update(29, 30); moving.update(31, 30); moving.suspend();
    expect(world.fogRevision).toBe(revision);
    broad.suspend();
    expect(world.fogRevision).toBeGreaterThan(revision!);
  });
  it("reveals a broad circular area while distant cells stay hidden", () => {
    const world = island(),
      sight = createWorkerVision(world);
    sight.update(20.5, 20.5);
    expect(sight.radius).toBe(WORKER_SIGHT_RADIUS);
    expect(fogAt(world, 20, 20)).toBe(FOG.visible);
    expect(fogAt(world, 31, 20)).toBe(FOG.visible);
    expect(fogAt(world, 32, 32)).toBe(FOG.hidden);
    expect(fogAt(world, 50, 20)).toBe(FOG.hidden);
  });
  it("keeps explored ground remembered after moving and preserves the starting settlement", () => {
    const world = island();
    world.fog[5 * 64 + 5] = FOG.visible;
    const sight = createWorkerVision(world);
    sight.update(16.5, 16.5);
    sight.update(45.5, 45.5);
    expect(fogAt(world, 16, 16)).toBe(FOG.discovered);
    expect(fogAt(world, 45, 45)).toBe(FOG.visible);
    expect(fogAt(world, 5, 5)).toBe(FOG.visible);
    expect(fogAt(world, 0, 63)).toBe(FOG.hidden);
  });
  it("refreshes the renderer fog texture after movement and avoids stationary uploads", () => {
    const world = island(),
      field = createLiveFog(world),
      sight = createWorkerVision(world);
    expect(field.update()).toBe(false);
    sight.update(24.5, 24.5);
    expect(field.update()).toBe(true);
    expect(field.pixels[(24 * 64 + 24) * 4]).toBe(255);
    expect(field.update()).toBe(false);
    expect(sight.update(24.51, 24.5)).toBe(false);
    sight.update(48.5, 48.5);
    expect(field.update()).toBe(true);
    expect(field.pixels[(24 * 64 + 24) * 4]).toBeGreaterThanOrEqual(127);
    expect(field.pixels[(24 * 64 + 24) * 4]).toBeLessThanOrEqual(128);
    expect(field.pixels[(48 * 64 + 48) * 4]).toBe(255);
  });
  it("clips sight to the map edge and respects reveal-all mode", () => {
    const world = island();
    world.fog.fill(FOG.visible);
    const sight = createWorkerVision(world);
    sight.update(0.5, 0.5);
    sight.update(63.5, 63.5);
    expect(world.fog.every((value) => value === FOG.visible)).toBe(true);
    expect(world.fog.length).toBe(4096);
  });
});

describe("shared sight of several workers", () => {
  it("keeps a cell visible while another worker still sees it", () => {
    const world = island(),
      sight = createSharedSight(world),
      first = createWorkerVision(world, WORKER_SIGHT_RADIUS, sight),
      second = createWorkerVision(world, WORKER_SIGHT_RADIUS, sight);
    first.update(20.5, 20.5);
    second.update(22.5, 20.5);
    first.update(50.5, 50.5);
    expect(fogAt(world, 20, 20)).toBe(FOG.visible);
    second.update(50.5, 40.5);
    expect(fogAt(world, 20, 20)).toBe(FOG.discovered);
  });
});
