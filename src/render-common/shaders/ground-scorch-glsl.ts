import { RUIN_SCORCH } from "../ruin-scorch";
import { glslLiteral } from "./glsl-literal";

/**
 * Scorched ground around ruins (GROUND-PALETTE step 7): ash ring, sooty core, charcoal bits and pale ash flecks with a
 * noisy edge, per ruin disc (ruin-scorch.ts: x, z, radius, strength). Shared with the TSL twin (terrain-scorch.ts).
 */
export const GROUND_SCORCH_TUNING = {
  /** Ash ring (the volcanic ash soil, about 92/88/84 display), sooty core, charcoal bits, pale ash flecks. */
  ash: [0.36, 0.345, 0.33],
  soot: [0.11, 0.1, 0.095],
  charcoal: [0.045, 0.04, 0.04],
  fleck: [0.6, 0.58, 0.55],
  /** Ring and core extents as shares of the radius (start, end of the fade), and the edge noise (radius share). */
  ring: [0.72, 1.12],
  core: [0.15, 0.68],
  edgeNoise: 0.35,
  /** How much of the ground the burn takes at full strength. */
  share: 0.92,
  /**
   * Grass cover on the burn (ground-palette-4): none inside this share of the radius, full from the second (the
   * ground's ash ring fades over 0.72–1.12 with ±0.18 edge noise); the tufts thin by their rank in between, so the
   * edge is soft. The cut scales with the disc strength, so the grass returns as the scorch fades.
   */
  grass: [0.75, 1.2]
} as const;

const vec2Literal = (values: readonly number[]) => `vec2(${values.map(value => glslLiteral(value)).join(", ")})`;
const vec3Literal = (values: readonly number[]) => `vec3(${values.map(value => glslLiteral(value)).join(", ")})`;
const tuning = GROUND_SCORCH_TUNING;

const SCORCH_UNIFORMS_GLSL = `
const int SCORCH_MAX = ${RUIN_SCORCH.maxDiscs};
uniform vec4 uScorch[SCORCH_MAX];
uniform int uScorchCount;`;

/**
 * Grass cover keep 0..1 over the ruin discs (vertex stage of the field cover tufts and the grass ring blades); a
 * uniform early-out costs nothing without ruins.
 */
export const SCORCH_GRASS_GLSL = `${SCORCH_UNIFORMS_GLSL}
const vec2 SCORCH_GRASS = ${vec2Literal(tuning.grass)};

float scorchGrassKeep(vec2 root) {
  if (uScorchCount <= 0) return 1.0;
  float keep = 1.0;
  for (int index = 0; index < SCORCH_MAX; index++) {
    if (index >= uScorchCount) break;
    vec4 disc = uScorch[index];
    float distance = length(root - disc.xy) / max(disc.z, 0.01);
    keep = min(keep, 1.0 - (1.0 - smoothstep(SCORCH_GRASS.x, SCORCH_GRASS.y, distance)) * disc.w);
  }
  return keep;
}
`;

/** Needs GROUND_VARIANT_LAYERS_GLSL (getVariantNoise) and the variant's GroundSample. */
export const GROUND_SCORCH_GLSL = `${SCORCH_UNIFORMS_GLSL}
const vec3 SCORCH_ASH = ${vec3Literal(tuning.ash)};
const vec3 SCORCH_SOOT = ${vec3Literal(tuning.soot)};
const vec3 SCORCH_CHARCOAL = ${vec3Literal(tuning.charcoal)};
const vec3 SCORCH_FLECK = ${vec3Literal(tuning.fleck)};
const vec2 SCORCH_RING = ${vec2Literal(tuning.ring)};
const vec2 SCORCH_CORE = ${vec2Literal(tuning.core)};

/** x the burn (ash ring and core), y the sooty core share, by the strongest ruin disc over this point. */
vec2 getRuinScorch(vec2 xz) {
  vec2 burn = vec2(0.0);
  for (int index = 0; index < SCORCH_MAX; index++) {
    if (index >= uScorchCount) break;
    vec4 disc = uScorch[index];
    vec2 offset = xz - disc.xy;
    float reach = disc.z * SCORCH_RING.y * 1.2;
    if (dot(offset, offset) > reach * reach) continue;
    float edge = (getVariantNoise(xz * 0.9 + disc.xy) - 0.5) * ${glslLiteral(tuning.edgeNoise)};
    float distance = length(offset) / disc.z + edge;
    float ring = 1.0 - smoothstep(SCORCH_RING.x, SCORCH_RING.y, distance);
    float core = 1.0 - smoothstep(SCORCH_CORE.x, SCORCH_CORE.y, distance);
    burn = max(burn, vec2(ring, core) * disc.w);
  }
  return burn;
}

/** The burn over the ground: ash ring, sooty core with charcoal bits and ash flecks, matte. */
void applyRuinScorch(inout GroundSample ground, vec2 xz) {
  if (uScorchCount <= 0) return;
  vec2 burn = getRuinScorch(xz);
  if (burn.x <= 0.0) return;
  float bits = getVariantNoise(mat2(0.8, 0.6, -0.6, 0.8) * xz * 3.7 + 11.0);
  vec3 soot = mix(SCORCH_SOOT, SCORCH_CHARCOAL, smoothstep(0.6, 0.78, bits));
  soot = mix(soot, SCORCH_FLECK, smoothstep(0.8, 0.92, getVariantNoise(xz * 4.3 + 5.0)) * 0.5);
  vec3 ash = SCORCH_ASH * mix(0.88, 1.1, getVariantNoise(xz * 1.3 + 2.0));
  float core = clamp(burn.y / max(burn.x, 1e-3), 0.0, 1.0);
  ground.albedo = mix(ground.albedo, mix(ash, soot, core), burn.x * ${glslLiteral(tuning.share)});
  ground.roughness = mix(ground.roughness, 0.95, burn.x);
}
`;
