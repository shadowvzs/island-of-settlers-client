/**
 * GLSL of the R18b screen-space water reflections (renderers/three/frame-water-reflection.ts),
 * GLSL ES 3.00. A half-resolution pass draws only the water surface (the same swell lift as the
 * water material) and marches each mirror ray through the frame's resolved depth; the output pass
 * blends the reflected colour over the water pixels with a depth-aware 2×2 upsample
 * (FRAME_WATER_REFLECTION_APPLY_GLSL). Where a ray leaves the screen, runs too far or passes
 * behind everything it could hit, the confidence fades to 0 and the water keeps its own sky
 * reflection: nothing off screen is invented.
 */

import { REFLECTION_GLARE_FLOOR } from "../highlights";
import { WATER_FIELD_GLSL } from "../water-field";
import { COMMON_UNIFORMS_GLSL, LIGHTING_GLSL, NOISE_GLSL } from "./common-glsl";
import { createViewDepthGlsl } from "./frame-ao-glsl";
import { createWaterGlsl } from "./water-glsl";

export interface WaterReflectionTuning {
  /** Development only: 1 replaces visible water by its mirror share (red) for captures. */
  debugView: number;
  /** Depth tolerance of the blur: absolute view units plus a share (separate water levels stay apart). */
  blurTolerance: { absolute: number; relative: number };
  /** Depth tolerance of the upsample's water test: absolute view units plus a share of the view depth. */
  depthTolerance: { absolute: number; relative: number };
  /** Screen border share over which a hit fades out (no hard cut where rays leave the frame). */
  edgeFade: number;
  /**
   * Reflectance floor: the mirror share of a hit is mix(floor, 1, fresnel). The physical Schlick
   * value (2–6 % from the strategic camera) would hide every reflection the player looks at.
   */
  floor: number;
  /** Longest mirror ray in world units (shore, buildings, ships and trees stand well inside it). */
  maxDistance: number;
  /** Largest mirror share of a pixel (keeps the water's own colour under every reflection). */
  maxWeight: number;
  /** Share of the wind ripples in the mirror normal: the swell tilts it fully, ripples roughen it. */
  roughness: number;
  /** How much of the reflection reaches the image (0 skips the apply). */
  strength: number;
  /** Minimum thickness (world units) of a surface the ray may pass behind and still count as a hit. */
  thickness: number;
}

export const WATER_REFLECTION_TUNING: WaterReflectionTuning = {
  debugView: 0,
  blurTolerance: { absolute: 1.5, relative: 0.05 },
  depthTolerance: { absolute: 0.2, relative: 0.01 },
  edgeFade: 0.08,
  floor: 0.3,
  maxDistance: 48,
  maxWeight: 0.75,
  roughness: 0.55,
  strength: 1,
  thickness: 0.6
};

const SSR_VIEW_DEPTH_GLSL = createViewDepthGlsl("uSsrDepthToView", "ssrViewDepth");

/** Screen-space march: fixed step count over the on-screen part of the ray, then a binary refine. */
const SSR_TRACE_GLSL = `
const int SSR_STEPS = 20;
const int SSR_REFINE_STEPS = 5;
/** Sky (depth 1) is never a hit: a ray towards it falls back to the water's sky reflection. */
const float SSR_SKY_DEPTH = 1.0e6;
/** World units above the water surface the mirror ray starts (above the swell crests). */
const float SSR_START_LIFT = 0.15;

float ssrSceneDepth(vec2 uv) {
  float depth = texelFetch(uSsrDepth, ivec2(uv * uSsrFullSize), 0).r;
  return depth >= 1.0 ? SSR_SKY_DEPTH : ssrViewDepth(depth);
}

/** Box filter of the 2×2 full-resolution pixels around uv: a half-resolution hit without aliasing. */
vec3 ssrSceneColor(vec2 uv) {
  ivec2 last = ivec2(uSsrFullSize) - 1;
  ivec2 pixel = clamp(ivec2(uv * uSsrFullSize - 0.5), ivec2(0), last - 1);
  vec3 sum = texelFetch(uSsrScene, pixel, 0).rgb + texelFetch(uSsrScene, pixel + ivec2(1, 0), 0).rgb
    + texelFetch(uSsrScene, pixel + ivec2(0, 1), 0).rgb + texelFetch(uSsrScene, pixel + ivec2(1, 1), 0).rgb;
  return sum * 0.25;
}

/** Interleaved gradient noise (Jimenez 2014): a fixed per-texel step offset, no temporal change. */
float ssrJitter() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}

/** Largest t in [0, 1] keeping one NDC coordinate start + t * delta inside [-1, 1]. */
float ssrAxisExit(float start, float delta) {
  if (delta > 0.0) return (1.0 - start) / delta;
  if (delta < 0.0) return (-1.0 - start) / delta;
  return 1.0;
}

/** Largest t in [0, 1] keeping the NDC segment start + t * delta on screen. */
float ssrScreenExit(vec2 start, vec2 delta) {
  return clamp(min(ssrAxisExit(start.x, delta.x), ssrAxisExit(start.y, delta.y)), 0.0, 1.0);
}

struct SsrRay {
  vec2 startNdc;
  vec2 deltaNdc;
  /** View z over w and 1 / w at both ends: perspective-correct depth along the screen segment. */
  vec2 zOverW;
  vec2 inverseW;
};

/** The ray's view distance (positive) at screen parameter t. */
float ssrRayDepth(SsrRay ray, float t) {
  return -mix(ray.zOverW.x, ray.zOverW.y, t) / mix(ray.inverseW.x, ray.inverseW.y, t);
}

SsrRay ssrProjectRay(vec3 origin, vec3 end) {
  vec4 clipStart = projectionMatrix * vec4(origin, 1.0);
  vec4 clipEnd = projectionMatrix * vec4(end, 1.0);
  vec2 inverseW = vec2(1.0 / clipStart.w, 1.0 / clipEnd.w);
  vec2 startNdc = clipStart.xy * inverseW.x;
  return SsrRay(startNdc, clipEnd.xy * inverseW.y - startNdc, vec2(origin.z, end.z) * inverseW, inverseW);
}

/** How far the ray (behind the scene by gap) is inside a surface of the given thickness. */
float ssrHitConfidence(float gap, float thickness) {
  return gap > 0.0 && gap < thickness ? 1.0 - gap / thickness : 0.0;
}

/** Fades hits near the screen border and towards the far end of the ray. */
float ssrHitFade(vec2 uv, float travelled) {
  vec2 border = min(uv, 1.0 - uv);
  float edge = smoothstep(0.0, uSsrTrace.z, min(border.x, border.y));
  return edge * (1.0 - smoothstep(0.65, 1.0, travelled));
}

/**
 * rgb the reflected colour, a its confidence. The ray runs from the water point along the mirror
 * direction (view space), clipped before the near plane and at the screen border.
 */
vec4 traceReflection(vec3 origin, vec3 direction) {
  float rayLength = uSsrTrace.x;
  float near = ssrViewDepth(0.0);
  // Perspective: stop the ray before it crosses the near plane (towards the camera).
  if (direction.z > 0.0) rayLength = min(rayLength, (-near * 1.05 - origin.z) / direction.z);
  if (rayLength <= 0.0) return vec4(0.0);
  SsrRay ray = ssrProjectRay(origin, origin + direction * rayLength);
  float exit = ssrScreenExit(ray.startNdc, ray.deltaNdc);
  float pixels = length(ray.deltaNdc * exit * uSsrFullSize * 0.5);
  if (pixels < 2.0) return vec4(0.0);
  float jitter = ssrJitter();
  float previousT = 0.0;
  float previousDepth = ssrRayDepth(ray, 0.0);
  for (int stepIndex = 1; stepIndex <= SSR_STEPS; stepIndex++) {
    // Steps grow along the ray: contact with the mirrored object's base is found first and finest.
    float share = (float(stepIndex) - jitter) / float(SSR_STEPS);
    float t = exit * share * share;
    vec2 uv = (ray.startNdc + ray.deltaNdc * t) * 0.5 + 0.5;
    float rayDepth = ssrRayDepth(ray, t);
    float thickness = uSsrTrace.y + abs(rayDepth - previousDepth);
    if (ssrHitConfidence(rayDepth - ssrSceneDepth(uv), thickness) > 0.0) {
      // Binary refine between the last point in front of the scene and this one behind it.
      float front = previousT;
      float behind = t;
      for (int refine = 0; refine < SSR_REFINE_STEPS; refine++) {
        float middle = 0.5 * (front + behind);
        vec2 middleUv = (ray.startNdc + ray.deltaNdc * middle) * 0.5 + 0.5;
        bool isBehind = ssrRayDepth(ray, middle) > ssrSceneDepth(middleUv);
        front = isBehind ? front : middle;
        behind = isBehind ? middle : behind;
      }
      vec2 hitUv = (ray.startNdc + ray.deltaNdc * behind) * 0.5 + 0.5;
      float hitDepth = ssrRayDepth(ray, behind);
      float confidence = max(ssrHitConfidence(hitDepth - ssrSceneDepth(hitUv), thickness), 0.35);
      return vec4(ssrSceneColor(hitUv), confidence * ssrHitFade(hitUv, behind));
    }
    previousT = t;
    previousDepth = rayDepth;
  }
  return vec4(0.0);
}`;

/**
 * Scenes with ice floes (three-ice-floes.ts): on calm water (no swell crests to clear) the mirror
 * ray starts just above the surface, so a floe's low wall is mirrored at its waterline instead of
 * its bright snow top as a light seam. Swell water keeps SSR_START_LIFT.
 */
const ICE_FLOE_CONTACT_GLSL = `
const float SSR_CALM_LIFT = 0.02;

float getSsrStartLift(float depth, vec2 flow) {
  return mix(SSR_CALM_LIFT, SSR_START_LIFT, getSwellCalm(depth, flow));
}
`;

const getStartLift = (iceFloes: boolean) => iceFloes ? "getSsrStartLift(depth, vWater.zw)" : "SSR_START_LIFT";

/**
 * The water's own vertex stage (three-materials.ts WATER_VERTEX_GLSL) provides vWorld and vWater.
 * `iceFloes` compiles the calm-water ray start (ICE_FLOE_CONTACT_GLSL); other scenes keep their source.
 */
export const createWaterReflectionFragmentGlsl = (winter: boolean, iceFloes = false) => `precision highp float;
precision highp sampler2D;
in vec3 vWorld;
in vec4 vWater;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
/** Full-resolution resolved depth and colour of this frame. */
uniform sampler2D uSsrDepth;
uniform sampler2D uSsrScene;
uniform vec2 uSsrFullSize;
/** x max distance (world), y thickness (world), z edge fade share. */
uniform vec3 uSsrTrace;
/** x reflectance floor, y max weight, z ripple share of the mirror normal. */
uniform vec3 uSsrShape;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${createWaterGlsl(winter)}
${WATER_FIELD_GLSL}
${SSR_VIEW_DEPTH_GLSL}
${SSR_TRACE_GLSL}
${iceFloes ? ICE_FLOE_CONTACT_GLSL : ""}
/** Share of the Highlights / glare setting (uHighlight): REFLECTION_GLARE_FLOOR at 0, full at 1. */
float reflectionGlare() {
  return mix(${REFLECTION_GLARE_FLOOR.toFixed(2)}, 1.0, uHighlight);
}

/** Share of the mirror dense white foam keeps: it stays mostly matte (owner 2026-11-10). */
const float FOAM_MIRROR_FLOOR = 0.2;

/**
 * Mirror share left by the foam: lace and thin swash keep most of it (a shore tree's mirror shows
 * faintly in the surf), dense foam keeps FOAM_MIRROR_FLOOR. waterFoamCover tops out at 0.8.
 */
float foamMirror(float foamCover) {
  return mix(FOAM_MIRROR_FLOOR, 1.0, 1.0 - foamCover / 0.8);
}

/** The mirror share of the surface: fresnel over a floor, weaker under foam, rough in rain. */
float reflectionWeight(vec3 normal, vec3 viewDirection, float foamCover, float depth) {
  float fresnel = waterFresnel(dot(normal, viewDirection));
  float weight = min(mix(uSsrShape.x, 1.0, fresnel), uSsrShape.y);
  return weight * foamMirror(foamCover) * (1.0 - 0.6 * uRain) * smoothstep(0.0, 0.04, depth)
    * reflectionGlare();
}

void main() {
  vec4 field = sampleWaterField(vWorld.xz);
  float depth = max(field.x, 0.0);
  vec2 swell = getSwell(vWorld.xz, uTime).yz * getSwellSlopeWeight(depth, vWater.zw);
  vec3 viewDirection = isOrthographic ? uViewDirection : normalize(cameraPosition - vWorld);
  vec3 ripple = waterNormal(vWorld.xz, vWater.zw, uTime);
  // A tilt doubles in the mirror ray: at a grazing view it would throw rays far above and below the
  // reflected object (speckle). Ripples roughen fully from the strategic view, little at eye level.
  float elevation = clamp(viewDirection.y * 2.0, 0.0, 1.0);
  float rippleShare = uSsrShape.z * max(elevation, 0.15);
  // The swell's slope tilts the mirror too; at eye level it keeps less than half of it, so the
  // reflection stays attached to the waterline of what it mirrors.
  swell *= mix(0.4, 1.0, elevation);
  vec3 normal = normalize(vec3(ripple.x * rippleShare - swell.x, ripple.y, ripple.z * rippleShare - swell.y));
  float foamCover = waterFoamCover(vWorld.xz, depth, field.y, vWater.zw, uTime);
  float weight = reflectionWeight(normal, viewDirection, foamCover, depth);
  if (weight <= 0.004) {
    // Dry edges: marked non-reflective (a < 0), so the blur never spreads a mirror onto them.
    fragColor = vec4(0.0, 0.0, 0.0, -1.0);
    return;
  }
  vec3 mirror = reflect(-viewDirection, normal);
  // A wave normal tilted past the view never sends the ray into the water itself.
  mirror = normalize(vec3(mirror.x, max(mirror.y, 0.03), mirror.z));
  // Start above the swell crests: a grazing ray must not "hit" the next wave and mirror the water
  // itself (a blue gap under hulls). The lowest few centimetres of an object are not mirrored.
  vec3 origin = (viewMatrix * vec4(vWorld + vec3(0.0, ${getStartLift(iceFloes)}, 0.0), 1.0)).xyz;
  vec4 hit = traceReflection(origin, mat3(viewMatrix) * mirror);
  fragColor = vec4(hit.rgb, weight * hit.a);
}`;

/**
 * Output-pass chunk (defined by FRAME_WATER_REFLECTION): blends the reflection over a pixel that is
 * the visible water surface. The 2×2 half-resolution neighbours count bilinearly where their water
 * depth matches the pixel's scene depth, so ships, piers and shore objects in front of the water
 * never receive it (no halo) and texels without water never bleed in.
 */
export const FRAME_WATER_REFLECTION_APPLY_GLSL = `
uniform sampler2D uSsrTexture;
uniform sampler2D uSsrWaterDepth;
uniform sampler2D uSsrSceneDepth;
${SSR_VIEW_DEPTH_GLSL}
/** x strength (0 skips), y absolute, z relative depth tolerance, w 1: debug view (mirror share in red). */
uniform vec4 uSsrApply;

vec3 frameWaterReflection(ivec2 pixel, vec3 scene) {
  if (uSsrApply.x <= 0.0) return scene;
  vec2 halfSize = vec2(textureSize(uSsrTexture, 0));
  // The half-resolution pass rasterised the same frustum: scale by the exact size ratio.
  vec2 position = (vec2(pixel) + 0.5) * halfSize / vec2(textureSize(uSsrSceneDepth, 0));
  // One filtered tap first: most pixels have no reflecting water texel around them.
  if (texture(uSsrTexture, position / halfSize).a <= 0.0) return scene;
  float viewDepth = ssrViewDepth(texelFetch(uSsrSceneDepth, pixel, 0).r);
  float tolerance = uSsrApply.y + viewDepth * uSsrApply.z;
  vec2 centred = position - 0.5;
  ivec2 base = ivec2(floor(centred));
  vec2 fraction = centred - vec2(base);
  ivec2 last = ivec2(halfSize) - 1;
  vec3 colour = vec3(0.0);
  float mirror = 0.0;
  float support = 0.0;
  for (int index = 0; index < 4; index++) {
    ivec2 offset = ivec2(index & 1, index >> 1);
    ivec2 texel = clamp(base + offset, ivec2(0), last);
    float waterDepth = texelFetch(uSsrWaterDepth, texel, 0).r;
    vec2 axis = mix(1.0 - fraction, fraction, vec2(offset));
    float matches = waterDepth < 1.0 && abs(ssrViewDepth(waterDepth) - viewDepth) < tolerance ? 1.0 : 0.0;
    float tapWeight = axis.x * axis.y * matches;
    vec4 tap = texelFetch(uSsrTexture, texel, 0);
    float tapMirror = max(tap.a, 0.0);
    colour += tap.rgb * tapMirror * tapWeight;
    mirror += tapMirror * tapWeight;
    support += tapWeight;
  }
  if (mirror <= 0.0) return scene;
  float share = uSsrApply.x * mirror / support;
  // Debug view: visible water dark blue, its mirror share in red (development captures only).
  if (uSsrApply.w > 0.5) return vec3(share * 1.5, 0.0, 0.25);
  return mix(scene, colour / mirror, share);
}`;

/** One fullscreen triangle (the blur's vertex stage). */
export const WATER_REFLECTION_TRIANGLE_VERTEX_GLSL = `precision highp float;
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * One axis of the separable half-resolution blur: a 7-tap tent over texels of the same water surface
 * (their water depth within the tolerance; non-reflective texels, a < 0, neither give nor take),
 * weighted by their mirror weight, so per-texel ray noise
 * (speckle) averages out while edges against ships, piers and the shore stay sharp.
 */
export const WATER_REFLECTION_BLUR_FRAGMENT_GLSL = `precision highp float;
precision highp sampler2D;
uniform sampler2D uSsrSource;
uniform sampler2D uSsrWaterDepth;
uniform ivec2 uSsrAxis;
/** x absolute, y relative depth tolerance. */
uniform vec2 uSsrTolerance;
out vec4 fragColor;
/** Share boost of sparse hits in the blur (see below). */
const float THIN_HIT_BOOST = 1.8;
${SSR_VIEW_DEPTH_GLSL}
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(uSsrSource, 0) - 1;
  float centreDepth = texelFetch(uSsrWaterDepth, texel, 0).r;
  if (centreDepth >= 1.0 || texelFetch(uSsrSource, texel, 0).a < 0.0) {
    // The mark survives the first (x) axis for the second; the final (y) result is plain 0.
    fragColor = vec4(0.0, 0.0, 0.0, uSsrAxis.y == 1 ? 0.0 : -1.0);
    return;
  }
  float viewDepth = ssrViewDepth(centreDepth);
  float tolerance = uSsrTolerance.x + viewDepth * uSsrTolerance.y;
  vec3 colour = vec3(0.0);
  float mirror = 0.0;
  float support = 0.0;
  float strongest = 0.0;
  for (int offset = -3; offset <= 3; offset++) {
    ivec2 tapTexel = clamp(texel + uSsrAxis * offset, ivec2(0), last);
    float tapDepth = texelFetch(uSsrWaterDepth, tapTexel, 0).r;
    if (tapDepth >= 1.0 || abs(ssrViewDepth(tapDepth) - viewDepth) > tolerance) continue;
    float tent = 4.0 - abs(float(offset));
    vec4 tap = texelFetch(uSsrSource, tapTexel, 0);
    if (tap.a < 0.0) continue;
    colour += tap.rgb * tap.a * tent;
    mirror += tap.a * tent;
    support += tent;
    strongest = max(strongest, tap.a);
  }
  // Thin objects (palm fronds, masts, rigging) hit only a few rays: the plain average would dilute
  // their mirror into nothing. A boost up to the strongest neighbour keeps them softly visible;
  // solid objects are hit densely and stay at their average.
  float share = min(mirror / support * THIN_HIT_BOOST, strongest);
  fragColor = mirror > 0.0 ? vec4(colour / mirror, share) : vec4(0.0);
}`;
