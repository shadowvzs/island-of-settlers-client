import { describe, expect, it } from "vitest";

import { MINE_FOOTPRINT } from "../src/shared/world/building-footprints";
import { countFootprints } from "../src/shared/world/building-space";
import { computeDistanceField } from "../src/shared/world/generation/distance-field";
import { isBlockingProp } from "../src/shared/world/generation/gameplay";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import {
  createFlankRock,
  createMassifRock,
  createRockRelief,
  isBetweenRock,
  isGravelGround
} from "../src/shared/world/generation/mine-apron";
import { MINE_GRAVEL_COAST, shiftToMineGround } from "../src/shared/world/generation/mine-ground";
import { getDominantMaterial } from "../src/shared/world/ground-buffer";
import { createMountainField } from "../src/shared/world/rock-cover";
import {
  BUILD,
  MATERIAL,
  MATERIAL_COUNT,
  NO_MINE_ZONE,
  ORE,
  type WorldData
} from "../src/shared/world/world-data";
import { cachedWorld, freshWorldBeforeAll, preloadWorlds } from "./helpers/cached-worlds";
import { listRockNeighbours } from "./mountain-ground";

const SMALL = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000 };

const getZoneCells = (world: WorldData, id: number) =>
  [...world.mineZone.keys()].filter((cell) => world.mineZone[cell] === id);

/** Cells of the zone reachable from its first cell through 4-neighbours inside the zone. */
const countConnected = (world: WorldData, cells: number[], id: number) => {
  const seen = new Set([cells[0]!]);
  const queue = [cells[0]!];
  while (queue.length > 0) {
    const cell = queue.pop()!;
    const x = cell % world.cellsX;
    const neighbours = [
      x > 0 ? cell - 1 : -1,
      x < world.cellsX - 1 ? cell + 1 : -1,
      cell - world.cellsX,
      cell + world.cellsX
    ];
    for (const next of neighbours) {
      if (next < 0 || seen.has(next) || world.mineZone[next] !== id) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size;
};

const distanceToStart = (world: WorldData, zone: { centreX: number; centreZ: number }) =>
  Math.hypot(zone.centreX - world.start.x, zone.centreZ - world.start.z);

describe("mine zones", () => {
  const world = cachedWorld(SMALL);
  // placeMineZones' own layout: the home ore guarantee (home-resources.slow.test.ts) adds to it later.
  const big = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, homeResources: false });
  const freshSmall = freshWorldBeforeAll(SMALL);
  preloadWorlds({ ...SMALL, mountains: 0 });

  it("borders the massif rock with mine gravel only (rock -> mine gravel -> soil or green)", () => {
    for (const island of [world, big]) {
      const mountain = createMountainField(island, island.heights);
      const rock = createMassifRock(island, island.heights, mountain);
      // Near the water the gravel fades out: rock meets the beach's sand or soil (MINE_GRAVEL_COAST).
      const neighbours = listRockNeighbours(island, (vertex) => rock[vertex] === 1)
        .filter(({ vertex }) => island.coastDistance[vertex]! >= MINE_GRAVEL_COAST.far);
      expect(neighbours.length).toBeGreaterThan(20);
      const other = neighbours.filter(({ material }) => material !== MATERIAL.mine);
      expect(other).toEqual([]);
    }
  });

  it("lays mine gravel between two rock steps of a massif (shelves, gullies of its flank)", () => {
    const mountain = createMountainField(big, big.heights);
    const massif = createMassifRock(big, big.heights, mountain);
    const flank = createFlankRock(big, big, massif);
    const rock = flank.map((step, vertex) => Math.max(step, massif[vertex]!));
    const stride = big.cellsX + 1;
    const isOpenShelf = (vertex: number) => {
      const x = vertex % stride;
      const z = Math.floor(vertex / stride);
      return (
        rock[vertex] === 0 &&
        isGravelGround(big, big, vertex) &&
        big.riverDistance[vertex]! >= 1.5 &&
        big.coastDistance[vertex]! >= MINE_GRAVEL_COAST.far &&
        Math.hypot(x - big.start.x, z - big.start.z) >= 12 &&
        isBetweenRock(big, rock, vertex)
      );
    };
    const shelves = [...big.heights.keys()].filter(isOpenShelf);
    expect(shelves.length).toBeGreaterThan(100);
    const soil = shelves.filter(
      (vertex) => getDominantMaterial(big.splat, vertex) !== MATERIAL.mine
    );
    expect(soil).toEqual([]);
  });

  it("keeps the beach free of mine gravel near the water (owner 2026-11-13)", () => {
    for (const island of [world, big]) {
      const coastal = [...island.heights.keys()].filter((vertex) =>
        island.waterDepth[vertex] === 0 && island.coastDistance[vertex]! < MINE_GRAVEL_COAST.near + 1 &&
        getDominantMaterial(island.splat, vertex) === MATERIAL.mine);
      expect(coastal).toEqual([]);
    }
  });

  it("is deterministic per seed", () => {
    const again = freshSmall();
    expect(again.mineZones).toEqual(world.mineZones);
    expect(again.mineZone).toEqual(world.mineZone);
    expect(again.oreAmount).toEqual(world.oreAmount);
  });

  const deposits = big.mineZones.filter((zone) => zone.ore !== ORE.none);

  it("places contiguous zones whose records match the cells", () => {
    expect(deposits.length).toBeGreaterThanOrEqual(4);
    for (const zone of big.mineZones) {
      const cells = getZoneCells(big, zone.id);
      expect(cells.length).toBe(zone.cellCount);
      expect(countConnected(big, cells, zone.id)).toBe(cells.length);
    }
  });

  it("fits 3 .. 12 legacy square estimates per deposit (not production mine capacity)", () => {
    for (const zone of deposits) {
      const buildClass = Uint8Array.from(big.buildClass, (build, cell) => {
        if (build === BUILD.none || big.mineZone[cell] === zone.id) return build;
        return BUILD.flag;
      });
      const site = { buildClass, cellsX: big.cellsX, cellsZ: big.cellsZ, heights: big.heights };
      const mines = countFootprints(site, MINE_FOOTPRINT);
      expect(mines).toBeGreaterThanOrEqual(3);
      expect(mines).toBeLessThanOrEqual(12);
    }
  });

  it("serves the mountains with ore deposits, barren gravel and mine ground", () => {
    const mineCells = [...big.mineZone].filter((zone) => zone !== NO_MINE_ZONE).length;
    const depositCells = deposits.reduce((sum, zone) => sum + zone.cellCount, 0);
    expect(depositCells).toBeGreaterThan(400);
    expect(mineCells - depositCells).toBeGreaterThan(50);
    const mountain = createMountainField(big, big.heights);
    const stride = big.cellsX + 1;
    const isNear = (vertex: number, isMine: (x: number, z: number) => boolean) => {
      const [x, z] = [vertex % stride, Math.floor(vertex / stride)];
      for (let dz = -8; dz <= 8; dz += 1) {
        for (let dx = -8; dx <= 8; dx += 1) {
          const [cx, cz] = [x + dx, z + dz];
          if (cx < 0 || cz < 0 || cx >= big.cellsX || cz >= big.cellsZ) continue;
          if (isMine(cx, cz)) return true;
        }
      }
      return false;
    };
    const isZone = (x: number, z: number) => big.mineZone[z * big.cellsX + x] !== NO_MINE_ZONE;
    const isGround = (x: number, z: number) =>
      getDominantMaterial(big.splat, z * stride + x) === MATERIAL.mine;
    const massif = [...mountain.keys()].filter(
      (vertex, index) => mountain[vertex]! >= 0.9 && index % 7 === 0
    );
    const share = (isMine: (x: number, z: number) => boolean) =>
      massif.filter((vertex) => isNear(vertex, isMine)).length / massif.length;
    // Mine land (deposits, barren band) near most massifs, mine gravel ground near all.
    expect(share(isZone)).toBeGreaterThan(0.75);
    expect(share(isGround)).toBeGreaterThan(0.95);
  });

  it("keeps the barren gravel narrow below low rock, wider and broken below tall rock", () => {
    const mountain = createMountainField(big, big.heights);
    const rock = createMassifRock(big, big.heights, mountain);
    const relief = createRockRelief(big, big.heights, rock);
    const distance = computeDistanceField(big, (vertex) => rock[vertex] === 1);
    const stride = big.cellsX + 1;
    const ores = new Map(big.mineZones.map((zone) => [zone.id, zone.ore]));
    const isBarren = (vertex: number) => {
      const cellX = Math.min(vertex % stride, big.cellsX - 1);
      const cellZ = Math.min(Math.floor(vertex / stride), big.cellsZ - 1);
      const zone = big.mineZone[cellZ * big.cellsX + cellX]!;
      return zone !== NO_MINE_ZONE && ores.get(zone) === ORE.none;
    };
    const barren = [...big.heights.keys()].filter(isBarren);
    const lowRock = barren.filter((vertex) => relief[vertex]! < 1.5);
    expect(lowRock.every((vertex) => distance[vertex]! <= 2.5)).toBe(true);
    expect(barren.some((vertex) => distance[vertex]! > 3)).toBe(true);
    const tallFoot = [...big.heights.keys()].filter(
      (vertex) =>
        distance[vertex]! >= 3 &&
        distance[vertex]! <= 5 &&
        relief[vertex]! >= 4 &&
        isGravelGround(big, big, vertex)
    );
    expect(tallFoot.length).toBeGreaterThan(100);
    expect(tallFoot.filter(isBarren).length).toBeLessThan(tallFoot.length * 0.5);
  });

  it("guarantees ore near the start, even without mountains", () => {
    const nearest = Math.min(...deposits.map((zone) => distanceToStart(big, zone)));
    expect(nearest).toBeLessThan(70);
    const flat = cachedWorld({ ...SMALL, mountains: 0 });
    expect(flat.mineZones.some((zone) => zone.ore !== ORE.none)).toBe(true);
  });

  it("gives the deposits nearest the start coal, iron and granite", () => {
    const ordered = [...deposits].sort((a, b) => distanceToStart(big, a) - distanceToStart(big, b));
    expect(ordered.slice(0, 3).map((zone) => zone.ore)).toEqual([ORE.coal, ORE.iron, ORE.granite]);
  });

  it("keeps barren gravel without ore", () => {
    const barren = big.mineZones.filter((zone) => zone.ore === ORE.none);
    expect(barren.length).toBeGreaterThan(0);
    for (const zone of barren) {
      expect(zone.richness).toBe(0);
      expect(getZoneCells(big, zone.id).every((cell) => big.oreAmount[cell] === 0)).toBe(true);
    }
  });

  it("allows mines only inside the zones, nothing else there", () => {
    expect.hasAssertions();
    for (let cell = 0; cell < big.buildClass.length; cell += 1) {
      const inZone = big.mineZone[cell] !== NO_MINE_ZONE;
      if (big.buildClass[cell] === BUILD.mine) expect(inZone).toBe(true);
      // Mine land against the rock is road only (a flag): the mine model keeps clear of it.
      if (inZone) expect([BUILD.mine, BUILD.flag, BUILD.none]).toContain(big.buildClass[cell]);
    }
  });

  it("stores ore only on zone cells, richer in the core", () => {
    for (const zone of deposits) {
      const amounts = getZoneCells(big, zone.id).map((cell) => big.oreAmount[cell]!);
      expect(Math.min(...amounts)).toBeGreaterThan(0);
      expect(Math.max(...amounts)).toBeGreaterThan(Math.min(...amounts));
    }
    const outside = [...big.oreAmount.keys()].filter((cell) => big.mineZone[cell] === 0);
    expect(outside.every((cell) => big.oreAmount[cell] === 0)).toBe(true);
  });

  it("paints mine ground and clears trees, bushes and stones inside", () => {
    const stride = big.cellsX + 1;
    let mineLed = 0;
    let inner = 0;
    for (let cell = 0; cell < big.mineZone.length; cell += 1) {
      if (big.mineZone[cell] === NO_MINE_ZONE) continue;
      const vertex = Math.floor(cell / big.cellsX) * stride + (cell % big.cellsX);
      const isInner = [1, -1, big.cellsX, -big.cellsX].every(
        (offset) => big.mineZone[cell + offset] !== NO_MINE_ZONE
      );
      if (!isInner) continue;
      inner += 1;
      if (big.splat[vertex * MATERIAL_COUNT + MATERIAL.mine]! > 127) mineLed += 1;
    }
    expect(mineLed / inner).toBeGreaterThan(0.8);
    const { props } = big;
    for (let index = 0; index < props.count; index += 1) {
      if (!isBlockingProp(props.types[index]!)) continue;
      const cell = Math.floor(props.z[index]!) * big.cellsX + Math.floor(props.x[index]!);
      expect(big.mineZone[cell]).toBe(NO_MINE_ZONE);
    }
  });
});

describe("shiftToMineGround", () => {
  it("keeps the total weight and part of the snow", () => {
    const weights = new Float32Array(MATERIAL_COUNT);
    weights[MATERIAL.grass] = 100;
    weights[MATERIAL.snow] = 100;
    shiftToMineGround(weights, 1);
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(200, 4);
    expect(weights[MATERIAL.grass]).toBe(0);
    expect(weights[MATERIAL.snow]).toBeGreaterThan(40);
    expect(weights[MATERIAL.mine]).toBeGreaterThan(weights[MATERIAL.snow]!);
  });
});
