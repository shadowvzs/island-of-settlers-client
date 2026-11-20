import type { ThemeCover } from "../../shared/world/generation/island-themes";
import { createThemeSampler } from "../../shared/world/generation/theme-field";
import {
  type CellRegion,
  forEachRegionCell,
  sampleBilinear,
  sampleSmooth} from "../../shared/world/grid-geometry";
import { GROUND_VARIANT_COUNT, GROUND_VARIANT_IDS, TILLED_SOIL_VARIANT } from "../../shared/world/ground-variants";
import { favoredCoverKinds, getWorldNationAffinity } from "../../shared/world/nation-terrain-affinity";
import { createFbm, type Noise2,smoothstep } from "../../shared/world/noise";
import { createCellRandom, deriveSeed, type Random } from "../../shared/world/rng";
import { MATERIAL, MATERIAL_COUNT, SLOPE, type WorldData } from "../../shared/world/world-data";
import { getAlpineZoneAt } from "../ground-zone-field";
import { getRockContact } from "../rocks/rock-contact";
import { GROUND_VARIANT_TUNING } from "../shaders/ground-variant-layers-glsl";
import {
  getBiomeGrassBlend,
  getBiomeGrassParameters,
  getBiomeGrassWeights,
  pickBiomeGrassKind
} from "./biome-grass";
import { getPaintedCoverKind } from "./cover-paint";
import {
  fitRoadsideCover,
  getBuildingGroundCoverCounts,
  getFieldCoverExclusions, getFieldCropCoverCells,
  roadsideCoverWeight
} from "./field-cover-exclusions";
import { type RawInstance,toInstances } from "./prop-instances";
import { COVER, getMeshId, getVariantCount } from "./prop-meshes";
import { collectShoreDetails } from "./shore-details";
import { type MeadowMacro,sampleMeadowMacro } from "./terrain-tint";

type Rgb = [number, number, number];

/**
 * Ground colour multiplier per material: grass blends into what it grows on. Meadow grass stays
 * the lightest, warmest green layer (bushes olive, crowns deeper / bluer, conifers darkest).
 */
const GROUND_TINTS: Record<number, Rgb> = {
  [MATERIAL.grass]: [0.84, 0.89, 0.56],
  [MATERIAL.lushGrass]: [0.68, 0.87, 0.47],
  [MATERIAL.forestFloor]: [0.5, 0.55, 0.36],
  [MATERIAL.dirt]: [0.78, 0.72, 0.48]
};

interface Ground {
  density: number;
  /** Local theme's dry tuft weight: savanna grass follows it. */
  dry: number;
  /** Clover meadow (lush grass) weight: wet jungle patches follow it. */
  lush: number;
  moisture: number;
  /** Forest floor weight (shade). */
  shaded: number;
  tint: Rgb;
  /** Dirt weight: paths and trodden ground (sparse, weedy, dry edges). */
  trodden: number;
}

/**
 * Grass cover in the alpine zones (ground-zone-field.ts, the ground's alpine and lichen grass): fewer, shorter tufts
 * and the ground's tints, so the 3D blades do not hide the zones.
 */
const ALPINE_COVER = { alpineThin: 0.2, lichenThin: 0.65 } as const;

const getZoneCoverKeep = (alpine: number, lichen: number) =>
  1 - alpine * ALPINE_COVER.alpineThin - lichen * ALPINE_COVER.lichenThin;

const toAlpineTint = (tint: Rgb, alpine: number, lichen: number): Rgb => {
  if (alpine <= 0) return tint;
  const grey = (tint[0] + tint[1] + tint[2]) / 3;
  return tint.map((value, channel) => {
    const alpineValue = value * GROUND_VARIANT_TUNING.alpineTint[channel]!;
    const lichenValue = (value + (grey - value) * GROUND_VARIANT_TUNING.lichenGrey) *
      GROUND_VARIANT_TUNING.lichenTint[channel]!;
    return value + (alpineValue + (lichenValue - alpineValue) * lichen - value) * alpine;
  }) as Rgb;
};

const GROUND_TINT_LIST = Object.entries(GROUND_TINTS).map(([material, color]): [number, Rgb] => [
  Number(material),
  color
]);

const getGroundVertex = (world: WorldData, x: number, z: number) =>
  Math.round(z) * (world.cellsX + 1) + Math.round(x);

/**
 * Painted bare-ground variants (map editor): swamp mud, cracked earth and tilled garden soil grow no grass cover
 * (owner 2026-11-17: tufts through tilled furrows look unnatural). The paint is sampled bilinearly and faded in
 * over BARE_PAINT, so the tufts thin out across the brush's soft border instead of a hard cut.
 */
const BARE_PAINT_CHANNELS = [GROUND_VARIANT_IDS.indexOf("swamp-mud"), GROUND_VARIANT_IDS.indexOf("cracked-earth"),
  TILLED_SOIL_VARIANT];
const BARE_PAINT = [0.12, 0.55] as const;

const readBarePaint = (world: WorldData, x: number, z: number) => {
  const paint = world.groundVariants;
  if (!paint) return 0;
  const stride = world.cellsX + 1;
  const cellX = Math.min(world.cellsX - 1, Math.max(0, Math.floor(x)));
  const cellZ = Math.min(world.cellsZ - 1, Math.max(0, Math.floor(z)));
  const fx = Math.min(1, Math.max(0, x - cellX)), fz = Math.min(1, Math.max(0, z - cellZ));
  let bare = 0;
  for (const channel of BARE_PAINT_CHANNELS) {
    const at = (vertex: number) => paint[vertex * GROUND_VARIANT_COUNT + channel]! / 255;
    const top = at(cellZ * stride + cellX) * (1 - fx) + at(cellZ * stride + cellX + 1) * fx;
    const bottom = at((cellZ + 1) * stride + cellX) * (1 - fx) + at((cellZ + 1) * stride + cellX + 1) * fx;
    bare = Math.max(bare, top * (1 - fz) + bottom * fz);
  }
  return smoothstep(BARE_PAINT[0], BARE_PAINT[1], bare);
};

/** Ground colour, density and wetness at a spot; the theme tints the grass (ochre, browner). */
const readGround = (
  world: WorldData,
  cover: ThemeCover,
  x: number,
  z: number,
  macro: MeadowMacro
): Ground => {
  const vertex = getGroundVertex(world, x, z);
  const weight = (material: number) => world.splat[vertex * MATERIAL_COUNT + material]! / 255;
  const tint: Rgb = [0, 0, 0];
  let total = 0;
  for (const [material, color] of GROUND_TINT_LIST) {
    const amount = weight(material);
    const meadow = material === MATERIAL.grass || material === MATERIAL.lushGrass;
    const tinted = meadow ? color.map((value, channel) => value * macro.tint[channel]!) : color;
    tint[0] += tinted[0]! * amount;
    tint[1] += tinted[1]! * amount;
    tint[2] += tinted[2]! * amount;
    total += amount;
  }
  const lush = weight(MATERIAL.lushGrass);
  const meadow = weight(MATERIAL.grass) + lush;
  const shaded = weight(MATERIAL.forestFloor);
  const trodden = weight(MATERIAL.dirt);
  const [alpine, lichen] = getAlpineZoneAt(world, vertex);
  const zoneSparse = getZoneCoverKeep(alpine, lichen) * (1 - readBarePaint(world, x, z));
  return {
    density: (meadow * (1 - trodden * 0.8) + shaded * 0.18) * zoneSparse,
    dry: cover.dry,
    lush,
    moisture: world.moisture[vertex]! / 255,
    shaded,
    tint: total > 0 ? toAlpineTint(tint.map((value, channel) =>
      (value / total) * cover.tint[channel]! * macro.brightness) as Rgb, alpine, lichen) : tint,
    trodden
  };
};

/** Ground that grows cover: meadow grass and forest floor (sand, dirt, rock, snow do not). */
const COVER_GROUNDS: number[] = [MATERIAL.grass, MATERIAL.lushGrass, MATERIAL.forestFloor];
/** Distance (cells) cover keeps from the edge of its ground, and the weight counted as inside. */
const EDGE_MARGIN = 0.75;
const INSIDE_WEIGHT: [number, number] = [0.6, 0.92];
const EDGE_OFFSETS: [number, number][] = [
  [0, 0],
  [EDGE_MARGIN, 0],
  [-EDGE_MARGIN, 0],
  [0, EDGE_MARGIN],
  [0, -EDGE_MARGIN]
];

/**
 * Per vertex 0..1 weight of the grass growing grounds; the gravel band where rock meets the
 * ground counts as an edge, so cover thins out before it. Only the vertices around the region
 * are filled (the cover samples reach one cell beyond its cells).
 */
const collectCoverGround = (world: WorldData, region: CellRegion) => {
  const stride = world.cellsX + 1;
  const weights = new Float32Array(stride * (world.cellsZ + 1));
  const { contact } = getRockContact(world);
  const maxX = Math.min(world.cellsX, region.maxX + 2);
  const maxZ = Math.min(world.cellsZ, region.maxZ + 2);
  for (let z = Math.max(0, region.minZ - 1); z <= maxZ; z += 1) {
    for (let x = Math.max(0, region.minX - 1); x <= maxX; x += 1) {
      const base = (z * stride + x) * MATERIAL_COUNT;
      const sum = COVER_GROUNDS.reduce(
        (total, material) => total + world.splat[base + material]!,
        0
      );
      weights[z * stride + x] = (sum / 255) * (1 - smoothstep(0.05, 0.5, contact(x, z)));
    }
  }
  return weights;
};

/**
 * 0..1 how deep inside its grass ground a spot is: the lowest ground weight at the spot and
 * EDGE_MARGIN around it, so cover stops short of the ground's edges instead of running into them.
 */
const getInsideFactor = (world: WorldData, ground: Float32Array, x: number, z: number) => {
  let lowest = 1;
  for (const [dx, dz] of EDGE_OFFSETS) {
    lowest = Math.min(lowest, sampleBilinear(world, ground, x + dx, z + dz));
  }
  return smoothstep(INSIDE_WEIGHT[0], INSIDE_WEIGHT[1], lowest);
};

/**
 * No meadow or forest floor at the spot's vertex: its density is 0, so any roll above 0 skips
 * it. Checked first, it spares the theme, ground and noise lookups of sea, sand and rock.
 */
const isBareGround = (world: WorldData, x: number, z: number) => {
  const base = getGroundVertex(world, x, z) * MATERIAL_COUNT;
  return COVER_GROUNDS.every((material) => world.splat[base + material] === 0);
};

/** 0..1 meadow and forest floor weight at a spot's nearest ground vertex (sand, dirt, rock, snow: 0). */
export const coverGroundWeight = (world: WorldData, x: number, z: number) => {
  const base = getGroundVertex(world, x, z) * MATERIAL_COUNT;
  return COVER_GROUNDS.reduce((total, material) => total + world.splat[base + material]!, 0) / 255;
};

const isCoverSpot = (world: WorldData, x: number, z: number) =>
  sampleBilinear(world, world.waterDepth, x, z) <= 0 &&
  sampleBilinear(world, world.coastDistance, x, z) >= 1.2 &&
  world.slopeClass[Math.floor(z) * world.cellsX + Math.floor(x)]! < SLOPE.steep;

/** Ecological patch fields: where clover, flowers, dry grass grow (irregular, not circles). */
export interface CoverPatches {
  clover: Noise2;
  clumps: Noise2;
  dry: Noise2;
  flowerHue: Noise2;
  flowers: Noise2;
}

const createPatches = (seed: number): CoverPatches => {
  const noise = (name: string) => createFbm(deriveSeed(seed, name), { octaves: 3 });
  return {
    clover: noise("cover-clover"),
    clumps: noise("grass-clumps"),
    dry: noise("cover-dry"),
    flowerHue: noise("cover-flower-hue"),
    flowers: noise("cover-flowers")
  };
};

/** Authored grass of a map-editor painted cell: a small dense patch of its chosen kind. */
const PAINTED_COVER_SAMPLES = 3;

const appendPaintedCover = (
  world: WorldData,
  cell: number,
  cellX: number,
  cellZ: number,
  macro: MeadowMacro,
  theme: ReturnType<typeof createThemeSampler>,
  raw: RawInstance[]
) => {
  const kind = getPaintedCoverKind(world, cell);
  if (kind === null) return;
  const random = createCellRandom(deriveSeed(world.seed, "cover-paint"), cell);
  for (let sample = 0; sample < PAINTED_COVER_SAMPLES; sample += 1) {
    const x = cellX + random(), z = cellZ + random();
    if (!isCoverSpot(world, x, z) || isBareGround(world, x, z)) continue;
    if (roadsideCoverWeight(world, x, z) === null) continue;
    const ground = readGround(world, theme.at(x, z).cover, x, z, macro);
    if (ground.density <= 0) continue;
    const variant = Math.floor(random() * getVariantCount(kind));
    raw.push({
      meshId: getMeshId(kind, variant),
      phase: random() * Math.PI * 2,
      rotation: random() * Math.PI * 2,
      scale: (0.75 + random() * 0.35) * (0.9 + ground.moisture * 0.3),
      sourceIndex: -1,
      stretch: 0.9 + random() * 0.25,
      tint: getCoverTint(kind, ground, 0.9 + random() * 0.2),
      x,
      y: sampleSmooth(world, world.heights, x, z),
      z
    });
  }
};

/** Placeholder in the meadow mix for a flower of the local patch colour. */
const ANY_FLOWER = -1;
const FLOWERING_COVER = new Set<number>([COVER.pinkFlower, COVER.whiteFlower, COVER.yellowFlower, COVER.thistle]);

/** Flower colour by patch: white and yellow stands, red / pink as the rarer accent. */
export const chooseFlower = (patches: CoverPatches, x: number, z: number, random: Random) => {
  if (random() < 0.18) return COVER.pinkFlower;
  return patches.flowerHue(x * 0.2, z * 0.2) > 0 ? COVER.whiteFlower : COVER.yellowFlower;
};

/** Chance multiplier of a cover kind the world's homeland favours (NATION-TERRAIN, nation content data). */
const FAVOURED_COVER_CHANCE = 1.8;

/**
 * Biome grass first: the savanna/jungle/forest kinds follow the existing theme, dryness, moisture
 * and canopy masks, blended by probability, so a border has no hard line. Nothing is consumed from
 * the cell stream where no biome applies, keeping the meadow mix unchanged.
 */
const chooseBiomeCoverKind = (
  world: WorldData,
  ground: Ground,
  position: { x: number; z: number },
  random: Random
) => {
  const weights = getBiomeGrassWeights(world, position.x, position.z, {
    dry: ground.dry,
    lush: ground.lush,
    moisture: ground.moisture,
    shaded: ground.shaded,
    trodden: ground.trodden
  });
  if (weights.savanna + weights.jungle + weights.forest <= 0.001) return null;
  return pickBiomeGrassKind(weights, random());
};

/**
 * Meadow mix: mostly grass, dry tufts in dry patches and along paths, clover and flowers in
 * their own patches, weeds by paths, thistles rare (about 85 % grass / weeds, 8 % dry, 3 %
 * flowers). Kinds the world's homeland favours (savanna tall/dry grass, jungle lush cover) get a boost.
 */
const chooseCoverKind = (
  world: WorldData,
  ground: Ground,
  patches: CoverPatches,
  cover: ThemeCover,
  position: { x: number; z: number },
  random: Random,
  favored?: ReadonlySet<number>
) => {
  const { x, z } = position;
  const biomeKind = chooseBiomeCoverKind(world, ground, position, random);
  if (biomeKind !== null) return biomeKind;
  if (ground.shaded > 0.5) return COVER.shortGrass;
  const open = 1 - ground.trodden;
  const flowerPatch = smoothstep(0.0, 0.45, patches.flowers(x * 0.12, z * 0.12)) * open;
  const dryPatch = Math.min(1, smoothstep(0.0, 0.5, patches.dry(x * 0.09, z * 0.09)) + cover.dry);
  const cloverPatch = smoothstep(0.15, 0.55, patches.clover(x * 0.16, z * 0.16));
  let roll = random();
  const chances: [number, number][] = [
    [ANY_FLOWER, (0.004 + flowerPatch * 0.1) * cover.flowers],
    [COVER.thistle, 0.0015 + ground.trodden * 0.004 + dryPatch * 0.002],
    [COVER.clover, cloverPatch * 0.28],
    [COVER.fieldWeed, 0.02 + ground.trodden * 0.15],
    [COVER.dryTuft, 0.015 + dryPatch * 0.18 + ground.trodden * 0.1],
    [COVER.seedGrass, 0.02 + dryPatch * 0.03],
    [COVER.tallGrass, (0.025 + ground.moisture * 0.06) * open]
  ];
  for (const [kind, chance] of chances) {
    roll -= favored?.has(kind) ? chance * FAVOURED_COVER_CHANCE : chance;
    if (roll >= 0) continue;
    return kind === ANY_FLOWER ? chooseFlower(patches, x, z, random) : kind;
  }
  return COVER.shortGrass;
};

const GROUND_TINTED = new Set<number>([
  COVER.forestGrass,
  COVER.jungleGrass,
  COVER.savannaGrass,
  COVER.shortGrass,
  COVER.tallGrass,
  COVER.dryTuft,
  COVER.seedGrass
]);
const HALF_TINTED = new Set<number>([COVER.clover, COVER.fieldWeed]);

/** Grass takes the ground colour, clover and weeds half of it, flowers keep their own. */
const getTintAmount = (kind: number) => {
  if (GROUND_TINTED.has(kind)) return 1;
  return HALF_TINTED.has(kind) ? 0.5 : 0.15;
};

/** The kind's authored tint over the ground colour; savanna shifts towards straw as the ground dries. */
const getKindTint = (kind: number, dry: number): Rgb | null => {
  const parameters = getBiomeGrassParameters(kind);
  if (!parameters) return null;
  const dryMix = Math.min(1, dry * 0.85);
  return parameters.tint.map((value, channel) =>
    value + (parameters.dryTint[channel]! - value) * dryMix) as Rgb;
};

export const getCoverTint = (kind: number, ground: Ground, shade: number): Rgb => {
  const amount = getTintAmount(kind);
  const base = ground.tint.map((value) => (1 + (value - 1) * amount) * shade) as Rgb;
  const kindTint = getKindTint(kind, ground.dry);
  if (!kindTint) return base;
  return base.map((value, channel) => value * kindTint[channel]!) as Rgb;
};

/**
 * T07 grass ring: the ground-matched short-grass tint at a point (the tuft tint without its random
 * shade), so the ring's blades take the colour of the tufts around them.
 */
export const createCoverTintSampler = (world: WorldData) => {
  const theme = createThemeSampler(world, world.themeWeights);
  return (x: number, z: number): Rgb => {
    const macro = sampleMeadowMacro(Math.floor(x) + 0.5, Math.floor(z) + 0.5);
    return getCoverTint(COVER.shortGrass, readGround(world, theme.at(x, z).cover, x, z, macro), 1);
  };
};

/**
 * The possessed ring's local biome blend (height/tint/sway) at the eye: the same masks the tufts
 * use, blended continuously so crossing a biome border changes the blades gradually.
 */
export const createBiomeGrassRingSampler = (world: WorldData) => {
  const theme = createThemeSampler(world, world.themeWeights);
  return (x: number, z: number) => {
    const macro = sampleMeadowMacro(Math.floor(x) + 0.5, Math.floor(z) + 0.5);
    const cover = theme.at(x, z).cover;
    const ground = readGround(world, cover, x, z, macro);
    const weights = getBiomeGrassWeights(world, x, z, {
      dry: ground.dry,
      lush: ground.lush,
      moisture: ground.moisture,
      shaded: ground.shaded,
      trodden: ground.trodden
    });
    return getBiomeGrassBlend(weights);
  };
};

/**
 * T07 grass ring: the share of the cover the alpine and lichen zones keep at a point (the tufts' thinning there), so
 * the ring's blades thin out over the same zones (ground-palette-4: they stayed a dense green lawn).
 */
export const getZoneCoverKeepAt = (world: WorldData, x: number, z: number) =>
  getZoneCoverKeep(...getAlpineZoneAt(world, getGroundVertex(world, x, z)));

/** Shore details (shells) inside the region, off roads, bridges, buildings and fields. */
const collectRegionShoreDetails = (world: WorldData, region: CellRegion, bare: (cell: number) => boolean) =>
  collectShoreDetails(world).filter(({ x, z }) =>
    x >= region.minX && x < region.maxX + 1 && z >= region.minZ && z < region.maxZ + 1 &&
    !bare(Math.floor(z) * world.cellsX + Math.floor(x)) && roadsideCoverWeight(world, x, z) !== null);

/** Shared deterministic inputs of the cover acceptance and the field-cover instance builder. */
export interface FieldCoverContext {
  bare: (cell: number) => boolean;
  coverGround: Float32Array;
  /** Cover kinds the world's homeland favours (NATION-TERRAIN); undefined keeps the meadow mix. */
  favored: ReadonlySet<number> | undefined;
  macro: (x: number, z: number) => MeadowMacro;
  patches: CoverPatches;
  theme: ReturnType<typeof createThemeSampler>;
  world: WorldData;
}

/** Build the per-region cover inputs once; both the instances and the cover field read them. */
export const createFieldCoverContext = (world: WorldData, region: CellRegion): FieldCoverContext => {
  const exclusions = getFieldCoverExclusions(world);
  const buildingExclusions = getBuildingGroundCoverCounts(world);
  const cropExclusions = getFieldCropCoverCells(world);
  return {
    bare: (cell) => Boolean(exclusions?.[cell]) || Boolean(buildingExclusions?.[cell]) ||
      Boolean(cropExclusions?.has(cell)),
    coverGround: collectCoverGround(world, region),
    favored: favoredCoverKinds(getWorldNationAffinity(world)),
    macro: (x, z) => sampleMeadowMacro(Math.floor(x) + 0.5, Math.floor(z) + 0.5),
    patches: createPatches(world.seed),
    theme: createThemeSampler(world, world.themeWeights),
    world
  };
};

/** The meadow ground at a point (colour, density, wetness, shade, trodden) and the theme's cover rules. */
export const readCoverGround = (context: FieldCoverContext, x: number, z: number) => {
  const cover = context.theme.at(x, z).cover;
  return { ...readGround(context.world, cover, x, z, context.macro(x, z)), cover };
};

/**
 * Expected field-cover acceptance (0..1) at a point: the density the instance rolls compare
 * against, with the edge and exclusion rules applied. It never draws a random value.
 */
export const getCoverAcceptance = (context: FieldCoverContext, x: number, z: number) => {
  const { world } = context;
  const cell = Math.floor(z) * world.cellsX + Math.floor(x);
  if (context.bare(cell) || isBareGround(world, x, z) || !isCoverSpot(world, x, z)) return 0;
  if (roadsideCoverWeight(world, x, z) === null) return 0;
  const cover = context.theme.at(x, z).cover;
  const ground = readGround(world, cover, x, z, context.macro(x, z));
  const clump = smoothstep(-0.45, 0.35, context.patches.clumps(x * 0.35, z * 0.35));
  const density = ground.density * (0.35 + clump * 0.75) * cover.density;
  return density * getInsideFactor(world, context.coverGround, x, z);
};

/**
 * Field cover (render only, not gameplay): grass everywhere grass grows, with local patches of
 * clover, wildflowers, dry tufts and weeds. Density is per renderer: 3D affords more tufts.
 * Every cell has its own random stream, so a region (map editor: the cover of edited ground) is
 * rebuilt the same way the whole island is.
 */
export const buildFieldCoverInstances = (
  world: WorldData,
  fog: Float32Array,
  samplesPerCell: number,
  region: CellRegion = { maxX: world.cellsX - 1, maxZ: world.cellsZ - 1, minX: 0, minZ: 0 }
) => {
  const context = createFieldCoverContext(world, region);
  const { bare, coverGround, patches, theme } = context;
  const seed = deriveSeed(world.seed, "grass");
  const raw: RawInstance[] = collectRegionShoreDetails(world, region, bare);
  forEachRegionCell(world, region, (cell, cellX, cellZ) => {
    if (bare(cell)) return;
    const random = createCellRandom(seed, cell);
    const macro = context.macro(cellX, cellZ);
    for (let sample = 0; sample < samplesPerCell; sample += 1) {
      const x = cellX + random();
      const z = cellZ + random();
      const roll = random();
      if (roll > 0 && isBareGround(world, x, z)) continue;
      const cover = theme.at(x, z).cover;
      const ground = readGround(world, cover, x, z, macro);
      const clump = smoothstep(-0.45, 0.35, patches.clumps(x * 0.35, z * 0.35));
      const density = ground.density * (0.35 + clump * 0.75) * cover.density;
      if (roll > density || !isCoverSpot(world, x, z)) continue;
      if (roll > density * getInsideFactor(world, coverGround, x, z)) continue;
      const selectedKind = chooseCoverKind(world, ground, patches, cover, { x, z }, random, context.favored);
      // Expedition scenery keeps foliage but replaces blooms; home meadows keep the original mix.
      const kind = world.expeditionKind && FLOWERING_COVER.has(selectedKind) ? COVER.shortGrass : selectedKind;
      const variant = Math.floor(random() * getVariantCount(kind));
      raw.push({
        meshId: getMeshId(kind, world.expeditionKind && kind === COVER.clover ? 0 : variant),
        phase: random() * Math.PI * 2,
        rotation: random() * Math.PI * 2,
        scale: (0.7 + random() * 0.4) * (0.85 + ground.moisture * 0.4) * (0.85 + clump * 0.3),
        sourceIndex: -1,
        stretch: 0.86 + random() * 0.3,
        tint: getCoverTint(kind, ground, 0.88 + random() * 0.24),
        x,
        y: sampleSmooth(world, world.heights, x, z),
        z
      });
    }
    appendPaintedCover(world, cell, cellX, cellZ, macro, theme, raw);
  });
  // Construction and roads apply last, so an edit never reshuffles the cell streams of other tufts.
  const grown: RawInstance[] = [];
  for (const item of raw) {
    if (bare(Math.floor(item.z) * world.cellsX + Math.floor(item.x))) continue;
    const fitted = fitRoadsideCover(world, item);
    if (fitted) grown.push(fitted);
  }
  return toInstances(world, fog, grown);
};
