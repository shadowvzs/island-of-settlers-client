import { describe, expect, it } from "vitest";

import { getViewOutline } from "../src/app/helpers";
import { createMinimapProjection, minimapFraction } from "../src/app/minimap/minimap-geometry";
import { createMinimapImage, MINE_GROUND_COLOR } from "../src/app/minimap/minimap-image";
import { createCamera } from "../src/render-common/camera-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { FOG, NO_MINE_ZONE, ORE } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const SMALL = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000 };

describe("minimap projection", () => {
  const projection = createMinimapProjection({ cellsX: 128, cellsZ: 64 }, 240);

  it("draws the world as the iso diamond and maps back", () => {
    expect(projection.toMinimap(0, 0)).toEqual({ x: 80, y: 0 });
    expect(projection.toMinimap(128, 0).x).toBeCloseTo(240);
    expect(projection.toMinimap(128, 64).y).toBeCloseTo(projection.height);
    const world = projection.toWorld(projection.toMinimap(37.5, 21));
    expect(world.x).toBeCloseTo(37.5);
    expect(world.z).toBeCloseTo(21);
  });

  it("outlines the camera view around its centre", () => {
    const camera = { ...createCamera(50, 40, 1), viewportHeight: 600, viewportWidth: 800 };
    const outline = getViewOutline(camera);
    const centre = outline.reduce((sum, { x, z }) => ({ x: sum.x + x / 4, z: sum.z + z / 4 }), {
      x: 0,
      z: 0
    });
    expect(centre.x).toBeCloseTo(50);
    expect(centre.z).toBeCloseTo(40);
    const zoomedIn = getViewOutline({ ...camera, zoom: 2 });
    const span = (corners: typeof outline) =>
      Math.hypot(corners[0]!.x - corners[2]!.x, corners[0]!.z - corners[2]!.z);
    expect(span(zoomedIn)).toBeCloseTo(span(outline) / 2);
  });

  it("tracks the possessed explorer as clamped minimap fractions", () => {
    const start = minimapFraction(projection.toMinimap(20, 30), projection.width, projection.height);
    const moved = minimapFraction(projection.toMinimap(26, 30), projection.width, projection.height);
    expect(moved.x).toBeGreaterThan(start.x);
    expect(minimapFraction({ x: -20, y: 999 }, projection.width, projection.height)).toEqual({
      x: 0,
      y: 1
    });
  });
});

describe("minimap image", () => {
  const world = cachedWorld(SMALL);

  it("paints mine fields in their own grey and hides fogged cells", () => {
    const image = createMinimapImage(world);
    expect(image.width).toBe(world.cellsX);
    const inner = [...world.mineZone.keys()].find(
      (cell) =>
        [1, -1, world.cellsX, -world.cellsX].every(
          (offset) => world.mineZone[cell + offset] === world.mineZone[cell]
        ) && world.mineZone[cell] !== NO_MINE_ZONE
    )!;
    const pixel = [...image.data.subarray(inner * 4, inner * 4 + 3)];
    const distance = Math.hypot(
      ...pixel.map((value, index) => value - MINE_GROUND_COLOR[index]! * 0.9)
    );
    expect(distance).toBeLessThan(80);
    const fogged = { ...world, fog: new Uint8Array(world.fog.length).fill(FOG.hidden) };
    expect(Math.max(...createMinimapImage(fogged).data.subarray(0, 3))).toBeLessThan(40);
  });
});

it("never spills a surveyed ore marker from hidden centres onto neighbouring explored cells", () => {
  const world = cachedWorld(SMALL);
  const zone = world.mineZones.find((zone) => zone.ore !== ORE.none)!;
  const cell = Math.floor(zone.centreZ) * world.cellsX + Math.floor(zone.centreX);
  world.fog.fill(FOG.visible);
  world.fog[cell] = FOG.hidden;
  zone.surveyed = false;
  const unsurveyed = createMinimapImage(world).data;
  zone.surveyed = true;
  expect(createMinimapImage(world).data).toEqual(unsurveyed);
});
