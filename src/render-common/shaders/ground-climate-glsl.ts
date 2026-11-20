import { glslLiteral } from "./glsl-literal";

/**
 * Climate ground detail (GROUND-PALETTE step 5, owner-approved tile proposal round 4): heather moorland, dune grass
 * behind the beaches, the tidal silt flats and the seaweed wrack line. ALU only. Shared by the full and the lite
 * ground (after the palette, like
 * the variants: no registers across the layer loops) and the TSL twin (terrain-climate.ts) through these constants.
 */
export const GROUND_CLIMATE_TUNING = {
  /**
   * Heather: the climate's heather share × grass × exposure (the sunny-slope dryness or the upland height, whichever
   * is larger) × broad patches. Dryness and height ranges, patch noise range, and the most heather a pixel gets.
   */
  heatherDry: [0.03, 0.12],
  heatherHeight: [0.9, 1.9],
  heatherPatch: [0.32, 0.62],
  heatherShare: 0.85,
  /** Purple-brown shrub (display albedo at the lawn's mean brightness) and the pinker bloom by a finer noise. */
  heatherShrub: [0.3, 0.22, 0.2],
  heatherBloom: [0.4, 0.24, 0.34],
  heatherGrassLuma: 0.3,
  /** Dune grass: zone × sand share × clump noise (start, full) and the pale green-straw marram colour. */
  duneClumps: [0.5, 0.72],
  duneGrass: [0.42, 0.45, 0.24],
  duneShare: 0.8,
  /** Dune grass grows above the wet beach: height above the water where it starts and is full. */
  duneHeight: [0.35, 0.8],
  /**
   * Tidal silt flats: beach coast type (coast below), flat ground (normal y), the band from the water's edge to just
   * above the water (ground-palette-4: the band reached 0.14 under the water, so a submerged shoal top drew a round
   * dark blotch), the band's noise wobble (height units) that frays its contour, a broad calm-bay noise, the finer
   * noise that breaks the patch edge, and the wet sheen's wetness.
   */
  tidalCoast: [0.08, 0.3],
  tidalFlat: [0.93, 0.98],
  tidalDepth: [-0.05, 0.01],
  tidalHeight: [0.12, 0.4],
  tidalWobble: 0.08,
  tidalCalm: [0.6, 0.75],
  tidalEdge: [0.3, 0.7],
  tidalWetness: 0.5,
  /**
   * Silt colour: the sand's own brightness, mostly greyed (grey share) and cooled (tint), with a faint mottle; how
   * much of the sand it replaces. Pale wet silt, never darker than the damp sand around it.
   */
  tidalGrey: 0.7,
  tidalTint: [0.97, 0.98, 1.0],
  tidalShare: 0.8,
  /**
   * Wrack line: height above the water of the high-tide line (just above the swash run-up), its wobble along the
   * shore, the weed band's half width (start/full fade) and the damp stain's, the broken segments and the colour.
   */
  wrackHeight: 0.24,
  wrackWobble: 0.06,
  wrackWidth: [0.01, 0.028],
  wrackStain: 0.05,
  wrackBroken: [0.5, 0.62],
  wrackOlive: [0.2, 0.2, 0.09],
  wrackShare: 0.9,
  /**
   * Tropical jungle floor (step 7: Maya, Indigenous, tropical islands): the forest floor tile (about 59/78/39) turns
   * dark, damp, warm olive soil (about 52/55/28).
   */
  jungleFloor: [0.88, 0.7, 0.72]
} as const;

const vec2Literal = (values: readonly number[]) => `vec2(${values.map(value => glslLiteral(value)).join(", ")})`;
const vec3Literal = (values: readonly number[]) => `vec3(${values.map(value => glslLiteral(value)).join(", ")})`;
const tuning = GROUND_CLIMATE_TUNING;

/** Needs GROUND_VARIANT_LAYERS_GLSL (getVariantNoise) and the variant's GroundSample. */
export const GROUND_CLIMATE_GLSL = `
const vec2 HEATHER_DRY = ${vec2Literal(tuning.heatherDry)};
const vec2 HEATHER_HEIGHT = ${vec2Literal(tuning.heatherHeight)};
const vec2 HEATHER_PATCH = ${vec2Literal(tuning.heatherPatch)};
const vec3 HEATHER_SHRUB = ${vec3Literal(tuning.heatherShrub)};
const vec3 HEATHER_BLOOM = ${vec3Literal(tuning.heatherBloom)};
const vec2 DUNE_CLUMPS = ${vec2Literal(tuning.duneClumps)};
const vec3 DUNE_GRASS = ${vec3Literal(tuning.duneGrass)};
const vec2 DUNE_HEIGHT = ${vec2Literal(tuning.duneHeight)};
const vec2 TIDAL_COAST = ${vec2Literal(tuning.tidalCoast)};
const vec2 TIDAL_FLAT = ${vec2Literal(tuning.tidalFlat)};
const vec2 TIDAL_DEPTH = ${vec2Literal(tuning.tidalDepth)};
const vec2 TIDAL_HEIGHT = ${vec2Literal(tuning.tidalHeight)};
const vec2 TIDAL_CALM = ${vec2Literal(tuning.tidalCalm)};
const vec2 TIDAL_EDGE = ${vec2Literal(tuning.tidalEdge)};
const float TIDAL_WETNESS = ${glslLiteral(tuning.tidalWetness)};
const vec3 TIDAL_TINT = ${vec3Literal(tuning.tidalTint)};
const vec2 WRACK_WIDTH = ${vec2Literal(tuning.wrackWidth)};
const vec2 WRACK_BROKEN = ${vec2Literal(tuning.wrackBroken)};
const vec3 WRACK_OLIVE = ${vec3Literal(tuning.wrackOlive)};
const vec3 JUNGLE_FLOOR_TINT = ${vec3Literal(tuning.jungleFloor)};

/** Heather moorland 0..1 on the exposed grass of a cold climate (heather: the climate's share). */
float getHeatherMask(float grass, float heather, float dry, vec3 world) {
  if (heather <= 0.0 || grass < 0.01) return 0.0;
  float exposed = max(smoothstep(HEATHER_DRY.x, HEATHER_DRY.y, dry),
    smoothstep(HEATHER_HEIGHT.x, HEATHER_HEIGHT.y, world.y));
  float patches = smoothstep(HEATHER_PATCH.x, HEATHER_PATCH.y, getVariantNoise(world.xz * 0.19 + 47.0));
  return grass * heather * exposed * patches * ${glslLiteral(tuning.heatherShare)};
}

/** Purple-brown heather over the grass, pinker where it blooms; keeps the lawn's light and dark grain. */
void applyHeather(inout GroundSample ground, float mask, vec2 xz) {
  if (mask <= 0.0) return;
  float grain = dot(ground.albedo, vec3(0.333)) / ${glslLiteral(tuning.heatherGrassLuma)};
  float bloom = smoothstep(0.4, 0.8, getVariantNoise(xz * 2.3 + 13.0));
  ground.albedo = mix(ground.albedo, mix(HEATHER_SHRUB, HEATHER_BLOOM, bloom) * clamp(grain, 0.6, 1.5), mask);
}

/** Jungle forest floor under the tropical canopy (forest: the raw forest floor share; jungle: the climate's). */
void applyJungleFloor(inout GroundSample ground, float forest, float jungle) {
  float share = clamp(forest * jungle, 0.0, 1.0);
  if (share <= 0.0) return;
  ground.albedo *= mix(vec3(1.0), JUNGLE_FLOOR_TINT, share);
}

/** Dune grass clumps on the sand behind a beach (zone: ground-zone-field.ts dune zone). */
void applyDuneGrass(inout GroundSample ground, float zone, float sand, float height, vec2 xz) {
  float share = zone * sand * smoothstep(DUNE_HEIGHT.x, DUNE_HEIGHT.y, height);
  if (share <= 0.01) return;
  float clumps = smoothstep(DUNE_CLUMPS.x, DUNE_CLUMPS.y, getVariantNoise(xz * 1.4 + 61.0) + share * 0.3 - 0.15);
  float blades = getVariantNoise(mat2(0.6, -0.8, 0.8, 0.6) * xz * 3.1 + 7.0);
  vec3 grass = DUNE_GRASS * mix(0.8, 1.15, blades);
  ground.albedo = mix(ground.albedo, grass, clumps * share * ${glslLiteral(tuning.duneShare)});
}

/**
 * Tidal silt flat 0..1: flat beach ground in calm bays from the water's edge to just above the water. The band's
 * contour wobbles and a finer noise breaks the patch edge, so no shoal or bay contour draws a clean round shape.
 */
float getTidalFlat(float coast, float sand, float height, vec3 normal, vec2 xz, float cold) {
  float wobble = ${glslLiteral(tuning.tidalWobble)};
  if (height > TIDAL_HEIGHT.y + wobble || height < TIDAL_DEPTH.x - wobble || sand < 0.05) return 0.0;
  float calm = smoothstep(TIDAL_CALM.x, TIDAL_CALM.y, getVariantNoise(xz * 0.045 + 71.0));
  if (calm <= 0.0) return 0.0;
  float beach = 1.0 - smoothstep(TIDAL_COAST.x, TIDAL_COAST.y, coast);
  float level = smoothstep(TIDAL_FLAT.x, TIDAL_FLAT.y, normal.y);
  float wobbled = height + (getVariantNoise(xz * 0.7 + 19.0) - 0.5) * wobble * 2.0;
  float band = smoothstep(TIDAL_DEPTH.x, TIDAL_DEPTH.y, wobbled)
    * (1.0 - smoothstep(TIDAL_HEIGHT.x, TIDAL_HEIGHT.y, wobbled));
  float tidalFlat = beach * level * band * calm * sand * (1.0 - cold);
  return tidalFlat * smoothstep(TIDAL_EDGE.x, TIDAL_EDGE.y, getVariantNoise(xz * 1.3 + 41.0) + tidalFlat * 0.45 - 0.1);
}

/** Pale grey wet silt over the sand: the sand's brightness, greyed and cooled, faintly mottled. */
void applyTidalSilt(inout GroundSample ground, float tidal, vec2 xz) {
  if (tidal <= 0.0) return;
  float luma = dot(ground.albedo, vec3(0.2126, 0.7152, 0.0722));
  vec3 silt = mix(ground.albedo, vec3(luma), ${glslLiteral(tuning.tidalGrey)}) * TIDAL_TINT;
  silt *= mix(0.94, 1.04, getVariantNoise(mat2(0.8, -0.6, 0.6, 0.8) * xz * 2.4 + 23.0));
  ground.albedo = mix(ground.albedo, silt, tidal * ${glslLiteral(tuning.tidalShare)});
}

/**
 * Seaweed wrack: x damp stain, y weed share of a thin, wavy, broken band of olive tangles at the high-tide line
 * (open: 0 on frozen and snowy shores).
 */
vec2 getWrackLine(float height, float coast, float sand, vec2 xz, float open) {
  if (abs(height - ${glslLiteral(tuning.wrackHeight)}) > ${glslLiteral(tuning.wrackWobble + tuning.wrackStain)}
    || sand < 0.3 || open <= 0.0) return vec2(0.0);
  float wobble = (getVariantNoise(xz * 0.35 + 83.0) - 0.5) * ${glslLiteral(tuning.wrackWobble * 2)}
    + (getVariantNoise(xz * 1.7 + 5.0) - 0.5) * 0.02;
  float offset = abs(height - ${glslLiteral(tuning.wrackHeight)} - wobble);
  float beach = (1.0 - smoothstep(0.15, 0.4, coast)) * sand * open;
  float weed = 1.0 - smoothstep(WRACK_WIDTH.x, WRACK_WIDTH.y, offset);
  float broken = smoothstep(WRACK_BROKEN.x, WRACK_BROKEN.y, getVariantNoise(xz * 0.5 + 97.0));
  float tangles = smoothstep(0.25, 0.75, getVariantNoise(mat2(0.8, 0.6, -0.6, 0.8) * xz * 3.3 + 11.0));
  float stain = 1.0 - smoothstep(0.0, ${glslLiteral(tuning.wrackStain)}, offset);
  return vec2(stain * broken * 0.5, weed * broken * mix(0.45, 1.0, tangles)) * beach;
}

/** The wrack over the sand: a faint damp stain and the olive weed. */
void applyWrackLine(inout GroundSample ground, vec2 wrack, vec2 xz) {
  if (wrack.x + wrack.y <= 0.0) return;
  ground.albedo *= 1.0 - wrack.x * 0.14;
  float shade = mix(0.75, 1.2, getVariantNoise(xz * 2.6 + 3.0));
  ground.albedo = mix(ground.albedo, WRACK_OLIVE * shade, wrack.y * ${glslLiteral(tuning.wrackShare)});
}
`;
