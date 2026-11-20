/**
 * GLSL of the R06c volumetric sun shafts (renderers/three/frame-god-rays.ts), GLSL ES 3.00. A
 * half-resolution pass marches each view ray from the eye to the frame's depth (or `maxDistance`)
 * through the sun shadow map's cascades, a separable depth-aware blur removes its 4 × 4 step
 * jitter, and the linear output pass adds the result before tonemapping with a depth-aware 2 × 2
 * upsample (FRAME_GOD_RAYS_APPLY_GLSL). The targets store (in-scattered light, view depth).
 */

import { VOLUMETRIC_LIGHT_STEPS } from "../volumetric-light";
import { createViewDepthGlsl } from "./frame-ao-glsl";

/** Sky (depth 1) in the view-depth channel: beyond every tolerance of a surface. */
const SKY_VIEW_DEPTH = "65000.0";

/**
 * The march. `shadowGlsl` is the sun shadow lookup (SUN_SHADOW_GLSL: its uniforms and cascade
 * helpers). The shadow matrices are affine, so each cascade's projected ray is a straight segment:
 * its ends are transformed once per texel and every step is one lerp, one tile test and one
 * depth fetch. Steps outside every cascade count as lit; `maxDistance` stays inside them. Steps
 * are spaced quadratically (dense near the eye, where shafts resolve), and the extinction makes
 * the result saturate within a few tens of units: the depth gradient stays the analytic fog's,
 * the shafts are the shadowed / lit difference along the near part of each ray. Shadowed air takes
 * back at most the analytic fog's own sun lobe (R06a phase), so shadows along the view away from the
 * sun stay as faint as that airlight (haze-depth-edge, 2026-11-16).
 * The 4 × 4 Bayer start offset is fixed per texel (no temporal noise to shimmer when turning);
 * the blur's tent cancels it exactly on smooth regions, which leaves 16 × STEPS phases: no bands.
 */
export const createGodRayMarchFragmentGlsl = (shadowGlsl: string) => `precision highp float;
precision highp sampler2D;
${shadowGlsl}
uniform sampler2D uDepth;
/** Clip space to world space (the camera's world matrix × inverse projection). */
uniform mat4 uGodRayClipToWorld;
uniform vec3 uGodRayEye;
/** The light direction (towards the sun). */
uniform vec3 uGodRaySun;
/** x march distance, y extinction per unit, z Henyey-Greenstein g, w lobe share. */
uniform vec4 uGodRayMedium;
/** Share of the fully lit in-scattering subtracted (VolumetricLightTuning.pivot). */
uniform float uGodRayPivot;
/** The drawing buffer size (the half-resolution size rounds up). */
uniform vec2 uGodRayFullSize;
${createViewDepthGlsl("uGodRayDepthToView", "godRayViewDepth")}
out vec4 fragColor;
const int STEPS = ${VOLUMETRIC_LIGHT_STEPS};
const float BAYER[16] = float[](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
  3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

/** Henyey-Greenstein × 4π (mean 1) with the R06a airlight's g: the analytic fog's sun lobe. */
float godRayLobe(float cosTheta) {
  float g = uGodRayMedium.z;
  float g2 = g * g;
  float denominator = max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4);
  return (1.0 - g2) / (denominator * sqrt(denominator));
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  ivec2 pixel = min(texel * 2, ivec2(uGodRayFullSize) - 1);
  float depth = texelFetch(uDepth, pixel, 0).r;
  bool sky = depth >= 1.0;
  vec2 ndc = (vec2(pixel) + 0.5) / uGodRayFullSize * 2.0 - 1.0;
  vec4 clipPoint = uGodRayClipToWorld * vec4(ndc, sky ? 1.0 : depth * 2.0 - 1.0, 1.0);
  vec3 ray = clipPoint.xyz / clipPoint.w - uGodRayEye;
  float rayLength = max(length(ray), 1e-4);
  vec3 direction = ray / rayLength;
  float marched = sky ? uGodRayMedium.x : min(rayLength, uGodRayMedium.x);
  float viewDepth = sky ? ${SKY_VIEW_DEPTH} : godRayViewDepth(depth);
  int count = int(uShadowCascades.x + 0.5);
  vec3 starts[3];
  vec3 spans[3];
  vec2 origins[3];
  for (int index = 0; index < 3; index++) {
    if (index >= count) break;
    mat4 matrix = sunShadowMatrix(index);
    starts[index] = (matrix * vec4(uGodRayEye, 1.0)).xyz;
    spans[index] = (matrix * vec4(direction * marched, 0.0)).xyz;
    origins[index] = sunShadowOrigin(index);
  }
  ivec2 tile = texel & 3;
  float jitter = (BAYER[tile.y * 4 + tile.x] + 0.5) / 16.0;
  float lit = 0.0;
  float full = 0.0;
  for (int stepIndex = 0; stepIndex < STEPS; stepIndex++) {
    // Quadratic spacing: dense near the eye, where shafts are resolved; dt = 2 s L ds.
    float spacing = (float(stepIndex) + jitter) / float(STEPS);
    float share = spacing * spacing;
    float visible = 1.0;
    for (int index = 0; index < 3; index++) {
      if (index >= count) break;
      vec3 projected = starts[index] + spans[index] * share;
      if (sunShadowEdge(projected) < 0.0) continue;
      vec2 uv = origins[index] + projected.xy * uShadowAtlas;
      visible = projected.z - SHADOW_DEPTH_BIAS > textureLod(uShadowMap, uv, 0.0).r ? 0.0 : 1.0;
      break;
    }
    float weight = exp(-uGodRayMedium.y * share * marched) * 2.0 * spacing;
    lit += visible * weight;
    full += weight;
  }
  float lobe = godRayLobe(dot(direction, uGodRaySun));
  // The shafts' phase: the lobe mixed with even scattering, so shafts beside the sun stay visible.
  float phase = mix(1.0, lobe, uGodRayMedium.w);
  // Shadowed air takes back at most the sun lobe the analytic fog put there: with the sun behind the
  // eye that lobe is weak (R06a's cooler haze), so a long shadow along the view (a wall's dusk
  // shadow beside the eye) no longer strips a warm band out of the sea. Within ~56 degrees of the
  // sun the lobe exceeds the phase and this equals (lit - pivot * full) * phase.
  float shadowPhase = min(phase, lobe);
  float inscatter = ((1.0 - uGodRayPivot) * full * phase - (full - lit) * shadowPhase) * marched / float(STEPS);
  fragColor = vec4(inscatter, viewDepth, 0.0, 1.0);
}`;

/**
 * One axis of the half-resolution depth-aware tent blur (0.5, 1, 1, 1, 0.5), run along x then y:
 * the product weighs every phase of the 4 × 4 jitter tile equally, so the pattern cancels.
 */
export const GOD_RAY_BLUR_FRAGMENT_GLSL = `precision highp float;
precision highp sampler2D;
uniform sampler2D uGodRays;
/** x absolute, y relative depth tolerance. */
uniform vec2 uGodRayTolerance;
uniform ivec2 uGodRayAxis;
out vec4 fragColor;
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(uGodRays, 0) - 1;
  vec2 centre = texelFetch(uGodRays, texel, 0).rg;
  float tolerance = uGodRayTolerance.x + centre.g * uGodRayTolerance.y;
  float sum = 0.0;
  float weight = 0.0;
  for (int offset = -2; offset <= 2; offset++) {
    vec2 tap = texelFetch(uGodRays, clamp(texel + uGodRayAxis * offset, ivec2(0), last), 0).rg;
    float tent = abs(offset) == 2 ? 0.5 : 1.0;
    float similar = max(0.0, 1.0 - abs(tap.g - centre.g) / tolerance);
    sum += tap.r * tent * similar;
    weight += tent * similar;
  }
  fragColor = vec4(sum / max(weight, 1e-4), centre.g, 0.0, 1.0);
}`;

/**
 * Output-pass chunk (defined by FRAME_GOD_RAYS): a pixel's linear radiance with the shafts: the
 * in-scattered light of lit air added, that of shadowed air (below the pivot) taken away. The
 * 2 × 2 half-resolution neighbours are weighted bilinearly and by view-depth similarity; with no
 * similar neighbour (a thin silhouette the half-resolution pass never saw) the closest in depth
 * stands in, so a branch against the shafts gets no dark or bright halo. `uGodRayColor` carries
 * the strength: zero skips every fetch (the strategic view, night, overcast).
 */
export const FRAME_GOD_RAYS_APPLY_GLSL = `
uniform sampler2D uGodRayTexture;
uniform sampler2D uGodRayDepth;
/** Linear shaft colour × strength (R06a sun lobe colour); zero: no shafts this frame. */
uniform vec3 uGodRayColor;
/** x absolute, y relative depth tolerance. */
uniform vec2 uGodRayApplyTolerance;
${createViewDepthGlsl("uGodRayApplyDepthToView", "godRayApplyViewDepth")}

/** The darkening of shadowed air never takes more than this share of a pixel's light. */
const float GOD_RAY_FLOOR = 0.6;

vec3 frameGodRays(vec3 linear, ivec2 pixel) {
  if (max(uGodRayColor.r, max(uGodRayColor.g, uGodRayColor.b)) <= 0.0) return linear;
  float depth = texelFetch(uGodRayDepth, pixel, 0).r;
  float viewDepth = depth >= 1.0 ? ${SKY_VIEW_DEPTH} : godRayApplyViewDepth(depth);
  float tolerance = uGodRayApplyTolerance.x + viewDepth * uGodRayApplyTolerance.y;
  vec2 position = vec2(pixel) * 0.5;
  ivec2 base = ivec2(floor(position));
  vec2 fraction = position - vec2(base);
  ivec2 last = textureSize(uGodRayTexture, 0) - 1;
  float sum = 0.0;
  float weight = 0.0;
  float closest = 0.0;
  float closestGap = 1e30;
  for (int index = 0; index < 4; index++) {
    ivec2 offset = ivec2(index & 1, index >> 1);
    vec2 tap = texelFetch(uGodRayTexture, min(base + offset, last), 0).rg;
    vec2 axis = mix(1.0 - fraction, fraction, vec2(offset));
    float gap = abs(tap.g - viewDepth);
    float tapWeight = axis.x * axis.y * max(0.0, 1.0 - gap / tolerance);
    sum += tap.r * tapWeight;
    weight += tapWeight;
    if (gap < closestGap) {
      closestGap = gap;
      closest = tap.r;
    }
  }
  float light = weight > 1e-3 ? sum / weight : closest;
  return max(linear + uGodRayColor * light, linear * GOD_RAY_FLOOR);
}`;
