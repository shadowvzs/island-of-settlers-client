import { LEAF_RELIEF } from "../trees/bark-shading";
import { glslLiteral } from "./glsl-literal";

/**
 * Leaf atlas uvs lie in 0..1; wood and untextured vertices use u <= -1 (NO_UV, bark, hardwood leaves).
 * The test sits halfway: an MSAA edge sample of a card evaluates its uv outside the triangle, a
 * little below 0 on cards that start at the atlas edge (u0 = 0), and a plain `u < 0` read those
 * samples as opaque untextured wood, drawing pale lines along the card edge (SAPLING, 2026-11-13).
 */
export const LEAF_ATLAS_UV_GLSL = `
#ifndef LEAF_ATLAS_UV
#define LEAF_ATLAS_UV
bool isLeafAtlasUv(vec2 uv) { return uv.x > -0.5; }
#endif
`;

/**
 * Per-leaf normal relief shared by the near leaf materials and the sprite baker. The atlas normal
 * map is tangent space (green = +v); the card's screen derivatives supply the tangent frame, so no
 * extra attribute is needed.
 */
export const LEAF_NORMAL_GLSL = `
uniform sampler2D uLeafNormals;
const float LEAF_RELIEF = ${glslLiteral(LEAF_RELIEF)};

vec3 perturbLeafNormal(vec3 normal, vec3 world, vec2 uv) {
  vec3 q0 = dFdx(world);
  vec3 q1 = dFdy(world);
  vec2 st0 = dFdx(uv);
  vec2 st1 = dFdy(uv);
  vec3 plane = cross(q0, q1);
  vec3 q1Perp = cross(q1, plane);
  vec3 q0Perp = cross(plane, q0);
  vec3 tangent = q1Perp * st0.x + q0Perp * st1.x;
  vec3 bitangent = q1Perp * st0.y + q0Perp * st1.y;
  float frame = max(dot(tangent, tangent), dot(bitangent, bitangent));
  if (frame <= 0.0) return normal;
  vec3 relief = texture(uLeafNormals, uv).xyz * 2.0 - 1.0;
  vec3 slope = (tangent * relief.x + bitangent * relief.y) * inversesqrt(frame);
  return normalize(normal * relief.z + slope * LEAF_RELIEF);
}
`;

/**
 * Leaves: sun through the blade when it shines from behind (strongest towards the sun), plus a
 * restrained waxy sheen. Needs PROP_SHADING_GLSL for lightProp/getBackLightWeight.
 */
export const LEAF_LIGHT_GLSL = `
vec3 lightLeaf(vec3 albedo, vec3 normal, float sunVisibility, vec2 xz) {
  float facingSun = max(-dot(uViewDirection, uSunDirection), 0.0);
  float through = max(dot(-normal, uSunDirection), 0.0) * (0.25 + pow(facingSun, 2.0) * 0.75)
    * getBackLightWeight();
  vec3 glow = albedo * vec3(1.1, 1.25, 0.5) * through * 0.5;
  float sheen = pow(max(dot(normal, normalize(uSunDirection + uViewDirection)), 0.0), 24.0);
  vec3 extra = (glow + vec3(0.9, 1.0, 0.82) * sheen * 0.05 * uHighlight) * uSunColor * sunVisibility;
  return lightProp(albedo, normal, sunVisibility, xz) + extra;
}
`;
