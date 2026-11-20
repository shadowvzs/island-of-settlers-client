import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  HEADING_TURN_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";
import { CAUSTICS_GLSL, REFRACTED_SUN_GLSL } from "../../render-common/shaders/water-glsl";
import { FISH_PAINT_GLSL } from "./three-fish-paint-glsl";
import { SUN_SHADOW_GLSL } from "./three-shadows";

/**
 * Swimming fish: the tail bends sideways in a travelling wave that grows towards the tail tip
 * (the head holds its line), the normals follow the bend; then pitch, heading and placement.
 * iPosition: xyz, scale; iMotion: heading, pitch, tail phase, tail amplitude (length share);
 * iLook: shade, fog visibility, depth below the surface, water column (surface to bed).
 * vBody: the rest-pose body coordinates the fragment paints from (x / length, y / length,
 * z / (thickness * length)); vFin: 1 on fins and the tail.
 */
export const FISH_VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in float fin;
in vec4 iPosition;
in vec4 iMotion;
in vec4 iLook;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uLength;
uniform float uThickness;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vBody;
out float vFin;
out float vShade;
out float vFog;
out float vDepth;
out float vColumn;

${HEADING_TURN_GLSL}
vec3 pitchUp(vec3 value, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(value.x * c - value.y * s, value.x * s + value.y * c, value.z);
}

void main() {
  float along = position.x / uLength;
  float behind = max(0.0, 0.15 - along);
  float wave = iMotion.z - along * 5.0;
  float bend = iMotion.w * uLength * sin(wave) * behind * behind * 2.2;
  float slope = -iMotion.w * 2.2 * (5.0 * cos(wave) * behind * behind + 2.0 * sin(wave) * behind);
  vec3 local = vec3(position.xy, position.z + bend);
  vec3 bent = normalize(vec3(normal.x - slope * normal.z, normal.y, normal.z));
  vWorld = iPosition.xyz + turn(pitchUp(local, iMotion.y), iMotion.x) * iPosition.w;
  vNormal = turn(pitchUp(bent, iMotion.y), iMotion.x);
  vBody = position / vec3(uLength, uLength, uLength * uThickness);
  vFin = fin;
  vShade = iLook.x;
  vFog = iLook.y;
  vDepth = iLook.z;
  vColumn = iLook.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

/**
 * Lit like the seabed it swims over (sun, sky, cloud and sun shadow), with the caustic light
 * playing on its back and a silvery flash of the flank towards the eye; the water surface then
 * refracts and absorbs it like the bed (drawn only into the refraction capture).
 */
export const FISH_FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vBody;
in float vFin;
in float vShade;
in float vFog;
in float vDepth;
in float vColumn;
uniform float uSheen;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SUN_SHADOW_GLSL}
${CAUSTICS_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${FISH_PAINT_GLSL}

vec3 causticLight(vec3 normal, float sunVisibility) {
  vec2 entry = vWorld.xz + refractedSunOffset() * vDepth;
  float sun = sunVisibility * cloudShadow(entry) * smoothstep(0.04, 0.3, uSunDirection.y);
  return caustics(entry, uTime) * uSunColor * 0.4 * exp(-vDepth * 0.9) * sun * max(normal.y, 0.0);
}

/** Silvery flash of the flank towards the eye, sparkling along the scale rows. */
vec3 flankSheen(vec3 normal, float sunVisibility, float scales) {
  float flash = pow(max(dot(normal, normalize(uSunDirection + uViewDirection)), 0.0), 10.0);
  vec3 sky = skyIrradiance(reflect(-uViewDirection, normal)) * 0.1;
  return (uSunColor * flash * sunVisibility * 0.3 + sky) * uSheen * (1.0 - vFin) * (0.6 + 0.8 * scales);
}

void main() {
  if (isHiddenByFog(vFog, vWorld.xz)) discard;
  vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float sunVisibility = sampleSunShadow(vWorld);
  float scales = getScaleRows();
  vec3 albedo = paintFish(scales) * vShade;
  // A darker outline where the body turns away from the eye: the shape separates from the water.
  vec3 toEye = isOrthographic ? uViewDirection : normalize(cameraPosition - vWorld);
  float outline = smoothstep(0.55, 0.95, 1.0 - abs(dot(normal, toEye))) * (1.0 - vFin);
  albedo *= 1.0 - 0.5 * outline;
  vec3 color = lightSurface(albedo, normal, sunVisibility, 1.0, vWorld.xz);
  color += albedo * causticLight(normal, sunVisibility) + flankSheen(normal, sunVisibility, scales);
  // Alpha 0.25 .. 0.65 marks fish texels with their depth share of the column: the water refracts
  // them gently and shades them through only the water above them (three-materials.ts).
  float column = clamp(vDepth / max(vColumn, 1e-3), 0.0, 1.0);
  fragColor = vec4(finishSurface(applyFogOfWar(color, vFog, vWorld.xz), vWorld), 0.25 + 0.4 * column);
}
`;

/**
 * A soft shadow of each fish on the seabed below, displaced along the refracted sun ray, wider
 * and fainter the higher the fish swims. iShadow: x, bed height, z, size; iShadowShape:
 * heading, height above the bed, fog visibility, strength (the fish's fade).
 */
export const FISH_SHADOW_VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec4 iShadow;
in vec4 iShadowShape;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec2 vLocal;
out vec3 vWorld;
out float vFog;
out float vStrength;
${COMMON_UNIFORMS_GLSL}
${HEADING_TURN_GLSL}
${REFRACTED_SUN_GLSL}

void main() {
  float height = iShadowShape.y;
  float spread = iShadow.w * (1.0 + height * 0.9);
  vec3 local = vec3(position.x * 0.55 * spread, 0.0, position.z * 0.22 * spread);
  vec2 centre = iShadow.xz - refractedSunOffset() * height;
  vWorld = vec3(centre.x, iShadow.y + 0.03, centre.y) + turn(local, iShadowShape.x);
  vLocal = position.xz;
  vFog = iShadowShape.z;
  vStrength = iShadowShape.w * exp(-height * 0.8) * smoothstep(0.08, 0.35, uSunDirection.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

export const FISH_SHADOW_FRAGMENT_GLSL = `
precision highp float;
in vec2 vLocal;
in vec3 vWorld;
in float vFog;
in float vStrength;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SUN_SHADOW_GLSL}

void main() {
  float falloff = 1.0 - dot(vLocal, vLocal);
  if (falloff <= 0.0 || isHiddenByFog(vFog, vWorld.xz)) discard;
  float light = sampleSunShadow(vWorld) * cloudShadow(vWorld.xz);
  fragColor = vec4(0.0, 0.0, 0.0, vStrength * 0.42 * falloff * falloff * light);
}
`;
