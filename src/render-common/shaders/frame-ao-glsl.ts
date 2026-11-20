/**
 * GLSL of the R12b ambient occlusion (renderers/three/frame-ao.ts), GLSL ES 3.00. A prepass turns
 * the frame's resolved depth into half-resolution view depth, a GTAO pass works on it (normals
 * rebuilt from depth, orthographic and perspective cameras), a separable depth-aware blur removes
 * its 4×4 noise pattern, and the output pass applies it with a depth-aware 2×2 upsample
 * (FRAME_AO_APPLY_GLSL). The AO targets store (visibility, view depth), so the blur reads one texel.
 */

import type { ActiveAmbientOcclusion } from "../quality";
import { SKY_LIGHT_GLSL } from "./common-glsl";

export interface AmbientOcclusionTuning {
  /**
   * World-space height above the tangent plane below which a sample does not occlude: flat ground
   * stays clean (no banding from near-coplanar samples) while real contact is far above it.
   */
  bias: number;
  /** Depth tolerance of the blur and upsample: absolute view units plus a share of the view depth. */
  depthTolerance: { absolute: number; relative: number };
  /** Share of the radius over which a sample's occlusion fades out (halo control at depth jumps). */
  falloff: number;
  /** Screen radius cap in full-resolution pixels (texture cache and cost at close range). */
  maxRadiusPixels: number;
  /** Occlusion search radius in world units (a settler is about 1.06 tall). */
  radius: number;
  /**
   * Contrast curve of the visibility before the mix: pow(ao, power). Above 1 it deepens real
   * crevices (low visibility) much more than open, nearly flat surfaces (visibility close to 1).
   */
  power: number;
  /** How much of the occlusion reaches the image: mix(1, pow(ao, power), strength). */
  strength: number;
  /**
   * Share of the direct sunlight the occlusion spares (AO-AMBIENT): 1 darkens only the ambient
   * part of a pixel's light, 0 darkens all of it (R12b). Needs the sun shadow map; without it the
   * whole pixel is occluded as before.
   */
  sunlit: number;
}

/** The values a choice sets: the depth of the shading, never the sample count or the passes. */
export type AmbientOcclusionLevelTuning = Pick<AmbientOcclusionTuning, "power" | "radius" | "strength" | "sunlit">;

/** Shared values of every choice; `power`, `radius`, `strength` and `sunlit` come from AO_LEVEL_TUNING. */
export const AO_TUNING: Omit<AmbientOcclusionTuning, keyof AmbientOcclusionLevelTuning> = {
  bias: 0.03,
  depthTolerance: { absolute: 0.25, relative: 0.02 },
  falloff: 0.6,
  maxRadiusPixels: 64
};

/**
 * Per choice (owner 2026-11-09: the options must differ visibly). Soft is the R12b owner-round
 * tuning. Strong deepens the contrast curve and widens the radius: contact under eaves, at
 * building feet and in beds reads clearly darker and wider, while open ground (visibility near 1)
 * stays clean. Dramatic (owner 2026-11-09) keeps the earlier dark Strong look: Strong's curve and
 * radius with `sunlit` 0, so the occlusion also darkens directly sunlit surfaces. Same samples,
 * passes and shaders for every choice (only uniforms differ), so the same cost.
 */
export const AO_LEVEL_TUNING: Readonly<Record<ActiveAmbientOcclusion, AmbientOcclusionLevelTuning>> = {
  soft: { power: 1.8, radius: 1.3, strength: 1, sunlit: 1 },
  strong: { power: 3.2, radius: 1.8, strength: 1, sunlit: 1 },
  dramatic: { power: 3.2, radius: 1.8, strength: 1, sunlit: 0 }
};

/** One fullscreen triangle (the compositor's vertex stage). */
export const AO_TRIANGLE_VERTEX_GLSL = `precision highp float;
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Writes only the alpha the blending lets through: the AO weight mask (1 apply, 0 excluded). */
export const AO_MASK_FRAGMENT_GLSL = `precision highp float;
uniform float uMaskAlpha;
out vec4 fragColor;
void main() {
  fragColor = vec4(0.0, 0.0, 0.0, uMaskAlpha);
}`;

/**
 * Linear view depth from a depth-buffer value: viewDepth = -(x * ndcZ + y) / (z * ndcZ + w), x..w
 * from rows 2 and 3 of the inverse projection (`uniform`), as the function `name`.
 */
export const createViewDepthGlsl = (uniform: string, name: string) => `
uniform vec4 ${uniform};
float ${name}(float depth) {
  float ndcZ = depth * 2.0 - 1.0;
  return -(${uniform}.x * ndcZ + ${uniform}.y) / (${uniform}.z * ndcZ + ${uniform}.w);
}`;

const VIEW_DEPTH_GLSL = createViewDepthGlsl("uAoDepthToView", "viewDepthOf");

/** Sky (depth 1) in the half-resolution view-depth texture: far beyond any occlusion radius. */
export const AO_SKY_VIEW_DEPTH = 65000;

/** GTAO slice and step counts of the half-resolution pass (shared with the TSL chain). */
export const AO_GTAO_SLICES = 2;
export const AO_GTAO_STEPS = 3;

/** 4x4 Bayer tile of the slice and step rotation, row by row (shared with the TSL chain). */
export const AO_BAYER_TILE: readonly number[] = [
  0, 8, 2, 10, 12, 4, 14, 6,
  3, 11, 1, 9, 15, 7, 13, 5
];

/** Offsets and weights of the depth-aware separable blur's five taps (uAoAxis order). */
export const AO_BLUR_RADIUS = 2;
export const AO_BLUR_TENT_WEIGHTS = [0.5, 1] as const;

/**
 * Half-resolution view-depth prepass: texel i holds the linear view depth of full-resolution pixel
 * 2i. One fetch per texel; the GTAO taps then read this small float texture instead of scattering
 * over the full-resolution depth-stencil one (texture cache and the per-tap unprojection).
 */
export const AO_DEPTH_FRAGMENT_GLSL = `precision highp float;
precision highp sampler2D;
uniform sampler2D uDepth;
out vec4 fragColor;
${VIEW_DEPTH_GLSL}
void main() {
  float depth = texelFetch(uDepth, ivec2(gl_FragCoord.xy) * 2, 0).r;
  fragColor = vec4(depth >= 1.0 ? ${AO_SKY_VIEW_DEPTH.toFixed(1)} : viewDepthOf(depth), 0.0, 0.0, 1.0);
}`;

/**
 * Half-resolution GTAO (after Jimenez et al. 2016 and Intel XeGTAO): 2 slices × 3 steps per side
 * over the view-depth prepass. View positions come from the projection's scale and offset
 * (orthographic and perspective cameras alike), the normal from the closer neighbour on each axis;
 * slices rotate by a 4×4 Bayer pattern the blur removes exactly. Samples fade to the tangent-plane
 * horizon with distance (no halos at depth jumps) and below a small height above that plane (flat
 * ground stays clean); off-screen samples, the sky and sub-pixel radii return full visibility.
 * Output: r visibility, g view depth, b the direct sun share (AO_DIRECT_SHARE_GLSL; 0 without it).
 * `prelude` follows the precision statements: empty, or `#define AO_DIRECT_SHARE` with the sun
 * shadow lookup and AO_DIRECT_SHARE_GLSL.
 */
export const createAoGtaoFragmentGlsl = (prelude: string) => `precision highp float;
precision highp sampler2D;
${prelude}
uniform sampler2D uViewDepth;
/** x radius (world), y projection scale (P[1][1] * full height / 2), z max radius (px), w ortho. */
uniform vec4 uAoParams;
/** x 1 / P[0][0], y 1 / P[1][1], zw the projection's NDC offset (off-centre frusta). */
uniform vec4 uAoUnproject;
/** The drawing buffer size (the half-resolution size rounds up). */
uniform vec2 uAoFullSize;
/** x falloff share of the radius, y tangent-plane bias (world). */
uniform vec2 uAoShape;
out vec4 fragColor;
const float PI = 3.14159265;
const float HALF_PI = 1.57079633;
const int SLICES = ${AO_GTAO_SLICES};
const int STEPS = ${AO_GTAO_STEPS};
const float BAYER[16] = float[](${AO_BAYER_TILE.slice(0, 8).map(value => value.toFixed(1)).join(", ")},
  ${AO_BAYER_TILE.slice(8).map(value => value.toFixed(1)).join(", ")});
ivec2 depthSize;

/** Texel i stands for full-resolution pixel 2i, whose NDC centre is (4i + 1) / fullSize - 1. */
vec3 viewPositionAt(ivec2 texel, float viewDepth) {
  vec2 ndc = (vec2(texel) * 4.0 + 1.0) / uAoFullSize - 1.0;
  vec2 xy = (ndc - uAoUnproject.zw) * uAoUnproject.xy * mix(viewDepth, 1.0, uAoParams.w);
  return vec3(xy, -viewDepth);
}

vec3 viewPositionAt(ivec2 texel) {
  ivec2 clamped = clamp(texel, ivec2(0), depthSize - 1);
  return viewPositionAt(clamped, texelFetch(uViewDepth, clamped, 0).r);
}

float fastAcos(float x) {
  float result = (-0.156583 * abs(x) + HALF_PI) * sqrt(1.0 - abs(x));
  return x >= 0.0 ? result : PI - result;
}

/** The neighbour difference closer in depth; at a screen border the one inside the screen. */
vec3 closerDifference(vec3 forward, vec3 backward, bool atStart, bool atEnd) {
  if (atStart) return forward;
  if (atEnd) return backward;
  return abs(forward.z) < abs(backward.z) ? forward : backward;
}

/** The view normal from the neighbour closer in depth on each axis (no smearing over edges). */
vec3 normalAt(ivec2 texel, vec3 centre) {
  vec3 right = viewPositionAt(texel + ivec2(1, 0)) - centre;
  vec3 left = centre - viewPositionAt(texel - ivec2(1, 0));
  vec3 up = viewPositionAt(texel + ivec2(0, 1)) - centre;
  vec3 down = centre - viewPositionAt(texel - ivec2(0, 1));
  ivec2 last = depthSize - 1;
  vec3 alongX = closerDifference(right, left, texel.x <= 0, texel.x >= last.x);
  vec3 alongY = closerDifference(up, down, texel.y <= 0, texel.y >= last.y);
  return normalize(cross(alongX, alongY));
}

float horizonCos(ivec2 texel, vec3 centre, vec3 normal, vec3 viewVector, float lowCos, vec2 falloff) {
  // Off-screen samples know nothing: clamping them would replicate the border depth (a dark seam).
  if (any(lessThan(texel, ivec2(0))) || any(greaterThanEqual(texel, depthSize))) return lowCos;
  vec3 delta = viewPositionAt(texel, texelFetch(uViewDepth, texel, 0).r) - centre;
  float separation = max(length(delta), 1e-4);
  float weight = clamp(separation * falloff.x + falloff.y, 0.0, 1.0);
  weight *= smoothstep(uAoShape.y, 2.0 * uAoShape.y, dot(delta, normal));
  return mix(lowCos, dot(delta / separation, viewVector), weight);
}

float sliceVisibility(float phi, ivec2 texel, vec3 centre, vec3 normal, vec3 viewVector,
  float radiusTexels, float stepNoise, vec2 falloff) {
  vec2 omega = vec2(cos(phi), sin(phi));
  vec3 direction = vec3(omega, 0.0);
  vec3 orthoDirection = direction - dot(direction, viewVector) * viewVector;
  vec3 axis = normalize(cross(orthoDirection, viewVector));
  vec3 projectedNormal = normal - axis * dot(normal, axis);
  float projectedLength = length(projectedNormal);
  float cosNormal = clamp(dot(projectedNormal, viewVector) / max(projectedLength, 1e-4), 0.0, 1.0);
  float angle = sign(dot(orthoDirection, projectedNormal)) * fastAcos(cosNormal);
  float lowForward = cos(angle + HALF_PI);
  float lowBackward = cos(angle - HALF_PI);
  float forward = lowForward;
  float backward = lowBackward;
  for (int sampleIndex = 0; sampleIndex < STEPS; sampleIndex++) {
    float t = (float(sampleIndex) + stepNoise) / float(STEPS);
    vec2 offset = omega * max(t * t * radiusTexels, float(sampleIndex) + 1.0);
    ivec2 shift = ivec2(round(offset));
    forward = max(forward, horizonCos(texel + shift, centre, normal, viewVector, lowForward, falloff));
    backward = max(backward, horizonCos(texel - shift, centre, normal, viewVector, lowBackward, falloff));
  }
  float h0 = angle + clamp(-fastAcos(backward) - angle, -HALF_PI, HALF_PI);
  float h1 = angle + clamp(fastAcos(forward) - angle, -HALF_PI, HALF_PI);
  float arc0 = cosNormal + 2.0 * h0 * sin(angle) - cos(2.0 * h0 - angle);
  float arc1 = cosNormal + 2.0 * h1 * sin(angle) - cos(2.0 * h1 - angle);
  return projectedLength * (arc0 + arc1) * 0.25;
}

void main() {
  depthSize = textureSize(uViewDepth, 0);
  ivec2 texel = ivec2(gl_FragCoord.xy);
  float viewDepth = texelFetch(uViewDepth, texel, 0).r;
  // Half-resolution texels: the full-resolution radius halves.
  float radiusTexels = 0.5 * uAoParams.x * uAoParams.y / mix(viewDepth, 1.0, uAoParams.w);
  if (viewDepth >= ${AO_SKY_VIEW_DEPTH.toFixed(1)} || radiusTexels < 1.0) {
    fragColor = vec4(1.0, viewDepth, 0.0, 1.0);
    return;
  }
  radiusTexels = min(radiusTexels, 0.5 * uAoParams.z);
  vec3 centre = viewPositionAt(texel, viewDepth);
  vec3 normal = normalAt(texel, centre);
  vec3 viewVector = mix(normalize(-centre), vec3(0.0, 0.0, 1.0), uAoParams.w);
  ivec2 tile = texel & 3;
  float sliceNoise = BAYER[tile.y * 4 + tile.x] / 16.0;
  float stepNoise = (BAYER[((tile.y + 2) & 3) * 4 + ((tile.x + 1) & 3)] + 0.5) / 16.0;
  float range = uAoShape.x * uAoParams.x;
  vec2 falloff = vec2(-1.0 / range, uAoParams.x * (1.0 - uAoShape.x) / range + 1.0);
  float visibility = 0.0;
  for (int slice = 0; slice < SLICES; slice++) {
    float phi = (float(slice) + sliceNoise) * PI / float(SLICES);
    visibility += sliceVisibility(phi, texel, centre, normal, viewVector, radiusTexels, stepNoise, falloff);
  }
  float sunShare = 0.0;
#ifdef AO_DIRECT_SHARE
  sunShare = aoDirectShare(centre, normal);
#endif
  fragColor = vec4(clamp(visibility / float(SLICES), 0.0, 1.0), viewDepth, sunShare, 1.0);
}`;

/** The plain GTAO pass (no sun weighting: no shadow map or sky uniforms available). */
export const AO_GTAO_FRAGMENT_GLSL = createAoGtaoFragmentGlsl("");

/**
 * AO-AMBIENT: the share of a texel's light that comes straight from the sun, after the shared
 * lightSurface model (common-glsl.ts): wrapped Lambert sun × shadow map against 0.8 × SH9 sky.
 * The shadow map's floor (a shadowed receiver keeps SUN_SHADOW_FLOOR of the sun) counts as
 * ambient fill, so shadowed contact (under eaves, at shaded building feet) keeps its full
 * occlusion. Built-in materials (sun 2.3 / π, sky probe 1.8 / π) give nearly the same ratio.
 * Needs SUN_SHADOW_SCREEN_GLSL (renderers/three/sun-shadow-glsl.ts) before it.
 */
export const AO_DIRECT_SHARE_GLSL = `
${SKY_LIGHT_GLSL}
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
/** The camera's world matrix: view positions and normals to world space. */
uniform mat4 uAoViewToWorld;
const vec3 AO_LUMA = vec3(0.2126, 0.7152, 0.0722);

float aoDirectShare(vec3 viewPosition, vec3 viewNormal) {
  if (uSunShadows < 0.5) return 0.0;
  vec3 normal = normalize(mat3(uAoViewToWorld) * viewNormal);
  float sun = dot(uSunColor, AO_LUMA) * clamp((dot(normal, uSunDirection) + 0.2) / 1.2, 0.0, 1.0);
  if (sun <= 0.0) return 0.0;
  vec3 world = (uAoViewToWorld * vec4(viewPosition, 1.0)).xyz;
  float lit = mix(1.0, sampleSunShadowRaw(world, normal), uSunShadowWeight);
  float direct = sun * lit;
  float ambient = 0.8 * dot(skyIrradiance(normal), AO_LUMA) + SUN_SHADOW_FLOOR * sun * (1.0 - lit);
  return direct / max(direct + ambient, 1e-4);
}`;

/**
 * One axis of the half-resolution depth-aware tent blur (0.5, 1, 1, 1, 0.5), run along x then y:
 * the product gives every phase of the 4×4 noise tile the same weight, so the pattern cancels on
 * smooth surfaces (5 + 5 taps instead of 25). A texel with almost no depth-similar neighbour along
 * the axis sits on a thin silhouette (a ridge, a pole): its normal and horizons are unreliable, so
 * it fades to full visibility instead of leaving a dark speck. The direct sun share (b) is blurred
 * with the same weights.
 */
export const AO_BLUR_FRAGMENT_GLSL = `precision highp float;
precision highp sampler2D;
uniform sampler2D uAo;
/** x absolute, y relative depth tolerance. */
uniform vec2 uAoTolerance;
uniform ivec2 uAoAxis;
out vec4 fragColor;
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(uAo, 0) - 1;
  vec3 centre = texelFetch(uAo, texel, 0).rgb;
  float tolerance = uAoTolerance.x + centre.g * uAoTolerance.y;
  vec2 sum = vec2(0.0);
  float weight = 0.0;
  for (int offset = -${AO_BLUR_RADIUS}; offset <= ${AO_BLUR_RADIUS}; offset++) {
    vec3 tap = texelFetch(uAo, clamp(texel + uAoAxis * offset, ivec2(0), last), 0).rgb;
    float tent = abs(offset) == ${AO_BLUR_RADIUS} ? ${AO_BLUR_TENT_WEIGHTS[0].toFixed(1)} : ${AO_BLUR_TENT_WEIGHTS[1].toFixed(1)};
    float similar = max(0.0, 1.0 - abs(tap.g - centre.g) / tolerance);
    sum += tap.rb * (tent * similar);
    weight += tent * similar;
  }
  float support = clamp((weight - 1.0) / 1.5, 0.0, 1.0);
  vec2 blurred = sum / max(weight, 1e-4);
  fragColor = vec4(mix(1.0, blurred.x, support), centre.g, blurred.y, 1.0);
}`;

/**
 * Output-pass chunk (defined by FRAME_AO): the full-resolution visibility factor of a pixel. The
 * 2×2 half-resolution neighbours are weighted bilinearly and by view-depth similarity; when none
 * matches (a thin silhouette the half-resolution pass never saw), the pixel stays unoccluded. `mask`
 * is the scene alpha the compositor wrote (0 on water, impostor cards and other excluded surfaces, antialiased at their edges).
 */
export const FRAME_AO_APPLY_GLSL = `
uniform sampler2D uAoTexture;
uniform sampler2D uAoDepth;
${VIEW_DEPTH_GLSL}
/** x strength, y absolute, z relative depth tolerance, w 1 for the occlusion-only debug view. */
uniform vec4 uAoApply;
/** The contrast curve exponent (AmbientOcclusionTuning.power). */
uniform float uAoPower;
/** The share of the direct sun the occlusion spares (AmbientOcclusionTuning.sunlit). */
uniform float uAoSunlit;

float frameAoVisibility(ivec2 pixel, float mask) {
  float depth = texelFetch(uAoDepth, pixel, 0).r;
  if (depth >= 1.0 || mask <= 0.0) return 1.0;
  float viewDepth = viewDepthOf(depth);
  float tolerance = uAoApply.y + viewDepth * uAoApply.z;
  vec2 position = vec2(pixel) * 0.5;
  ivec2 base = ivec2(floor(position));
  vec2 fraction = position - vec2(base);
  ivec2 last = textureSize(uAoTexture, 0) - 1;
  vec2 sum = vec2(0.0);
  float weight = 0.0;
  for (int index = 0; index < 4; index++) {
    ivec2 offset = ivec2(index & 1, index >> 1);
    vec3 tap = texelFetch(uAoTexture, min(base + offset, last), 0).rgb;
    vec2 axis = mix(1.0 - fraction, fraction, vec2(offset));
    float gap = abs(tap.g - viewDepth);
    float tapWeight = axis.x * axis.y * max(0.0, 1.0 - gap / tolerance);
    sum += tap.rb * tapWeight;
    weight += tapWeight;
  }
  vec2 upsampled = sum / max(weight, 1e-4);
  float visibility = mix(1.0, upsampled.x, clamp(weight * 8.0, 0.0, 1.0));
  // AO-AMBIENT: only the ambient part of the pixel's light is occluded; its direct sun share is not.
  float occluded = mix(pow(visibility, uAoPower), 1.0, upsampled.y * uAoSunlit);
  return mix(1.0, occluded, uAoApply.x * mask);
}

/** The occlusion-only debug view: the visibility as a display grey. */
bool frameAoDebugView() {
  return uAoApply.w > 0.5;
}

/** A display-referred pixel scaled as a linear multiply would scale it (2.2 gamma approximation). */
vec3 frameAoDisplay(vec3 display, float visibility) {
  return display * pow(visibility, 1.0 / 2.2);
}`;
