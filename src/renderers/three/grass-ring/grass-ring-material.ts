import { DoubleSide, GLSL3, type IUniform, RawShaderMaterial, type Texture, Vector4 } from "three";

import { SURFACE_COLOR_OUTPUT_GLSL } from "../../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../../render-common/shaders/common-glsl";
import {
  GRASS_RING_BLADE_GLSL,
  GRASS_RING_COLOR_GLSL,
  GRASS_RING_GROUND_GLSL,
  GRASS_RING_SHARE_GLSL
} from "../../../render-common/shaders/grass-ring-glsl";
import { COVER_FIELD_GLSL, RAIN_LUSH_TINT_GLSL } from "../../../render-common/shaders/ground-common-glsl";
import { SCORCH_GRASS_GLSL } from "../../../render-common/shaders/ground-scorch-glsl";
import { PROP_FOG_GLSL, PROP_SHADING_GLSL, WIND_GLSL } from "../../../render-common/shaders/prop-glsl";
import { SEASON_RING_GLSL } from "../../../render-common/shaders/season-ground-glsl";
import {
  TRAFFIC_GRASS_GLSL,
  TRAFFIC_WEAR_FIELD_GLSL
} from "../../../render-common/shaders/traffic-wear-glsl";
import { SUN_SHADOW_GLSL } from "../three-shadows";

/**
 * T07 blade vertex: one instance per ring tile, one strip per blade (position = tile-local root x,
 * height parameter t, root z; blade = rank, side). Blade shape is a quadratic Bezier bent by its
 * lean and the shared wind field, with length kept; widths stay real scale near the eye and grow
 * to about one pixel further out.
 */
const GRASS_RING_VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec2 blade;
in vec2 tile;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
/** Local biome grass: height scale, tint rgb (field-cover.ts createBiomeGrassRingSampler). */
uniform vec4 uRingBiome;
/** Wind weight multiplier of the local biome kind. */
uniform float uRingSway;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${WIND_GLSL}
${PROP_FOG_GLSL}
${COVER_FIELD_GLSL}
${TRAFFIC_WEAR_FIELD_GLSL}
${TRAFFIC_GRASS_GLSL}
${SCORCH_GRASS_GLSL}
${GRASS_RING_GROUND_GLSL}
${GRASS_RING_SHARE_GLSL}
${GRASS_RING_BLADE_GLSL}
${GRASS_RING_COLOR_GLSL}
${SEASON_RING_GLSL}
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
/**
 * Blade root width range (world units), close to the tufts' 0.04 blades so the ring and the tufts
 * beyond it read as one meadow (grass-lod 2026-11-13: 0.008-0.013 left the near meadow sparse).
 */
const vec2 RING_BLADE_WIDTH = vec2(0.02, 0.032);

void hideVertex() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}

void main() {
  if (uRingEye.z <= 0.0 || isRingTileHidden(tile)) { hideVertex(); return; }
  float rank = blade.x;
  vec2 root = getRingRoot(tile, position.xz);
  vec2 toEye = uRingEye.xy - root;
  float eyeDistance = length(toEye);
  float threshold = getRingShare(uRingShape, eyeDistance, root);
  if (rank >= threshold) { hideVertex(); return; }
  RingGround ground = sampleRingGround(root);
  vec2 roadside = getRingRoadside(ground.roadside);
  // The alpine and lichen zones thin the blades like the tufts (fewer, and shorter through the density).
  float density = getRingGroundDensity(root) * roadside.x * ground.zoneKeep * getSeasonRingKeep();
  float keep = getRingBladeKeep(rank, threshold * density) * uRingEye.z;
  if (keep <= 0.0 || isHiddenByFog(1.0, root)) { hideVertex(); return; }
  vec4 random = hashBlade(tile, rank * RING_PATCH_BLADES);
  float height = mix(0.1, 0.26, random.x) * mix(0.75, 1.15, density) * roadside.y * keep * uRingBiome.x;
  float width = max(mix(RING_BLADE_WIDTH.x, RING_BLADE_WIDTH.y, random.y), uRingEye.w * eyeDistance * 0.9) * keep;
  float angle = random.z * 6.2831853;
  vec2 facing = vec2(cos(angle), sin(angle));
  vec2 eyeDirection = toEye / max(eyeDistance, 1e-3);
  float edgeOn = 1.0 - abs(dot(facing, eyeDirection));
  facing = normalize(mix(facing, eyeDirection * sign(dot(facing, eyeDirection) + 1e-4), edgeOn * 0.35));
  vec2 across = vec2(-facing.y, facing.x);
  float phase = random.w * 6.2831853;
  vec2 bend = facing * height * mix(0.15, 0.6, fract(random.x * 7.13 + random.w));
  bend += windDisplacement(root, phase, uTime) * (height / 0.2) * uRingSway;
  float bendLength = length(bend);
  if (bendLength > height * 0.9) bend *= height * 0.9 / bendLength;
  float rise = sqrt(max(height * height - dot(bend, bend), height * height * 0.19));
  vec3 base = vec3(root.x, ground.height, root.y);
  vec3 control = base + vec3(bend.x * 0.2, rise * 0.62, bend.y * 0.2);
  vec3 tip = base + vec3(bend.x, rise, bend.y);
  float t = position.y;
  vec3 spine = mix(mix(base, control, t), mix(control, tip, t), t);
  vec3 tangent = normalize(mix(control - base, tip - control, t));
  vec3 side = vec3(across.x, 0.0, across.y);
  float flutter = sin(uTime * 6.1 + phase * 3.0) * 0.004 * t * t * (0.4 + length(uWind));
  vec3 world = spine + side * (blade.y * width * 0.5 * pow(1.0 - t, 0.8) + flutter);
  vec3 normal = normalize(cross(side, tangent));
  vNormal = normalize(normal + side * blade.y * 0.45);
  vWorld = world;
  vec3 tone = pickRingTone(random.z * 0.37 + random.y * 0.63, fract(random.w * 13.7));
  float rootShade = mix(0.5, 1.0, clamp((world.y - base.y) / 0.1, 0.0, 1.0));
  // The tufts' sunlit tips (shapePlantMesh: 0.9 at the root to 1.06 at the tip), so both read alike.
  float tipLight = mix(0.9, 1.06, t);
  vColor = ground.tint * uRingBiome.yzw * tone * rootShade * tipLight
    * mix(vec3(1.0), ${RAIN_LUSH_TINT_GLSL}, uRain) * getSeasonRingTint(t);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/** Sun shadow receiving, the shared prop light (back-light translucency) and the surface finish. */
const GRASS_RING_FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_SHADING_GLSL}
${SUN_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}

void main() {
  vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), 0.4));
  vec3 lit = lightProp(vColor, normal, sampleSunShadow(vWorld), vWorld.xz);
  fragColor = vec4(finishSurface(applyFogOfWar(lit, 1.0, vWorld.xz), vWorld), 1.0);
}
`;

export interface GrassRingMaterialInput {
  ground: Texture;
  uniforms: Record<string, IUniform>;
}

/** One material shared by every band: opaque, no discard, no alpha to coverage (early-Z stays). */
export const createGrassRingMaterial = ({ ground, uniforms }: GrassRingMaterialInput) =>
  new RawShaderMaterial({
    fragmentShader: GRASS_RING_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms: {
      ...uniforms,
      uRingBiome: { value: new Vector4(1, 1, 1, 1) },
      uRingEye: { value: new Vector4(0, 0, 0, 0) },
      uRingGround: { value: ground },
      uRingShape: { value: new Vector4(1, 3, 16, 1) },
      uRingSway: { value: 1 }
    },
    vertexShader: GRASS_RING_VERTEX_GLSL
  });
