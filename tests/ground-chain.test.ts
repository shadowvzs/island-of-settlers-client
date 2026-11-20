import { describe, expect, it } from "vitest";

import {
  createVertexAttributes,
  createVertexFog,
  createVertexSampler
} from "../src/render-common/chunk-sampling";
import { getIslandRocks } from "../src/render-common/rocks/island-rock-instances";
import { shiftToRockBuffer } from "../src/render-common/rocks/rock-contact";
import { ROCK_ROLE } from "../src/render-common/rocks/rock-instances";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { addRockPropPatches, applyGroundChain } from "../src/shared/world/generation/ground-chain";
import type { IslandTheme } from "../src/shared/world/generation/island-themes";
import {
  createThemeSampler,
  createUniformLayout
} from "../src/shared/world/generation/theme-field";
import { getVertexCount, type GridSize } from "../src/shared/world/grid-geometry";
import {
  getDominantMaterial,
  GREEN_GROUNDS,
  shiftGreenToBuffer
} from "../src/shared/world/ground-buffer";
import { MATERIAL, MATERIAL_COUNT, PROP, type PropSet } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

const SMALL = { ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128 };
const MEADOW_SOIL = { dirt: 1, sand: 0, snow: 0 };
const DESERT_SOIL = { dirt: 0, sand: 1, snow: 0 };

const isGreen = (material: number) => GREEN_GROUNDS.includes(material);

/** Vertices of one material that have a green dominant vertex in their 8-neighbourhood. */
const countGreenNeighbours = (grid: GridSize, splat: Uint8Array, material: number) => {
  const stride = grid.cellsX + 1;
  let count = 0;
  for (let z = 0; z <= grid.cellsZ; z += 1) {
    for (let x = 0; x <= grid.cellsX; x += 1) {
      if (getDominantMaterial(splat, z * stride + x) !== material) continue;
      if (hasGreenAround(grid, splat, x, z, 1.5)) count += 1;
    }
  }
  return count;
};

const hasGreenAround = (
  grid: GridSize,
  splat: Uint8Array,
  x: number,
  z: number,
  radius: number
) => {
  const stride = grid.cellsX + 1;
  for (let vertexZ = Math.ceil(z - radius); vertexZ <= z + radius; vertexZ += 1) {
    for (let vertexX = Math.ceil(x - radius); vertexX <= x + radius; vertexX += 1) {
      const outside = vertexX < 0 || vertexZ < 0 || vertexX > grid.cellsX || vertexZ > grid.cellsZ;
      if (outside || Math.hypot(vertexX - x, vertexZ - z) > radius) continue;
      if (isGreen(getDominantMaterial(splat, vertexZ * stride + vertexX))) return true;
    }
  }
  return false;
};

/** A green dominant corner of the cell holding the point (a stone's neighbours). */
const hasGreenCorner = (grid: GridSize, splat: Uint8Array, x: number, z: number) =>
  [0, 1, 2, 3].some((corner) => {
    const vertexX = Math.floor(x) + (corner & 1);
    const vertexZ = Math.floor(z) + (corner >> 1);
    return isGreen(getDominantMaterial(splat, vertexZ * (grid.cellsX + 1) + vertexX));
  });

const countDominant = (splat: Uint8Array, material: number) => {
  let count = 0;
  for (let vertex = 0; vertex < splat.length / MATERIAL_COUNT; vertex += 1) {
    if (getDominantMaterial(splat, vertex) === material) count += 1;
  }
  return count;
};

/** A grass field with a rock disc in the middle. */
const createRockField = (grid: GridSize, radius: number) => {
  const splat = new Uint8Array(getVertexCount(grid) * MATERIAL_COUNT);
  const stride = grid.cellsX + 1;
  for (let vertex = 0; vertex < getVertexCount(grid); vertex += 1) {
    const x = (vertex % stride) - grid.cellsX / 2;
    const z = Math.floor(vertex / stride) - grid.cellsZ / 2;
    const material = Math.hypot(x, z) <= radius ? MATERIAL.rock : MATERIAL.grass;
    splat[vertex * MATERIAL_COUNT + material] = 255;
  }
  return splat;
};

const createTheme = (grid: GridSize, theme: IslandTheme) =>
  createThemeSampler(grid, createUniformLayout(theme)({ grid, heights: new Float32Array(0) }));

describe("ground buffer weights", () => {
  it("gives mountain rocks gravel contact even on bare dirt without changing rock or snow", () => {
    const weights = new Float32Array(MATERIAL_COUNT);
    weights[MATERIAL.dirt] = 140;
    weights[MATERIAL.grass] = 40;
    weights[MATERIAL.rock] = 50;
    weights[MATERIAL.snow] = 25;
    shiftToRockBuffer(weights, 1, MEADOW_SOIL, 1);
    expect(weights[MATERIAL.mine]).toBe(180);
    expect(weights[MATERIAL.dirt]).toBe(0);
    expect(weights[MATERIAL.rock]).toBe(50);
    expect(weights[MATERIAL.snow]).toBe(25);
    expect(weights.reduce((sum, value) => sum + value, 0)).toBe(255);
  });

  it("moves green ground into pebbles and soil, keeping the total and the rest", () => {
    const weights = new Float32Array(MATERIAL_COUNT);
    weights[MATERIAL.grass] = 150;
    weights[MATERIAL.forestFloor] = 50;
    weights[MATERIAL.rock] = 55;
    shiftGreenToBuffer(weights, 0.5, 1, DESERT_SOIL);
    expect(weights[MATERIAL.gravel]).toBeCloseTo(100, 4);
    expect(weights[MATERIAL.sand]).toBeCloseTo(100, 4);
    expect(weights[MATERIAL.grass]).toBe(0);
    expect(weights[MATERIAL.rock]).toBe(55);
    expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(255, 4);
  });

  it("renders a pebble core and a soil rim at rock contact, nothing outside the band", () => {
    const at = (contact: number) => {
      const weights = new Float32Array(MATERIAL_COUNT);
      weights[MATERIAL.grass] = 255;
      shiftToRockBuffer(weights, contact, MEADOW_SOIL);
      return weights;
    };
    expect(at(1)[MATERIAL.gravel]).toBeGreaterThan(250);
    expect(at(0.3)[MATERIAL.dirt]).toBeGreaterThan(at(0.3)[MATERIAL.grass]!);
    expect(at(0.3)[MATERIAL.gravel]).toBe(0);
    expect(at(0.02)[MATERIAL.grass]).toBe(255);
  });
});

describe("ground chain on the splat", () => {
  const grid = { cellsX: 48, cellsZ: 48 };

  it("puts a narrow, jittered pebbly soil band between rock and grass, keeping green", () => {
    const splat = createRockField(grid, 10);
    applyGroundChain(grid, 7, splat, createTheme(grid, "meadow"));
    expect(countGreenNeighbours(grid, splat, MATERIAL.rock)).toBe(0);
    expect(countGreenNeighbours(grid, splat, MATERIAL.gravel)).toBe(0);
    const band = Array.from({ length: getVertexCount(grid) }, (_, vertex) => vertex).filter(
      (vertex) => getDominantMaterial(splat, vertex) === MATERIAL.dirt
    );
    expect(band.length).toBeGreaterThan(40);
    const read = (vertex: number, material: number) => splat[vertex * MATERIAL_COUNT + material]!;
    expect(band.every((vertex) => read(vertex, MATERIAL.gravel) > 0)).toBe(true);
    const meanGrass = band.reduce((sum, vertex) => sum + read(vertex, MATERIAL.grass), 0);
    expect(meanGrass / band.length).toBeGreaterThan(60);
    const reach = [0, 1, 2, 3, 4, 5, 6, 7].map((step) => {
      const angle = (step / 8) * Math.PI * 2;
      for (let distance = 10; distance < 24; distance += 0.25) {
        const x = Math.round(24 + Math.cos(angle) * distance);
        const z = Math.round(24 + Math.sin(angle) * distance);
        if (getDominantMaterial(splat, z * 49 + x) === MATERIAL.grass) return distance;
      }
      return 24;
    });
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(0.6);
  });

  it("uses the theme's soil: sand in the desert", () => {
    const splat = createRockField(grid, 10);
    applyGroundChain(grid, 7, splat, createTheme(grid, "desert"));
    expect(countDominant(splat, MATERIAL.sand)).toBeGreaterThan(40);
    expect(countDominant(splat, MATERIAL.dirt)).toBe(0);
    expect(countGreenNeighbours(grid, splat, MATERIAL.gravel)).toBe(0);
  });

  it("lays a rock prop in a soil patch of the theme's soil", () => {
    const patchGrid = { cellsX: 16, cellsZ: 16 };
    const props: PropSet = {
      count: 1,
      form: new Uint8Array(1),
      phase: new Float32Array(1),
      rotation: new Float32Array(1),
      scale: Float32Array.of(1),
      types: Uint8Array.of(PROP.smallRock),
      x: Float32Array.of(8.3),
      y: new Float32Array(1),
      z: Float32Array.of(7.6)
    };
    for (const [theme, soil] of [
      ["meadow", MATERIAL.dirt],
      ["desert", MATERIAL.sand]
    ] as const) {
      const splat = createRockField(patchGrid, -1);
      addRockPropPatches(patchGrid, 3, { props, splat }, createTheme(patchGrid, theme));
      expect(hasGreenCorner(patchGrid, splat, 8.3, 7.6)).toBe(false);
      expect(getDominantMaterial(splat, 8 * 17 + 8)).toBe(soil);
      expect(countDominant(splat, MATERIAL.grass)).toBeGreaterThan(200);
    }
  });
});

describe("ground chain on generated islands", () => {
  const cases: [IslandTheme, number][] = [
    ["meadow", 1234],
    ["meadow", 77],
    ["desert", 1234],
    ["dirt", 77]
  ];
  const pebbleSeed = 99;
  preloadWorlds(SMALL, ...cases.map(([theme, seed]) => ({ ...SMALL, seed, theme })),
    ...(["desert", "meadow"] as const).map(theme => ({ ...SMALL, seed: pebbleSeed, theme })));

  it.each(cases)("%s %i: no green next to rock or pebbles, stones on soil", (theme, seed) => {
    const world = cachedWorld({ ...SMALL, seed, theme });
    expect(countGreenNeighbours(world, world.splat, MATERIAL.rock)).toBe(0);
    expect(countGreenNeighbours(world, world.splat, MATERIAL.gravel)).toBe(0);
    for (let index = 0; index < world.props.count; index += 1) {
      if (world.props.types[index] !== PROP.smallRock) continue;
      const near = hasGreenCorner(world, world.splat, world.props.x[index]!, world.props.z[index]!);
      expect(near).toBe(false);
    }
  });

  it("buffers the desert rock with sand, the meadow rock with dirt", () => {
    /**
     * Most pebble rims of the default seed lie on its massif's terraced flank, which is mine
     * gravel (the mountain ground chain); this island keeps enough of them on open land.
     */
    const soilNextToPebbles = (theme: IslandTheme) => {
      const world = cachedWorld({ ...SMALL, seed: pebbleSeed, theme });
      const stride = world.cellsX + 1;
      const counts = { dirt: 0, sand: 0 };
      for (let vertex = 0; vertex < getVertexCount(world); vertex += 1) {
        if (getDominantMaterial(world.splat, vertex) !== MATERIAL.gravel) continue;
        for (const neighbour of [vertex - 1, vertex + 1, vertex - stride, vertex + stride]) {
          const material = getDominantMaterial(world.splat, neighbour);
          if (material === MATERIAL.dirt) counts.dirt += 1;
          if (material === MATERIAL.sand) counts.sand += 1;
        }
      }
      return counts;
    };
    const desert = soilNextToPebbles("desert");
    const meadow = soilNextToPebbles("meadow");
    // The desert has some dirt of its own (theme dirt); the chain adds sand only.
    expect(desert.sand).toBeGreaterThan(desert.dirt * 2);
    expect(meadow.dirt).toBeGreaterThan(meadow.sand * 3);
  });

  it("gives every rock slab, lip and rubble on the ground a pebble / soil rim", () => {
    const world = cachedWorld(SMALL);
    const sample = createVertexSampler(world, createVertexFog(world), "terrain");
    const attributes = createVertexAttributes(1);
    const dominantAt = (x: number, z: number) => {
      sample(attributes, 0, x, z);
      const weights = [...attributes.splatA, ...attributes.splatB, attributes.splatC[0]!];
      return weights.indexOf(Math.max(...weights));
    };
    let rims = 0;
    for (const { axes, centre, role } of getIslandRocks(world)) {
      if (role === ROCK_ROLE.pebble) continue;
      const extent = Math.max(
        Math.hypot(axes[0][0], axes[0][2]),
        Math.hypot(axes[2][0], axes[2][2])
      );
      const rim = 0.8 * Math.max(0.6, 0.42 * extent);
      for (let step = 0; step < 8; step += 1) {
        const angle = (step / 8) * Math.PI * 2;
        const x = centre[0] + Math.cos(angle) * rim;
        const z = centre[2] + Math.sin(angle) * rim;
        expect(isGreen(dominantAt(x, z))).toBe(false);
        rims += 1;
      }
    }
    expect(rims).toBeGreaterThan(1000);
  });
});
