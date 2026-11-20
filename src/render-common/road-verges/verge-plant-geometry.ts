import { rgb, srgbToLinear } from "../color";
import { foliageCardPoseSurface } from "../plants/climber-foliage-geometry";
import { cross, normalize, type Vec3 } from "../props/mesh-builder";
import type { VergeFoliageTileId } from "./verge-foliage-atlas-layout";
import { vergeFoliageCardVertices } from "./verge-foliage-atlas-manifest";

/** Temperate verge species (card V-R02a): trample band A, short-grass band B, herb band C. */
export const VERGE_SPECIES = ["plantain", "dandelion", "clover", "grass", "daisy", "yarrow"] as const;
export type VergeSpecies = typeof VERGE_SPECIES[number];
export type VergeDetail = "high" | "minimal";

/** Per-plant triangle ceilings (card V-R02a): High 120, Minimal 60. */
export const VERGE_TRIANGLE_LIMIT: Readonly<Record<VergeDetail, number>> = { high: 120, minimal: 60 };

/** Worker-safe vertex data of one verge plant on the verge foliage atlas (one shared material). */
export interface VergePlantMesh {
  colors: Float32Array;
  indices: Uint16Array;
  normals: Float32Array;
  positions: Float32Array;
  uvs: Float32Array;
}

type Linear = readonly [number, number, number];
const linear = (hex: number): Linear => srgbToLinear(...rgb(hex));

/** Vivid, readable species greens (vertex tint over the neutral atlas tissue). */
const GREEN: Readonly<Record<VergeSpecies, Linear>> = {
  clover: linear(0x52b040), daisy: linear(0x62a838), dandelion: linear(0x78bc38),
  grass: linear(0x86c83c), plantain: linear(0x5eaa36), yarrow: linear(0x7eae52)
};
/**
 * Gameplay-readable size of each species over its botanical proportions (the recipes below are
 * authored at about real scale, 1 unit = 1.6 m). Band C herbs stay at most 0.45 units tall.
 */
const DISPLAY_SCALE: Readonly<Record<VergeSpecies, number>> = {
  clover: 1.75, daisy: 1.2, dandelion: 1.75, grass: 1.25, plantain: 1.55, yarrow: 1.05
};
const NATURAL: Linear = [1, 1, 1];
/**
 * Flower head size per level: the whole-plant Minimal cards are also the far tier on every preset,
 * where heads a few pixels wide must still read as colour, so their heads are drawn larger.
 */
const HEAD_SCALE: Readonly<Record<VergeDetail, number>> = { high: 1.15, minimal: 1.4 };
/** Red clover florets (the clover head tile takes the card tint): the verge's pink accent. */
const RED_CLOVER: Linear = linear(0xe0629c);

interface Card {
  curl?: number;
  facing: Vec3;
  position: Vec3;
  size: number;
  tile: VergeFoliageTileId;
  tint: Linear;
  up: Vec3;
}

const seeded = (seed: number) => {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

const UP: Vec3 = [0, 1, 0];
const horizontal = (azimuth: number): Vec3 => [Math.sin(azimuth), 0, Math.cos(azimuth)];
const tilted = (azimuth: number, elevation: number): Vec3 =>
  [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)];
const lift = (point: Vec3, by: Vec3, scale: number): Vec3 =>
  [point[0] + by[0] * scale, point[1] + by[1] * scale, point[2] + by[2] * scale];

interface RingSpec {
  count: number;
  curl: number;
  /** Elevation of the leaf axis above the ground (radians), plus a random spread. */
  elevation: readonly [number, number];
  height?: number;
  random: () => number;
  size: readonly [number, number];
  tile: VergeFoliageTileId;
  tint: Linear;
}

/** Basal leaves fanned round the crown, rising at `elevation` and arching back down by `curl`. */
const leafRing = (cards: Card[], spec: RingSpec) => {
  const offset = spec.random() * Math.PI * 2;
  for (let index = 0; index < spec.count; index += 1) {
    const azimuth = offset + index / spec.count * Math.PI * 2 + (spec.random() - .5) * .5;
    const elevation = spec.elevation[0] + spec.random() * (spec.elevation[1] - spec.elevation[0]);
    const size = spec.size[0] + spec.random() * (spec.size[1] - spec.size[0]);
    const up = tilted(azimuth, elevation);
    cards.push({ curl: spec.curl * size, facing: normalize(cross(cross(up, UP), up)), position:
      [Math.sin(azimuth) * .006, spec.height ?? .006, Math.cos(azimuth) * .006], size, tile: spec.tile,
    tint: spec.tint, up });
  }
};

/** A near-vertical card leaning `lean` towards `azimuth`; `crossedPair` adds the 90° twin. */
const upright = (cards: Card[], tile: VergeFoliageTileId, base: Vec3, size: number, azimuth: number, lean: number,
  tint: Linear, crossedPair = false) => {
  const up = tilted(azimuth, Math.PI / 2 - lean);
  for (const turn of crossedPair ? [0, Math.PI / 2] : [0]) {
    cards.push({ facing: horizontal(azimuth + Math.PI / 2 + turn), position: base, size, tile, tint, up });
  }
};

/** A flower head (centre-pivot top-view tile) facing the sky, tipped `tilt` towards `azimuth`. */
const head = (cards: Card[], tile: VergeFoliageTileId, centre: Vec3, size: number, azimuth: number, tilt: number) =>
  cards.push({ facing: tilted(azimuth, Math.PI / 2 - tilt), position: centre, size, tile, tint: NATURAL,
    up: horizontal(azimuth + Math.PI / 2) });

/** Top point of an upright card of `size` (tile pivot near the bottom, tip near the top). */
const tipOf = (base: Vec3, size: number, azimuth: number, lean: number): Vec3 =>
  lift(base, tilted(azimuth, Math.PI / 2 - lean), size * .93);

/** Flat whole-plant card on the ground (Minimal rosettes). */
const groundCard = (cards: Card[], tile: VergeFoliageTileId, size: number, azimuth: number, tint: Linear) =>
  cards.push({ curl: -.04 * size, facing: UP, position: [0, .01, 0], size, tile, tint, up: horizontal(azimuth) });

type Recipe = (cards: Card[], random: () => number, detail: VergeDetail) => void;

const flowerOnStalk = (cards: Card[], random: () => number, stalk: number, headTile: VergeFoliageTileId,
  headSize: number, tint: Linear, crossedStalk: boolean) => {
  const azimuth = random() * Math.PI * 2, lean = .12 + random() * .22, base: Vec3 = [0, .004, 0];
  upright(cards, "flower-stalk", base, stalk, azimuth, lean, tint, crossedStalk);
  head(cards, headTile, tipOf(base, stalk, azimuth, lean), headSize, azimuth, .35 + random() * .3);
};

const RECIPES: Readonly<Record<VergeSpecies, Recipe>> = {
  plantain: (cards, random, detail) => {
    const tint = GREEN.plantain;
    if (detail === "minimal") groundCard(cards, "plantain-rosette", .3, random() * 6.3, tint);
    else leafRing(cards, { count: 7, curl: .28, elevation: [.22, .5], random, size: [.12, .15],
      tile: "plantain-leaf", tint });
    for (let spike = 0; spike < (detail === "high" ? 2 : 1); spike += 1)
      upright(cards, "plantain-spike", [0, .004, 0], .19 + random() * .05, random() * 6.3, .1 + random() * .25,
        NATURAL, detail === "high");
  },
  dandelion: (cards, random, detail) => {
    const tint = GREEN.dandelion;
    if (detail === "minimal") groundCard(cards, "dandelion-rosette", .28, random() * 6.3, tint);
    else leafRing(cards, { count: 9, curl: .22, elevation: [.12, .4], random, size: [.12, .15],
      tile: "dandelion-leaf", tint });
    for (let flower = 0; flower < 3; flower += 1)
      flowerOnStalk(cards, random, .1 + random() * .06, "dandelion-head", .085 * HEAD_SCALE[detail], NATURAL, false);
  },
  clover: (cards, random, detail) => {
    const tint = GREEN.clover, leaves = detail === "high" ? 9 : 3;
    for (let leaf = 0; leaf < leaves; leaf += 1) {
      const azimuth = random() * Math.PI * 2, reach = .015 + random() * .045;
      upright(cards, "clover-leaf", [Math.sin(azimuth) * reach, .003, Math.cos(azimuth) * reach],
        .085 + random() * .03, azimuth, .35 + random() * .35, tint);
    }
    for (let flower = 0; flower < 2; flower += 1)
      upright(cards, "clover-flower", [(random() - .5) * .04, .003, (random() - .5) * .04],
        (.085 + random() * .025) * HEAD_SCALE[detail],
        random() * 6.3, .1 + random() * .25, RED_CLOVER, detail === "high");
  },
  grass: (cards, random, detail) => {
    const tint = GREEN.grass, fans = detail === "high" ? 5 : 2;
    const offset = random() * Math.PI;
    for (let fan = 0; fan < fans; fan += 1)
      upright(cards, "grass-blades", [(random() - .5) * .02, .003, (random() - .5) * .02], .18 + random() * .06,
        offset + fan / fans * Math.PI + (random() - .5) * .3, .08 + random() * .12, tint);
    for (let culm = 0; culm < (detail === "high" ? 2 : 1); culm += 1)
      upright(cards, "grass-seedhead", [0, .003, 0], .24 + random() * .06, random() * 6.3, .1 + random() * .2,
        NATURAL, detail === "high");
  },
  daisy: (cards, random, detail) => {
    const tint = GREEN.daisy;
    if (detail === "minimal") {
      const clump = .27 + random() * .04, azimuth = random() * 6.3;
      upright(cards, "daisy-clump", [0, .004, 0], clump, azimuth, .05, tint, true);
      // Two sky-facing heads over the clump: its painted side-on heads vanish from the isometric camera.
      for (const turn of [0, 2.1, 4.2]) {
        const centre = lift([0, clump * .78, 0], horizontal(azimuth + turn), .05);
        head(cards, "daisy-head", centre, .085 * HEAD_SCALE.minimal, azimuth + turn, .3);
      }
      return;
    }
    leafRing(cards, { count: 6, curl: .2, elevation: [.35, .75], random, size: [.1, .12], tile: "daisy-leaf", tint });
    for (let flower = 0; flower < 3; flower += 1)
      flowerOnStalk(cards, random, .22 + random() * .08, "daisy-head", .08 * HEAD_SCALE.high, tint, false);
  },
  yarrow: (cards, random, detail) => {
    const tint = GREEN.yarrow, leaves = detail === "high" ? 6 : 2;
    leafRing(cards, { count: leaves, curl: .15, elevation: [.55, 1], random, size: [.15, .19],
      tile: "yarrow-leaf", tint });
    const azimuth = random() * Math.PI * 2, lean = .08 + random() * .1, stalk = .3 + random() * .06;
    upright(cards, "flower-stalk", [0, .004, 0], stalk, azimuth, lean, tint, detail === "high");
    const top = tipOf([0, .004, 0], stalk, azimuth, lean);
    head(cards, "yarrow-umbel", top, .11 * HEAD_SCALE[detail], azimuth, .15);
    head(cards, "yarrow-umbel", lift(top, [.02, -.015, -.012], 1), .08 * HEAD_SCALE[detail], azimuth + 2, .5);
  }
};

/**
 * Ground plants are lit like the meadow round them: card normals lean towards the sky, so upright
 * stalks and side-on heads do not turn grey under a high sun.
 */
const SKY_NORMAL = .75;
const skyward = (normal: Vec3) => normalize([normal[0], normal[1] + SKY_NORMAL, normal[2]]);

const assemble = (cards: readonly Card[], scale: number): VergePlantMesh => {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [];
  const indices: number[] = [];
  for (const card of cards) {
    const surface = foliageCardPoseSurface(card, vergeFoliageCardVertices(card.tile)), first = positions.length / 3;
    for (const [index, point] of surface.positions.entries()) {
      positions.push(point[0] * scale, point[1] * scale, point[2] * scale);
      normals.push(...skyward(surface.normals[index]!)); uvs.push(...surface.uvs[index]!);
      colors.push(...card.tint);
    }
    for (const index of surface.indices) indices.push(first + index);
  }
  return { colors: Float32Array.from(colors), indices: Uint16Array.from(indices),
    normals: Float32Array.from(normals), positions: Float32Array.from(positions), uvs: Float32Array.from(uvs) };
};

/**
 * One authored verge plant per species and detail level (High parts or Minimal whole-plant cards).
 * Both levels draw from one seed, so a plant keeps its flower stalks and lean when its tier changes;
 * placements vary it by yaw, scale and height stretch.
 */
export const createVergePlantMesh = (species: VergeSpecies, detail: VergeDetail) => {
  const cards: Card[] = [];
  RECIPES[species](cards, seeded(VERGE_SPECIES.indexOf(species) * 97 + 5), detail);
  return assemble(cards, DISPLAY_SCALE[species]);
};

const radii = new Map<VergeSpecies, number>();

/**
 * Measured horizontal reach of a species at placement scale 1: the larger of its High and Minimal
 * meshes plus a small allowance for High leaf flutter. Verge cover starts where this reach ends.
 */
export const vergePlantRadius = (species: VergeSpecies) => {
  const cached = radii.get(species);
  if (cached !== undefined) return cached;
  let radius = 0;
  for (const detail of ["high", "minimal"] as const) {
    const { positions } = createVergePlantMesh(species, detail);
    for (let index = 0; index < positions.length; index += 3)
      radius = Math.max(radius, Math.hypot(positions[index]!, positions[index + 2]!));
  }
  radii.set(species, radius + .01);
  return radius + .01;
};
