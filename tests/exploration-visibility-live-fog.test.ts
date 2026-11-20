import { describe, expect, it } from "vitest";

import { EXPLORATION_BUBBLE_RADIUS_CELLS } from "../src/app/exploration/contracts";
import { createLiveFog, type LiveFogDisplayFrame } from "../src/render-common/live-fog";
import { createExplorationFogAdapter } from "../src/renderers/three/exploration-fog";
import { FOG, type WorldData } from "../src/shared/world/world-data";

const makeWorld = (cellsX: number, cellsZ: number) => {
  const fog = new Uint8Array(cellsX * cellsZ);
  fog.fill(FOG.hidden);
  return { cellsX, cellsZ, fog, fogRevision: 0 } as WorldData;
};

describe("live fog display provider", () => {
  it("keeps the exact base-fog behaviour when no provider is supplied", () => {
    const world = makeWorld(13, 9);
    const live = createLiveFog(world);
    const pixels = live.pixels;
    expect(live.update()).toBe(false);
    world.fog.fill(FOG.visible, 10, 63);
    world.fogRevision = 1;
    expect(live.update()).toBe(true);
    expect(live.pixels).toBe(pixels);
    expect(live.pixels).toEqual(createLiveFog(world).pixels);
    expect(live.pixels[(4 * 13 + 4) * 4]).toBeGreaterThan(0);
    expect(live.update()).toBe(false);
  });

  it("treats a provider that returns null exactly like the base path", () => {
    const world = makeWorld(13, 9);
    const provider = { displayFog: () => null };
    const live = createLiveFog(world, provider);
    expect(live.update()).toBe(false);
    world.fog[4 * 13 + 4] = FOG.visible;
    world.fogRevision = 1;
    expect(live.update()).toBe(true);
    expect(live.pixels).toEqual(createLiveFog(world).pixels);
    expect(live.update()).toBe(false);
  });

  it("copies a composed display frame into its own texture buffer and restores base fog", () => {
    const world = makeWorld(16, 12);
    let frame: LiveFogDisplayFrame | null = null;
    const live = createLiveFog(world, { displayFog: () => frame });
    const pixels = live.pixels;
    expect(live.update()).toBe(false);

    const composed = new Uint8Array(16 * 12 * 4);
    composed.fill(255);
    frame = { height: 12, pixels: composed, revision: 1, width: 16 };
    expect(live.update()).toBe(true);
    expect(live.pixels).toBe(pixels);
    expect(live.pixels).not.toBe(composed);
    expect(live.pixels.every(value => value === 255)).toBe(true);
    expect(live.update()).toBe(false);

    composed[0] = 7;
    frame = { height: 12, pixels: composed, revision: 2, width: 16 };
    expect(live.update()).toBe(true);
    expect(live.pixels[0]).toBe(7);

    frame = null;
    expect(live.update()).toBe(true);
    expect(live.pixels).toEqual(createLiveFog(world).pixels);
    expect(live.update()).toBe(false);
  });

  it("rejects a provider frame that does not match the world texture size", () => {
    const world = makeWorld(8, 8);
    let frame: LiveFogDisplayFrame | null = null;
    const live = createLiveFog(world, { displayFog: () => frame });
    frame = { height: 8, pixels: new Uint8Array(8 * 8 * 4), revision: 1, width: 7 };
    expect(() => live.update()).toThrow("Invalid live fog display frame");
  });

  it("shares composition without sharing the renderer's texture buffer", () => {
    const world = makeWorld(32, 32);
    const adapter = createExplorationFogAdapter(world);
    const live = createLiveFog(world, adapter);
    const pixels = live.pixels;

    adapter.setBubble({
      centerX: 16.5,
      centerZ: 16.5,
      radiusCells: EXPLORATION_BUBBLE_RADIUS_CELLS,
      revision: 1
    });
    expect(live.update()).toBe(true);
    expect(live.pixels).toBe(pixels);
    const composed = adapter.displayFog();
    expect(composed).not.toBeNull();
    expect(composed!.pixels).not.toBe(live.pixels);
    expect(live.pixels[(16 * 32 + 16) * 4]).toBe(255);

    // The provider's read-only frame does not become the renderer's shared texture.
    expect(adapter.displayFog()!.pixels).toBe(composed!.pixels);
    expect(live.pixels).toBe(pixels);
  });
});
