import { describe, expect, it } from "vitest";

import { EXPLORATION_BUBBLE_RADIUS_CELLS } from "../src/app/exploration/contracts";
import type { ExplorationBubble } from "../src/render-common/exploration/exploration-frame";
import {
  countExplorationBubbleCells,
  createTemporaryVisibility,
  explorationBubbleRegion,
  explorationBubbleRevealsCell
} from "../src/render-common/exploration/temporary-visibility";
import { createLiveFog } from "../src/render-common/live-fog";
import { createExplorationFogAdapter } from "../src/renderers/three/exploration-fog";
import { FOG, type WorldData } from "../src/shared/world/world-data";

const makeWorld = (cellsX: number, cellsZ: number) => {
  const fog = new Uint8Array(cellsX * cellsZ);
  fog.fill(FOG.hidden);
  return {
    cellsX,
    cellsZ,
    fog,
    fogRevision: 0,
    permanentFog: fog.slice()
  } as WorldData;
};

const bubbleAt = (centerX: number, centerZ: number, revision: number): ExplorationBubble => ({
  centerX,
  centerZ,
  radiusCells: EXPLORATION_BUBBLE_RADIUS_CELLS,
  revision
});

const pixelAt = (pixels: Uint8Array, world: WorldData, x: number, z: number) =>
  pixels[(z * world.cellsX + x) * 4];

/** The normal live-fog display of the current base fog with the bubble cells painted visible. */
const referenceDisplay = (world: WorldData, bubble: ExplorationBubble | null) => {
  const reference = {
    ...world,
    fog: world.fog.slice(),
    fogRevision: 0,
    permanentFog: world.permanentFog?.slice()
  } as WorldData;
  if (bubble)
    for (let z = 0; z < reference.cellsZ; z++)
      for (let x = 0; x < reference.cellsX; x++)
        if (explorationBubbleRevealsCell(bubble, x, z))
          reference.fog[z * reference.cellsX + x] = FOG.visible;
  return createLiveFog(reference).pixels;
};

const regionCells = (world: WorldData, bubble: ExplorationBubble) => {
  const region = explorationBubbleRegion(world, bubble);
  return Math.max(0, region.maxX - region.minX + 1) * Math.max(0, region.maxZ - region.minZ + 1);
};

describe("exploration temporary visibility composition", () => {
  it("reveals the exact 8-cell disk through the normal display blur without touching base fog", () => {
    const world = makeWorld(64, 64);
    world.fog[10 * 64 + 10] = FOG.visible;
    world.fog[12 * 64 + 12] = FOG.discovered;
    const fog = world.fog;
    const permanentFog = world.permanentFog;
    const fogBytes = world.fog.slice();
    const permanentBytes = world.permanentFog!.slice();
    const bubble = bubbleAt(24.5, 24.5, 1);
    const adapter = createExplorationFogAdapter(world);

    adapter.setBubble(bubble);
    expect(adapter.update()).toBe(true);
    const frame = adapter.displayFog();
    expect(frame).not.toBeNull();
    expect(frame).toMatchObject({ height: 64, width: 64 });
    expect(frame!.pixels).toEqual(referenceDisplay(world, bubble));
    expect(pixelAt(frame!.pixels, world, 24, 24)).toBe(255);

    expect(explorationBubbleRevealsCell(bubble, 32, 24)).toBe(true);
    expect(explorationBubbleRevealsCell(bubble, 33, 24)).toBe(false);
    expect(adapter.stats().revealedCells).toBe(countExplorationBubbleCells(world, bubble));
    expect(adapter.stats().revealedCells).toBeGreaterThan(0);
    expect(adapter.update()).toBe(false);

    expect(world.fog).toBe(fog);
    expect(world.permanentFog).toBe(permanentFog);
    expect(world.fog).toEqual(fogBytes);
    expect(world.permanentFog).toEqual(permanentBytes);
    expect(world.fogRevision).toBe(0);
  });

  it("clears the previous disk when the bubble moves and leaves no trail", () => {
    const world = makeWorld(64, 64);
    const first = bubbleAt(20.5, 20.5, 1);
    const second = bubbleAt(44.5, 44.5, 2);
    const adapter = createExplorationFogAdapter(world);

    adapter.setBubble(first);
    expect(adapter.update()).toBe(true);
    const frame = adapter.displayFog()!;
    expect(pixelAt(frame.pixels, world, 20, 20)).toBe(255);
    const activated = adapter.stats();

    adapter.setBubble(second);
    expect(adapter.update()).toBe(true);
    expect(pixelAt(frame.pixels, world, 20, 20)).toBe(0);
    expect(pixelAt(frame.pixels, world, 44, 44)).toBe(255);
    expect(frame.pixels).toEqual(referenceDisplay(world, second));

    const moved = adapter.stats();
    expect(moved.fullUpdates).toBe(activated.fullUpdates);
    expect(moved.lastUpdate.full).toBe(false);
    expect(moved.lastUpdate.regions).toBe(2);
    expect(moved.lastUpdate.cells).toBeGreaterThan(0);
    expect(moved.lastUpdate.cells)
      .toBeLessThanOrEqual(regionCells(world, first) + regionCells(world, second));
    expect(world.fogRevision).toBe(0);
  });

  it("keeps legitimate base changes made during possession visible after moving and clearing", () => {
    const world = makeWorld(64, 64);
    const first = bubbleAt(16.5, 16.5, 1);
    const second = bubbleAt(20.5, 20.5, 2);
    const adapter = createExplorationFogAdapter(world);

    adapter.setBubble(first);
    expect(adapter.update()).toBe(true);
    const activated = adapter.stats();
    const frame = adapter.displayFog()!;

    // A real Scout/tower/territory writer would set cells and bump the authoritative revision.
    world.fog[45 * 64 + 45] = FOG.visible;
    world.fogRevision = 1;
    expect(adapter.update()).toBe(true);
    expect(adapter.stats().fullUpdates).toBe(activated.fullUpdates + 1);
    expect(pixelAt(frame.pixels, world, 45, 45)).toBeGreaterThan(0);
    expect(frame.pixels).toEqual(referenceDisplay(world, first));

    adapter.setBubble(second);
    expect(adapter.update()).toBe(true);
    expect(pixelAt(frame.pixels, world, 45, 45)).toBeGreaterThan(0);
    expect(frame.pixels).toEqual(referenceDisplay(world, second));

    for (let z = 50; z < 58; z++)
      for (let x = 50; x < 58; x++) world.fog[z * 64 + x] = FOG.discovered;
    world.fogRevision = 2;
    expect(adapter.update()).toBe(true);
    expect(pixelAt(frame.pixels, world, 54, 54)).toBeGreaterThan(0);
    expect(frame.pixels).toEqual(referenceDisplay(world, second));

    adapter.setBubble(null);
    expect(adapter.update()).toBe(true);
    expect(adapter.displayFog()).toBeNull();
    expect(frame.pixels).toEqual(createLiveFog(world).pixels);
    expect(pixelAt(frame.pixels, world, 45, 45)).toBeGreaterThan(0);
    expect(pixelAt(frame.pixels, world, 16, 16)).toBe(0);
    expect(world.fog[45 * 64 + 45]).toBe(FOG.visible);
    expect(world.fogRevision).toBe(2);
    expect(world.permanentFog!.every(value => value === FOG.hidden)).toBe(true);
  });

  it("clips the mask at every map edge without wrapping rows", () => {
    for (const [centerX, centerZ] of [[0.5, 0.5], [63.5, 63.5], [63.5, 0.5], [0.5, 63.5]]) {
      const world = makeWorld(64, 64);
      const bubble = bubbleAt(centerX!, centerZ!, 1);
      const adapter = createExplorationFogAdapter(world);
      adapter.setBubble(bubble);
      expect(adapter.update()).toBe(true);
      const frame = adapter.displayFog()!;
      expect(frame.pixels.length).toBe(64 * 64 * 4);
      expect(frame.pixels).toEqual(referenceDisplay(world, bubble));
      expect(pixelAt(frame.pixels, world, Math.floor(centerX!), Math.floor(centerZ!))).toBe(255);
      expect(adapter.stats().revealedCells).toBe(countExplorationBubbleCells(world, bubble));
      expect(adapter.stats().revealedCells).toBeGreaterThan(0);
      const region = explorationBubbleRegion(world, bubble);
      expect(region.minX).toBeGreaterThanOrEqual(0);
      expect(region.minZ).toBeGreaterThanOrEqual(0);
      expect(region.maxX).toBeLessThanOrEqual(63);
      expect(region.maxZ).toBeLessThanOrEqual(63);
    }
  });

  it("keeps an off-map bubble active but reveals nothing", () => {
    const world = makeWorld(64, 64);
    const adapter = createExplorationFogAdapter(world);
    adapter.setBubble({ centerX: -50, centerZ: -50, radiusCells: 8, revision: 1 });
    expect(adapter.update()).toBe(true);
    expect(adapter.stats().revealedCells).toBe(0);
    expect(adapter.displayFog()!.pixels).toEqual(referenceDisplay(world, null));
    expect(adapter.update()).toBe(false);
  });

  it("has no spyglass expansion surface and ignores unrelated bubble properties", () => {
    const world = makeWorld(32, 32);
    const adapter = createExplorationFogAdapter(world);
    expect("setSpyglass" in adapter).toBe(false);
    expect("spyglass" in adapter).toBe(false);
    const bubble = bubbleAt(16.5, 16.5, 1);
    adapter.setBubble(bubble);
    expect(adapter.update()).toBe(true);
    const before = adapter.stats();
    const frame = adapter.displayFog()!;
    const withSpyglass = { ...bubble, revision: 2, spyglass: true } as ExplorationBubble;
    adapter.setBubble(withSpyglass);
    expect(adapter.update()).toBe(false);
    expect(adapter.stats().revealedCells).toBe(before.revealedCells);
    expect(adapter.displayFog()).toBe(frame);
  });

  it("coalesces queued bubble revisions and never applies an intermediate position", () => {
    const world = makeWorld(64, 64);
    const first = bubbleAt(16.5, 16.5, 1);
    const second = bubbleAt(48.5, 48.5, 2);
    const adapter = createExplorationFogAdapter(world);
    expect(adapter.revision()).toBe(0);
    expect(adapter.displayFog()).toBeNull();

    adapter.setBubble(first);
    adapter.setBubble(second);
    expect(adapter.update()).toBe(true);
    const frame = adapter.displayFog()!;
    expect(pixelAt(frame.pixels, world, 16, 16)).toBe(0);
    expect(pixelAt(frame.pixels, world, 48, 48)).toBe(255);
    expect(frame.pixels).toEqual(referenceDisplay(world, second));
    expect(adapter.revision()).toBe(1);

    expect(adapter.update()).toBe(false);
    expect(adapter.revision()).toBe(1);
    adapter.setBubble({ ...second, revision: 3 });
    expect(adapter.update()).toBe(false);
    expect(adapter.revision()).toBe(1);
    expect(adapter.displayFog()!.revision).toBe(1);

    adapter.setBubble(null);
    expect(adapter.update()).toBe(true);
    expect(adapter.revision()).toBe(2);
    expect(adapter.displayFog()).toBeNull();
    expect(adapter.update()).toBe(false);
    expect(adapter.revision()).toBe(2);
  });

  it("keeps movement recomposition bounded and reuses the display buffer", () => {
    const world = makeWorld(256, 256);
    const start = bubbleAt(128.5, 128.5, 1);
    const adapter = createExplorationFogAdapter(world);
    adapter.setBubble(start);
    expect(adapter.update()).toBe(true);
    const frame = adapter.displayFog()!;
    const pixels = frame.pixels;
    const activated = adapter.stats();
    let previous = start;
    let maxRegion = 0;

    for (let step = 1; step <= 40; step++) {
      const next = bubbleAt(128.5 + step * 2, 128.5, step + 1);
      adapter.setBubble(next);
      expect(adapter.update()).toBe(true);
      const stats = adapter.stats();
      const expected = regionCells(world, previous) + regionCells(world, next);
      maxRegion = Math.max(maxRegion, regionCells(world, next));
      expect(stats.fullUpdates).toBe(activated.fullUpdates);
      expect(stats.lastUpdate.full).toBe(false);
      expect(stats.lastUpdate.regions).toBe(2);
      expect(stats.lastUpdate.cells).toBe(expected);
      expect(adapter.displayFog()!.pixels).toBe(pixels);
      previous = next;
    }

    const stats = adapter.stats();
    expect(stats.maxRegionCells).toBeLessThanOrEqual(2 * maxRegion);
    expect(stats.totalCellsWritten - activated.totalCellsWritten).toBeLessThan(256 * 256);
    expect(adapter.displayFog()!.pixels).toEqual(referenceDisplay(world, previous));
    expect(world.fog.every(value => value === FOG.hidden)).toBe(true);
    expect(world.fogRevision).toBe(0);
  });

  it("restores the current base display on dispose and is idempotent", () => {
    const world = makeWorld(64, 64);
    const base = createLiveFog(world);
    const adapter = createExplorationFogAdapter(world);
    const live = createLiveFog(world, adapter);
    expect(live.update()).toBe(false);

    adapter.setBubble(bubbleAt(24.5, 24.5, 1));
    expect(live.update()).toBe(true);
    const pixels = live.pixels;
    expect(pixelAt(pixels, world, 24, 24)).toBe(255);

    adapter.dispose();
    expect(adapter.displayFog()).toBeNull();
    expect(adapter.update()).toBe(false);
    expect(adapter.stats().disposed).toBe(true);
    expect(live.update()).toBe(true);
    expect(live.pixels).toBe(pixels);
    expect(live.pixels).toEqual(base.pixels);

    adapter.setBubble(bubbleAt(10.5, 10.5, 2));
    expect(adapter.displayFog()).toBeNull();
    expect(live.update()).toBe(false);
    expect(() => adapter.dispose()).not.toThrow();
    expect(world.fog.every(value => value === FOG.hidden)).toBe(true);
    expect(world.fogRevision).toBe(0);
  });

  it("exposes the same composition through the core facade without world writes", () => {
    const world = makeWorld(32, 32);
    world.fog[4 * 32 + 4] = FOG.visible;
    const before = world.fog.slice();
    const permanent = world.permanentFog!.slice();
    const visibility = createTemporaryVisibility(world);
    const bubble = bubbleAt(16.5, 16.5, 1);
    visibility.setBubble(bubble);
    expect(visibility.update()).toBe(true);
    const frame = visibility.displayFog();
    expect(frame).not.toBeNull();
    expect(frame!.pixels).toEqual(referenceDisplay(world, bubble));
    visibility.clear();
    expect(visibility.update()).toBe(true);
    expect(visibility.displayFog()).toBeNull();
    expect(visibility.update()).toBe(false);
    visibility.dispose();
    expect(visibility.displayFog()).toBeNull();
    expect(world.fog).toEqual(before);
    expect(world.fogRevision).toBe(0);
    expect(world.permanentFog).toEqual(permanent);
  });
});
