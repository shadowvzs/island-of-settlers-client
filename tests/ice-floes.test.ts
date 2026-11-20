import { describe, expect, it } from "vitest";

import { createIceFloeMesh } from "../src/render-common/ice-floe-geometry";
import { createIceFloeOpenings, ICE_OPENING_RADII, stampOpening } from "../src/render-common/ice-floe-openings";
import { type IceFloe } from "../src/render-common/ice-floe-placement";
import { createWaterReflectionFragmentGlsl } from "../src/render-common/shaders/frame-water-reflection-glsl";
import { ICE_FLOE_VERTEX_GLSL } from "../src/render-common/shaders/ice-floe-glsl";
import { hasIceFloeScene } from "../src/renderers/three/three-ice-floes";
import type { WorldData } from "../src/shared/world/world-data";

const SIZE = 64;
const world = { cellsX: SIZE, cellsZ: SIZE } as WorldData;
const at = (pixels: Uint8Array, x: number, z: number) => pixels[Math.floor(z) * SIZE + Math.floor(x)]!;

const floe = (x: number, radius: number, seed: number): IceFloe =>
  ({ depth: 1, minDepth: 0.6, offshore: 0.2, radius, seed, surface: 0, x, z: 5 });

describe("ice floe mesh", () => {
  const floes = [floe(3, 0.5, 0.11), floe(8, 1.4, 0.52), floe(14, 2, 0.93)];
  const mesh = createIceFloeMesh(floes);

  it("keeps every floe inside its placement radius and above the seabed", () => {
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
      const radius = floes.find(item => item.x === mesh.centers[vertex * 4])!.radius;
      expect(Math.hypot(mesh.positions[vertex * 3]!, mesh.positions[vertex * 3 + 2]!)).toBeLessThan(radius * 1.07);
      expect(mesh.positions[vertex * 3 + 1]!).toBeGreaterThan(-0.6);
    }
  });

  it("stays within the triangle budget and indexes per-floe ranges", () => {
    expect(mesh.triangles / floes.length).toBeLessThanOrEqual(75);
    expect(mesh.triangles / floes.length).toBeGreaterThanOrEqual(50);
    const counted = floes.reduce((sum, _, index) => sum + mesh.ranges[index * 2 + 1]!, 0);
    expect(counted).toBe(mesh.indices.length);
  });
});

describe("ice floe kept-open water", () => {
  it("stamps a soft disc and reports only rising bytes", () => {
    const pixels = new Uint8Array(SIZE * SIZE);
    expect(stampOpening(pixels, SIZE, SIZE, 20, 20, 6)).toBe(true);
    expect(at(pixels, 20, 20)).toBe(255);
    expect(at(pixels, 20, 25.2)).toBeGreaterThan(0);
    expect(at(pixels, 20, 25.2)).toBeLessThan(255);
    expect(at(pixels, 20, 27)).toBe(0);
    expect(stampOpening(pixels, SIZE, SIZE, 20, 20, 6)).toBe(false);
  });

  it("opens harbours, fisheries, ship tracks, skiffs and fishing spots, and keeps them open", () => {
    const openings = createIceFloeOpenings(world);
    expect(openings.pixels.every(value => value === 0)).toBe(true);
    const changed = openings.update({
      buildings: [
        { id: "h", type: 39, x: 10, z: 10 },
        { id: "f", type: 18, x: 50, z: 10 },
        { id: "m", type: 1, x: 30, z: 55 }
      ] as never,
      fishingBoats: [{ bed: 0.4, id: 1, x: 50, z: 50 }, { id: 2, x: 5, z: 58 }] as never,
      ships: [{ id: 7, phase: "sailing", x: 30, yaw: Math.PI / 2, z: 30 }] as never,
      workers: [{ fishingTarget: { x: 40, y: 0, z: 40 } }] as never
    });
    expect(changed).toBe(true);
    const { pixels } = openings;
    expect(at(pixels, 10 + ICE_OPENING_RADII.harbour - 2.5, 10)).toBe(255);
    expect(at(pixels, 50, 10)).toBe(255);
    expect(at(pixels, 30, 55)).toBe(0);
    // The ship's lead runs along its keel (yaw π/2: along +x) ahead of and behind the hull.
    expect(at(pixels, 37, 30)).toBe(255);
    expect(at(pixels, 23, 30)).toBe(255);
    expect(at(pixels, 30, 37)).toBe(0);
    expect(at(pixels, 50, 50)).toBe(255);
    expect(at(pixels, 5, 58)).toBe(0);
    expect(at(pixels, 40, 40)).toBe(255);
    // An unmoved fleet stamps nothing new; the old lead stays open after the ship sails on.
    expect(openings.update({ ships: [{ id: 7, phase: "sailing", x: 30, yaw: Math.PI / 2, z: 30 }] as never }))
      .toBe(false);
    openings.update({ ships: [{ id: 7, phase: "sailing", x: 30, yaw: 0, z: 45 }] as never });
    expect(at(pixels, 37, 30)).toBe(255);
    expect(at(pixels, 30, 52)).toBe(255);
  });

  it("stamps the generation harbour plots on creation", () => {
    const harbour = { rotation: 0, x: 12, z: 12 };
    const spot = { land: { x: 40, z: 40 }, rotation: 0, water: { x: 44, z: 44 }, x: 41, yaw: 0, z: 41 };
    const openings = createIceFloeOpenings({ ...world, playableIslands: { sites: [{ harbour, harbourSpots: [spot] }] }
    } as WorldData);
    expect(at(openings.pixels, 12, 12)).toBe(255);
    expect(at(openings.pixels, 44, 44)).toBe(255);
  });
});

describe("ice floe scenes", () => {
  it("builds floes only on winter maps with the setting on", () => {
    expect(hasIceFloeScene({ iceFloes: true }, { hasSnow: true }, false)).toBe(true);
    expect(hasIceFloeScene({ iceFloes: true }, { hasSnow: false }, true)).toBe(true);
    expect(hasIceFloeScene({ iceFloes: true }, { hasSnow: false }, false)).toBe(false);
    expect(hasIceFloeScene({ iceFloes: false }, { hasSnow: true }, true)).toBe(false);
    // seasons-5: armed for the global season's snow, the floes exist from the start of the ramp.
    expect(hasIceFloeScene({ iceFloes: true }, { hasSnow: false, seasonSnow: true }, false)).toBe(true);
  });

  it("grows the floes with the season's ice ramp only while the season can snow", () => {
    expect(ICE_FLOE_VERTEX_GLSL).toContain("position * getFloeGrowth()");
    expect(ICE_FLOE_VERTEX_GLSL).toContain("#ifdef SEASON_ICE");
  });

  it("compiles the calm-water mirror start only into scenes with floes", () => {
    for (const winter of [false, true]) {
      expect(createWaterReflectionFragmentGlsl(winter)).not.toContain("getSsrStartLift");
      expect(createWaterReflectionFragmentGlsl(winter, true)).toContain("getSsrStartLift(depth, vWater.zw)");
    }
  });
});
