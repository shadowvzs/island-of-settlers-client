import { glslFloat } from "../../render-common/shaders/common-glsl";
import { BARK_FAMILY, BARK_FAMILY_STRIDE } from "../../render-common/trees/bark-uv";
import { CONIFER_BARK_GLSL } from "./trees/conifer-bark-glsl";


/**
 * Conifer bark for the prop shader (after TREE_SHADING_GLSL, which supplies the
 * bark uv constants, bump helpers and lichen): the three procedural conifer families
 * (conifer-bark-glsl.ts) on the island conifer wood, picked by the bark uv family.
 */
export const CONIFER_SHADING_GLSL = `
${CONIFER_BARK_GLSL}
const float CONIFER_FAMILY_FIRST = ${glslFloat(BARK_FAMILY.spruce)};
const float CONIFER_FAMILY_LAST = ${glslFloat(BARK_FAMILY.mountainPine)};
const float BARK_STRIDE = ${glslFloat(BARK_FAMILY_STRIDE)};

float getBarkFamily(vec2 uv) {
  return floor((-uv.x - BARK_UV_OFFSET) / BARK_STRIDE);
}

bool isConiferBark(vec2 uv) {
  float family = getBarkFamily(uv);
  return uv.x < BARK_UV_LIMIT && family >= CONIFER_FAMILY_FIRST && family <= CONIFER_FAMILY_LAST;
}

vec3 lightConiferBark(vec3 base, vec3 normal, vec2 uv, vec3 world, float sunVisibility) {
  float family = getBarkFamily(uv);
  vec2 bark = vec2(-uv.x - BARK_UV_OFFSET - family * BARK_STRIDE, uv.y);
  vec4 surface = coniferBark(base, bark, family);
  float depth = coniferBarkDepth(base, family);
  vec3 bumped = perturbBarkNormal(normal, world, surface.a * depth * barkScale(bark, world));
  float north = smoothstep(0.0, 0.7, -normal.z);
  float lichen = smoothstep(0.55, 0.75, coniferWrapNoise(bark, 3.0, 20.0)) * north * 0.25;
  vec3 albedo = mix(surface.rgb, LICHEN * dot(base, vec3(0.333)) * 2.0, lichen);
  float cavity = mix(0.7, 1.0, smoothstep(0.0, 0.35, surface.a));
  vec3 bounce = albedo * (uAmbientSky + uAmbientGround) * 0.12;
  return lightSurface(albedo, bumped, sunVisibility, cavity, world.xz) + bounce;
}
`;
