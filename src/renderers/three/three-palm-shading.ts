import { glslFloat } from "../../render-common/shaders/common-glsl";
import { glslLiteral } from "../../render-common/shaders/glsl-literal";
import { PALM_BARK } from "../../render-common/trees/bark-shading";
import { BARK_FAMILY } from "../../render-common/trees/bark-uv";


/**
 * Palm trunks for the prop shader (after CONIFER_SHADING_GLSL, which supplies
 * getBarkFamily / BARK_STRIDE, and TREE_SHADING_GLSL with the bump helpers): ringed coconut
 * trunks, date palm leaf-base scales and fibrous fan palm trunks, picked by the bark uv family.
 */
export const PALM_SHADING_GLSL = `
const float PALM_RINGED = ${glslFloat(BARK_FAMILY.palmRinged)};
const float PALM_LEAF_BASE = ${glslFloat(BARK_FAMILY.palmLeafBase)};
const float PALM_FIBROUS = ${glslFloat(BARK_FAMILY.palmFibrous)};
const float PALM_DEPTH = ${glslLiteral(PALM_BARK.depth)};
/** Lift: thin vertical trunks get little sun in the iso view. */
const float PALM_LIFT = ${glslLiteral(PALM_BARK.lift)};

bool isPalmBark(vec2 uv) {
  float family = getBarkFamily(uv);
  return uv.x < BARK_UV_LIMIT && family >= PALM_RINGED && family <= PALM_FIBROUS;
}

/** Fades a pattern to its mean before it would alias (x: pattern coordinate). */
float palmDetail(float x) {
  return 1.0 - smoothstep(0.25, 0.6, fwidth(x));
}

/** Coconut: irregular leaf scar rings (grooves) and faint vertical fissures between them. */
float palmRings(vec2 bark) {
  float rings = bark.y * 1.7 + barkNoise(bark, 0.7, 5.0) * 0.4;
  float groove = 1.0 - smoothstep(0.02, 0.09, abs(fract(rings) - 0.5) - 0.38);
  float wander = bark.x * 11.0 + barkNoise(bark, 2.0, 9.0);
  float fissure = smoothstep(0.88, 1.0, abs(sin(wander * 3.1416)));
  float band = barkHash(floor(rings)) * 0.12;
  float height = 1.0 - groove * 0.75 - fissure * 0.2 - band;
  return mix(0.8, height, palmDetail(rings));
}

/** Date palm: staggered rows of diamond shaped cut leaf bases with dark gaps. */
float palmLeafBases(vec2 bark) {
  vec2 grid = vec2(bark.x * 7.0, bark.y * 2.4 + barkNoise(bark, 1.0, 13.0) * 0.2);
  grid.x += mod(floor(grid.y), 2.0) * 0.5;
  vec2 cell = fract(grid) - 0.5;
  float diamond = abs(cell.x) * 1.1 + abs(cell.y);
  float tilt = barkHash(dot(floor(grid), vec2(1.0, 17.0)));
  float scale = smoothstep(0.55, 0.3, diamond) * (0.85 + tilt * 0.15);
  float lip = smoothstep(0.1, -0.2, cell.y) * 0.15;
  return mix(0.6, scale - lip, palmDetail(grid.y));
}

/** Fan palm: long vertical fibres (noise wrapped around the trunk) with faint rings. */
float palmFibres(vec2 bark) {
  vec2 around = vec2(cos(bark.x * 6.2832), sin(bark.x * 6.2832));
  float fine = valueNoise(around * 7.6 + vec2(0.0, bark.y * 2.5));
  float fibres = fine * 0.7 + valueNoise(around * 2.7 + vec2(5.0, bark.y)) * 0.3;
  float rings = 1.0 - smoothstep(0.0, 0.12, abs(fract(bark.y * 0.9) - 0.5) - 0.36) * 0.4;
  return mix(0.65, fibres * rings, palmDetail(bark.x * 48.0));
}

float palmBarkHeight(vec2 bark, float family) {
  if (family == PALM_RINGED) return palmRings(bark);
  if (family == PALM_LEAF_BASE) return palmLeafBases(bark);
  return palmFibres(bark);
}

vec3 lightPalmBark(vec3 base, vec3 normal, vec2 uv, vec3 world, float sunVisibility) {
  float family = getBarkFamily(uv);
  vec2 bark = vec2(-uv.x - BARK_UV_OFFSET - family * BARK_STRIDE, uv.y);
  float height = palmBarkHeight(bark, family);
  vec3 bumped = perturbBarkNormal(normal, world, height * PALM_DEPTH * barkScale(bark, world));
  float grain = 0.94 + barkNoise(bark, 4.0, 31.0) * 0.12;
  vec3 albedo = base * mix(0.88, 1.12, height) * grain * PALM_LIFT;
  float cavity = mix(0.9, 1.0, smoothstep(0.0, 0.5, height));
  vec3 bounce = albedo * (uAmbientSky + uAmbientGround) * 0.25;
  return lightSurface(albedo, bumped, sunVisibility, cavity, world.xz) + bounce;
}
`;
