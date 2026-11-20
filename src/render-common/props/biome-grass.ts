import { ISLAND_THEMES, THEME_COUNT } from "../../shared/world/generation/island-themes";
import { sampleBilinear } from "../../shared/world/grid-geometry";
import { smoothstep } from "../../shared/world/noise";
import type { WorldData } from "../../shared/world/world-data";
import { getCanopyField } from "../canopy-field";
import { COVER } from "./prop-mesh-layout";

type Rgb = [number, number, number];

/**
 * One biome grass kind. The model geometry is the owner's authored GLB (biome-grass-mesh.ts); the
 * numbers here are the selection/tint/LOD policy that the existing cover path reads, not a second
 * renderer. Height is the authored high-LOD range, so the kind reads as its model.
 */
export interface BiomeGrassParameters {
  /** Base instance-colour multiplier over the ground tint. */
  tint: Rgb;
  /** Dry-season pull of that tint (open, dry ground). */
  dryTint: Rgb;
  /** Authored high-LOD height range (world units), from the GLB bounds. */
  height: readonly [number, number];
  kind: number;
  name: string;
  /** Strongest share of the accepted tufts this kind may take. */
  selection: number;
  /** Sun-shadow pass: tall savanna casts, low shade grass does not. */
  shadowCasting: boolean;
  /** Wind weight multiplier over the GLB's authored COLOR_0.a. */
  sway: number;
  variants: number;
  /** Leaf flutter under the shared wind, for broad-bladed kinds. */
  windFlutter: number;
}

const SAVANNA: BiomeGrassParameters = {
  dryTint: [1.3, 1.04, 0.52],
  height: [0.83, 1],
  kind: COVER.savannaGrass,
  name: "Savanna grass",
  selection: 0.7,
  shadowCasting: true,
  sway: 0.72,
  tint: [1.16, 1.0, 0.58],
  variants: 8,
  windFlutter: 0.04
};

const JUNGLE: BiomeGrassParameters = {
  dryTint: [0.86, 0.94, 0.58],
  height: [0.43, 0.55],
  kind: COVER.jungleGrass,
  name: "Jungle grass",
  selection: 0.55,
  shadowCasting: false,
  sway: 1.12,
  tint: [0.7, 1.02, 0.6],
  variants: 8,
  windFlutter: 0.22
};

const FOREST: BiomeGrassParameters = {
  dryTint: [0.84, 0.78, 0.56],
  height: [0.23, 0.35],
  kind: COVER.forestGrass,
  name: "Forest grass",
  selection: 0.58,
  shadowCasting: false,
  sway: 0.62,
  tint: [0.64, 0.8, 0.64],
  variants: 8,
  windFlutter: 0.12
};

/** Append-only registry of the three biome cover kinds (data, never code branches). */
export const BIOME_GRASS: readonly BiomeGrassParameters[] = [FOREST, JUNGLE, SAVANNA];

const BIOME_GRASS_BY_KIND = new Map<number, BiomeGrassParameters>(
  BIOME_GRASS.map((parameters) => [parameters.kind, parameters])
);

export const getBiomeGrassParameters = (kind: number) => BIOME_GRASS_BY_KIND.get(kind);

export const isBiomeGrassKind = (kind: number) => BIOME_GRASS_BY_KIND.has(kind);

export interface BiomeGrassWeights {
  forest: number;
  jungle: number;
  savanna: number;
}

const themeWeight = (world: WorldData, vertex: number, theme: (typeof ISLAND_THEMES)[number]) =>
  world.themeWeights[vertex * THEME_COUNT + ISLAND_THEMES.indexOf(theme)]! / 255;

const getVertex = (world: WorldData, x: number, z: number) =>
  Math.round(z) * (world.cellsX + 1) + Math.round(x);

/** Ground signals the biome pick reads; the caller already sampled them for the cover mix. */
export interface BiomeGroundSignals {
  dry: number;
  lush: number;
  moisture: number;
  shaded: number;
  trodden: number;
}

/**
 * 0..selection weight of each biome grass at a point. Existing masks only, blended by probability:
 * - savanna: desert/dry theme weight x dryness x open ground (the Nubian/Persian deserts);
 * - jungle: tropical/swamp expedition theme (Maya/Indigenous islands are tropical) x wetness x
 *   canopy edge; on home islands the wet lush meadows stand in for the tropical theme;
 * - forest: temperate forest-floor weight x canopy shade.
 * Theme weights are already soft at borders, and the dryness/moisture/canopy terms are smoothstep
 * ramps, so no biome draws a hard line.
 */
export const getBiomeGrassWeights = (
  world: WorldData,
  x: number,
  z: number,
  ground: BiomeGroundSignals
): BiomeGrassWeights => {
  const vertex = getVertex(world, x, z);
  const canopy = sampleBilinear(world, getCanopyField(world), x, z);
  const dryness = 1 - smoothstep(0.25, 0.75, ground.moisture);
  const open = 1 - smoothstep(0.2, 0.75, canopy);
  const wet = smoothstep(0.55, 0.85, ground.moisture);
  const lush = smoothstep(0.25, 0.75, ground.lush);
  const canopyEdge = smoothstep(0.08, 0.3, canopy) * (1 - smoothstep(0.55, 0.85, canopy));
  const forestFloor = smoothstep(0.15, 0.6, ground.shaded);
  const deepShade = smoothstep(0.2, 0.7, canopy);
  const expedition = world.expeditionTheme;
  const desertTheme = themeWeight(world, vertex, "desert") + themeWeight(world, vertex, "dirt") * 0.55;
  const desertSignal = expedition === "desert" ? 1 : smoothstep(0.2, 0.85, desertTheme);
  const drySignal = Math.min(1, 0.3 + ground.dry * 0.4 + dryness * 0.5);
  let tropicalSignal = 0;
  if (expedition === "tropical") tropicalSignal = 1;
  else if (expedition === "swamp") tropicalSignal = 0.7;
  const temperateSignal = expedition === undefined || expedition === "forest" ? 1 : 0;
  const savanna = desertSignal * drySignal * open * SAVANNA.selection;
  const jungle = (tropicalSignal * (0.5 + wet * 0.5) * (0.55 + canopyEdge * 0.45) +
    wet * lush * canopyEdge * 0.35) * JUNGLE.selection;
  const forest = temperateSignal * forestFloor * deepShade * FOREST.selection;
  const total = savanna + jungle + forest;
  const scale = total > 1 ? 1 / total : 1;
  return { forest: forest * scale, jungle: jungle * scale, savanna: savanna * scale };
};

/** Weighted pick among the three kinds (one caller random value); null when no biome applies. */
export const pickBiomeGrassKind = (weights: BiomeGrassWeights, random: number) => {
  const total = weights.savanna + weights.jungle + weights.forest;
  if (random >= total) return null;
  if (random < weights.savanna) return SAVANNA.kind;
  return random < weights.savanna + weights.jungle ? JUNGLE.kind : FOREST.kind;
};

/** Blend of the local biome parameters for the possessed ring, weighted without a random draw. */
export interface BiomeGrassBlend {
  heightScale: number;
  influence: number;
  sway: number;
  tint: Rgb;
}

const blendTo = (from: number, to: number, amount: number) => from + (to - from) * amount;

/** Smooth height/tint/sway of the local biome mix (1/neutral where no biome grass dominates). */
export const getBiomeGrassBlend = (weights: BiomeGrassWeights): BiomeGrassBlend => {
  const total = weights.savanna + weights.jungle + weights.forest;
  if (total <= 0.001) return { heightScale: 1, influence: 0, sway: 1, tint: [1, 1, 1] };
  const influence = Math.min(1, total * 1.2);
  const average = (pick: (parameters: BiomeGrassParameters) => number) =>
    (weights.savanna * pick(SAVANNA) + weights.jungle * pick(JUNGLE) + weights.forest * pick(FOREST)) / total;
  const tint: Rgb = [0, 0, 0];
  for (const channel of [0, 1, 2] as const) {
    const blended = average((parameters) => parameters.tint[channel]);
    tint[channel] = blendTo(1, blended, influence);
  }
  const heightScale = blendTo(1, average((parameters) => parameters.height[1] / 0.26), influence);
  return { heightScale, influence, sway: blendTo(1, average((parameters) => parameters.sway), influence), tint };
};
