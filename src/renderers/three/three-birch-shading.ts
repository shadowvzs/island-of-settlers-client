import { glslLiteral } from "../../render-common/shaders/glsl-literal";
import { BIRCH_BARK } from "../../render-common/trees/bark-shading";
import { BARK_FAMILY, BARK_FAMILY_STRIDE, BARK_UV_OFFSET } from "../../render-common/trees/bark-uv";
import { BIRCH_BARK_GLSL } from "./trees/bark-glsl";

/**
 * Island birch bark for the prop shader (after TREE_SHADING_GLSL: needs LIGHTING, the bark
 * bump and the ambient uniforms): white bark with partial dark marks, lenticels and a rough
 * darker base, decoded from the birch bark family of the wood uv.
 */
export const BIRCH_SHADING_GLSL = `
${BIRCH_BARK_GLSL}
const float BIRCH_FAMILY_START = ${(BARK_UV_OFFSET + BARK_FAMILY.birch * BARK_FAMILY_STRIDE).toFixed(1)};
const float BIRCH_DEPTH = ${glslLiteral(BIRCH_BARK.depth)};

bool isBirchBark(vec2 uv) {
  float offset = -uv.x - BIRCH_FAMILY_START;
  return offset >= 0.0 && offset < ${BARK_FAMILY_STRIDE.toFixed(1)};
}

vec3 lightBirchBark(vec3 base, vec3 normal, vec2 uv, vec3 world, float sunVisibility) {
  vec2 bark = vec2(-uv.x - BIRCH_FAMILY_START, uv.y);
  vec4 surface = birchBark(base, bark, birchLower(bark));
  float depth = surface.a * BIRCH_DEPTH * barkScale(bark, world);
  vec3 bumped = perturbBarkNormal(normal, world, depth);
  float cavity = mix(0.8, 1.0, clamp(surface.a, 0.0, 1.0));
  vec3 bounce = surface.rgb * (uAmbientSky + uAmbientGround) * 0.1;
  return lightSurface(surface.rgb, bumped, sunVisibility, cavity, world.xz) + bounce;
}
`;
