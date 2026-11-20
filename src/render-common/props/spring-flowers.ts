import { type CellRegion, forEachRegionCell, sampleSmooth } from "../../shared/world/grid-geometry";
import { smoothstep } from "../../shared/world/noise";
import { createCellRandom, deriveSeed, type Random } from "../../shared/world/rng";
import type { WorldData } from "../../shared/world/world-data";
import {
  chooseFlower,
  createFieldCoverContext,
  type FieldCoverContext,
  getCoverAcceptance,
  getCoverTint,
  readCoverGround
} from "./field-cover";
import { fitRoadsideCover } from "./field-cover-exclusions";
import { type RawInstance, toInstances } from "./prop-instances";
import { getMeshId, getVariantCount } from "./prop-meshes";

/**
 * Spring meadow flowers (owner 2026-11-17: spring is when the snow melts and the flowers in the grass start to
 * appear). An extra, render-only layer of the field-cover wildflowers that the GPU opens with the spring weight
 * (prop shader SPRING_BLOOM): each flower's bloom point rides in its phase (0..1 of the spring ramp). A few
 * scattered flowers open first anywhere in the meadow, then the flower patches fill from their cores outwards.
 */
export const SPRING_FLOWERS = Object.freeze({
  /** Bloom points of the scattered first flowers (spread over the start of the ramp). */
  earlyBloom: 0.45,
  /** Patch flowers: earliest bloom point, the spread by patch edge distance and the random spread. */
  patchBloom: 0.3,
  patchEdgeDelay: 0.35,
  patchSpread: 0.3,
  /** Flower chance per accepted cover spot: scattered anywhere, plus this much more at a patch core. */
  patchChance: 0.85,
  scatterChance: 0.07
});

const TWO_PI = Math.PI * 2;

/** The flower patch strength at a spot: wider than the summer patches, so spring patches look fuller. */
const getSpringPatch = (context: FieldCoverContext, x: number, z: number) =>
  smoothstep(-0.2, 0.32, context.patches.flowers(x * 0.12, z * 0.12));

/** The bloom point (0..1 of the spring ramp): scattered flowers early, patch flowers by their patch depth. */
const getBloomPoint = (scattered: boolean, patch: number, random: Random) => {
  if (scattered) return random() * SPRING_FLOWERS.earlyBloom;
  const point = SPRING_FLOWERS.patchBloom + (1 - patch) * SPRING_FLOWERS.patchEdgeDelay +
    random() * SPRING_FLOWERS.patchSpread;
  return Math.min(0.97, point);
};

interface FlowerSpot {
  patch: number;
  roll: number;
  x: number;
  z: number;
}

/** One accepted cover spot: a flower instance when the open meadow there grows one, else undefined. */
const createSpringFlower = (context: FieldCoverContext, spot: FlowerSpot, random: Random) => {
  const { patch, roll, x, z } = spot;
  const ground = readCoverGround(context, x, z);
  const open = (1 - ground.trodden) * (ground.shaded > 0.5 ? 0 : 1) * ground.cover.flowers;
  const chance = (SPRING_FLOWERS.scatterChance + patch * SPRING_FLOWERS.patchChance) * open;
  if (roll >= chance) return undefined;
  const scattered = roll < SPRING_FLOWERS.scatterChance * open;
  const kind = chooseFlower(context.patches, x, z, random);
  const instance: RawInstance = {
    meshId: getMeshId(kind, Math.floor(random() * getVariantCount(kind))),
    phase: getBloomPoint(scattered, patch, random) * TWO_PI,
    rotation: random() * TWO_PI,
    // A little larger than the summer wildflowers: the spring meadow must read at gameplay zoom.
    scale: (1.1 + random() * 0.45) * (0.9 + ground.moisture * 0.3),
    sourceIndex: -1,
    stretch: 0.9 + random() * 0.25,
    tint: getCoverTint(kind, ground, 0.9 + random() * 0.2),
    x,
    y: sampleSmooth(context.world, context.world.heights, x, z),
    z
  };
  return instance;
};

/**
 * The spring flowers of a region (default: the whole island). Its own cell streams, so the field cover and the
 * map editor's region rebuilds are untouched. Expedition scenery has no blooms (like its field cover).
 */
export const buildSpringFlowerInstances = (
  world: WorldData,
  fog: Float32Array,
  samplesPerCell: number,
  region: CellRegion = { maxX: world.cellsX - 1, maxZ: world.cellsZ - 1, minX: 0, minZ: 0 }
) => {
  if (world.expeditionKind) return toInstances(world, fog, []);
  const context = createFieldCoverContext(world, region);
  const seed = deriveSeed(world.seed, "spring-flowers");
  const raw: RawInstance[] = [];
  forEachRegionCell(world, region, (cell, cellX, cellZ) => {
    if (context.bare(cell)) return;
    const random = createCellRandom(seed, cell);
    for (let sample = 0; sample < samplesPerCell; sample += 1) {
      const x = cellX + random();
      const z = cellZ + random();
      const accept = random();
      const roll = random();
      const patch = getSpringPatch(context, x, z);
      // The cheap patch test first: most spots can never grow a flower.
      if (roll >= SPRING_FLOWERS.scatterChance + patch * SPRING_FLOWERS.patchChance) continue;
      if (accept >= getCoverAcceptance(context, x, z)) continue;
      const flower = createSpringFlower(context, { patch, roll, x, z }, random);
      const fitted = flower && fitRoadsideCover(world, flower);
      if (fitted) raw.push(fitted);
    }
  });
  return toInstances(world, fog, raw);
};
