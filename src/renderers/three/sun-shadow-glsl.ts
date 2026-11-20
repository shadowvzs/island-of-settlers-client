/** Light camera distance from the shadow centre along the sun ray, world units. */
export const SUN_SHADOW_DISTANCE = 300;
/** Light camera depth range (near 1 .. far 2 x SUN_SHADOW_DISTANCE), world units. */
const DEPTH_RANGE = SUN_SHADOW_DISTANCE * 2 - 1;
/** Constant part of the depth bias (world units along the light ray). */
const DEPTH_BIAS_UNITS = 0.04;
/** Most bias a steep receiver gets (the old constant bias: sun-grazing rock faces). */
const MAX_DEPTH_BIAS_UNITS = 0.9;

/**
 * The sun shadow lookup's constants, shared by SUN_SHADOW_GLSL and its TSL twin
 * (renderers/webgpu/tsl/sun-shadow.ts). Biases are in map depth (the GLSL literal's rounding).
 */
export const SUN_SHADOW_TUNING = {
  /** Constant depth bias in map depth units. */
  depthBias: Number((DEPTH_BIAS_UNITS / DEPTH_RANGE).toExponential(4)),
  /** World units of the light camera's depth range. */
  depthRange: DEPTH_RANGE,
  /** Poisson kernel radius limits, texels (the widest stays inside SHADOW_CASCADE_KERNEL_TEXELS). */
  maxKernelTexels: 6,
  /** Most bias a steep receiver gets, in map depth units. */
  maxDepthBias: Number((MAX_DEPTH_BIAS_UNITS / DEPTH_RANGE).toExponential(4)),
  minKernelTexels: 1,
  /**
   * Contact hardening (poisson12): penumbra width per world unit between receiver and blocker. The
   * real sun is about 0.009; a little more reads as soft crown shadows and sharp contacts.
   */
  penumbraPerUnit: 0.018,
  /** Share of the sun a fully shadowed receiver keeps (the shadow map's floor, owner fill light). */
  shadowFloor: 0.35
} as const;

/** 12-tap Poisson disc (unit radius); every third tap is a blocker search tap. */
export const SUN_SHADOW_POISSON: readonly (readonly [number, number])[] = [
  [-0.326, -0.406], [-0.84, -0.074], [-0.696, 0.457], [-0.203, 0.621],
  [0.962, -0.195], [0.473, -0.48], [0.519, 0.767], [0.185, -0.893],
  [0.507, 0.064], [0.896, 0.412], [-0.322, -0.933], [-0.792, -0.598]
];

const {
  maxKernelTexels: MAX_KERNEL_TEXELS,
  minKernelTexels: MIN_KERNEL_TEXELS,
  penumbraPerUnit: PENUMBRA_PER_UNIT,
  shadowFloor: SHADOW_FLOOR
} = SUN_SHADOW_TUNING;

/** Every uniform SUN_SHADOW_GLSL reads (materials that pick shared uniforms by name). */
export const SUN_SHADOW_UNIFORM_NAMES = [
  "uShadowAtlas",
  "uShadowCascades",
  "uShadowMap",
  "uShadowMatrix",
  "uShadowMatrix1",
  "uShadowMatrix2",
  "uShadowSlots",
  "uShadowTexel",
  "uShadowTexelWorld",
  "uSunShadowWeight",
  "uSunShadows"
] as const;

const float = (value: number) => value.toFixed(1);

/** The disc as GLSL constructor rows, four taps per line. */
const POISSON_ROWS_GLSL = [0, 4, 8].map(start => SUN_SHADOW_POISSON.slice(start, start + 4)
  .map(([x, y]) => `vec2(${x.toFixed(3)}, ${y.toFixed(3)})`).join(", ")).join(",\n  ");

/** 12-tap Poisson disc (unit radius), rotated per pixel; every third tap is a blocker search tap. */
const POISSON_GLSL = `
const vec2 SUN_SHADOW_POISSON[12] = vec2[12](
  ${POISSON_ROWS_GLSL}
);

float sunShadowTap(vec2 origin, vec3 projected, vec2 slope, vec2 offset) {
  float bias = min(SHADOW_DEPTH_BIAS + dot(slope, abs(offset) + 1.0), SHADOW_MAX_BIAS);
  vec2 uv = origin + (projected.xy + offset * uShadowTexel) * uShadowAtlas;
  return projected.z - bias > textureLod(uShadowMap, uv, 0.0).r ? 0.0 : 1.0;
}

/** 3 x 3 PCF (Low, Medium and the rollback). */
float sunShadowPcf(vec2 origin, vec3 projected, vec2 slope) {
  float lit = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) lit += sunShadowTap(origin, projected, slope, vec2(x, y));
  }
  return lit / 9.0;
}

/**
 * Rotated Poisson-12 with a cheap contact-hardening radius (High): four search taps estimate the
 * blocker depth, the penumbra grows with the receiver-blocker gap in world units, so a cascade
 * border keeps the same softness wherever the texel sizes allow it.
 */
float sunShadowPoisson(vec2 origin, vec3 projected, vec2 slope, float texelWorld) {
  float angle = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  mat2 spin = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
  float blockerDepth = 0.0;
  float blockers = 0.0;
  for (int index = 0; index < 12; index += 3) {
    vec2 offset = spin * SUN_SHADOW_POISSON[index] * ${float(MAX_KERNEL_TEXELS)};
    vec2 uv = origin + (projected.xy + offset * uShadowTexel) * uShadowAtlas;
    float depth = textureLod(uShadowMap, uv, 0.0).r;
    float bias = min(SHADOW_DEPTH_BIAS + dot(slope, abs(offset) + 1.0), SHADOW_MAX_BIAS);
    if (depth < projected.z - bias) {
      blockerDepth += depth;
      blockers += 1.0;
    }
  }
  float gap = blockers > 0.0 ? (projected.z - blockerDepth / blockers) * SHADOW_DEPTH_RANGE : 0.0;
  float radius = clamp(gap * ${PENUMBRA_PER_UNIT} / texelWorld, ${float(MIN_KERNEL_TEXELS)}, ${float(MAX_KERNEL_TEXELS)});
  float lit = 0.0;
  for (int index = 0; index < 12; index++) {
    lit += sunShadowTap(origin, projected, slope, spin * SUN_SHADOW_POISSON[index] * radius);
  }
  return lit / 12.0;
}
`;

/** Cascade selection: the first cascade whose tile holds the point, blended into the next one. */
const CASCADE_GLSL = `
mat4 sunShadowMatrix(int index) {
  if (index == 0) return uShadowMatrix;
  if (index == 1) return uShadowMatrix1;
  return uShadowMatrix2;
}

float sunShadowTexelWorld(int index) {
  if (index == 0) return uShadowTexelWorld.x;
  if (index == 1) return uShadowTexelWorld.y;
  return uShadowTexelWorld.z;
}

/** Atlas uv origin of a cascade's slot (the far cascade alternates between two slots on High). */
vec2 sunShadowOrigin(int index) {
  float slot = uShadowSlots.z;
  if (index == 0) slot = uShadowSlots.x;
  if (index == 1) slot = uShadowSlots.y;
  return vec2(mod(slot, uShadowSlots.w), floor(slot / uShadowSlots.w)) * uShadowAtlas;
}

/** Local uv distance to the nearest tile border minus the kernel border (negative: outside). */
float sunShadowEdge(vec3 projected) {
  vec2 inner = min(projected.xy, 1.0 - projected.xy);
  return min(inner.x, inner.y) - uShadowCascades.z;
}

/** Depth change per local uv of the receiving surface (receiver plane), from world derivatives. */
vec2 getShadowDepthSlope(vec3 dx, vec3 dy) {
  float det = dx.x * dy.y - dx.y * dy.x;
  if (abs(det) < 1e-12) return vec2(0.0);
  return vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / det;
}

float sunShadowCascade(int index, vec3 projected, vec3 worldDx, vec3 worldDy) {
  mat4 matrix = sunShadowMatrix(index);
  vec3 dx = (matrix * vec4(worldDx, 0.0)).xyz;
  vec3 dy = (matrix * vec4(worldDy, 0.0)).xyz;
  vec2 slope = abs(getShadowDepthSlope(dx, dy)) * uShadowTexel;
  vec2 origin = sunShadowOrigin(index);
  if (uShadowCascades.w > 0.5) return sunShadowPoisson(origin, projected, slope, sunShadowTexelWorld(index));
  return sunShadowPcf(origin, projected, slope);
}

/** The cascade after \`index\` inside its band; lit past the last one (the far fade). */
float sunShadowNextCascade(int index, int count, vec3 world, vec3 worldDx, vec3 worldDy) {
  if (index >= count) return 1.0;
  vec3 projected = (sunShadowMatrix(index) * vec4(world, 1.0)).xyz;
  if (sunShadowEdge(projected) < 0.0) return 1.0;
  return sunShadowCascade(index, projected, worldDx, worldDy);
}
`;

/**
 * Sun shadow lookup of every lit material. One map in the isometric view (and the rollback);
 * in the possessed view 2-3 cascades in one atlas (R08), picked by tile coverage: the first
 * cascade that holds the point with its kernel, blended into the next across a band. Real 3D
 * advantage: props shadow the ground, each other and themselves, and the shadows sway with wind.
 * Depth bias: a small constant (world units along the light) plus the receiver plane's depth
 * slope over each tap's offset (world derivatives through the cascade matrix, so a cascade
 * border inside a pixel quad does not spike it), capped. A single large constant bias (0.9 units)
 * cut every caster closer than that to its receiver: thin palm trunks lost their shadow near the
 * foot, so the crown shadow looked detached from the tree.
 */
export const SUN_SHADOW_GLSL = `
const float SHADOW_DEPTH_BIAS = ${(DEPTH_BIAS_UNITS / DEPTH_RANGE).toExponential(4)};
const float SHADOW_MAX_BIAS = ${(MAX_DEPTH_BIAS_UNITS / DEPTH_RANGE).toExponential(4)};
const float SHADOW_DEPTH_RANGE = ${float(DEPTH_RANGE)};
uniform sampler2D uShadowMap;
/** World to local cascade uv/depth: the single map, or cascades 0, 1 and 2. */
uniform mat4 uShadowMatrix;
uniform mat4 uShadowMatrix1;
uniform mat4 uShadowMatrix2;
/** One texel in local cascade uv. */
uniform float uShadowTexel;
/** One tile's share of the atlas uv (1, 1 without cascades). */
uniform vec2 uShadowAtlas;
/** Atlas slot of cascades 0, 1 and 2; w slots per atlas row. */
uniform vec4 uShadowSlots;
/** x cascades, y blend band, z kernel border (local uv), w 1 for the Poisson filter. */
uniform vec4 uShadowCascades;
/** World units per texel of each cascade (contact hardening). */
uniform vec3 uShadowTexelWorld;
/** 0: the sun shadow pass is off (Detail setting), everything reads as lit. */
uniform float uSunShadows;
/** Strength of the shadow map (getSunShadowWeight): low sun far from the baked direction, overcast. */
uniform float uSunShadowWeight;
${POISSON_GLSL}
${CASCADE_GLSL}
float sampleSunShadow(vec3 world) {
  if (uSunShadows < 0.5) return 1.0;
  vec3 worldDx = dFdx(world);
  vec3 worldDy = dFdy(world);
  int count = int(uShadowCascades.x + 0.5);
  for (int index = 0; index < 3; index++) {
    if (index >= count) break;
    vec3 projected = (sunShadowMatrix(index) * vec4(world, 1.0)).xyz;
    float edge = sunShadowEdge(projected);
    if (edge < 0.0) continue;
    float lit = sunShadowCascade(index, projected, worldDx, worldDy);
    float weight = count == 1 ? 1.0 : clamp(edge / uShadowCascades.y, 0.0, 1.0);
    if (weight < 1.0) lit = mix(sunShadowNextCascade(index + 1, count, world, worldDx, worldDy), lit, weight);
    return mix(1.0, mix(${SHADOW_FLOOR}, 1.0, lit), uSunShadowWeight);
  }
  return 1.0;
}
`;

/**
 * Sun visibility for screen-space passes (the AO pass, renderers/three/frame-ao.ts), where no
 * mesh derivatives exist: SUN_SHADOW_GLSL's uniforms and cascade helpers plus one cheap lookup.
 * The first cascade holding the point, 2 × 2 taps, a normal offset of two texels instead of the
 * receiver-plane slope. Returns the raw lit share 0..1; SUN_SHADOW_FLOOR and uSunShadowWeight are
 * the caller's, as sampleSunShadow applies them.
 */
export const SUN_SHADOW_SCREEN_GLSL = `${SUN_SHADOW_GLSL}
const float SUN_SHADOW_FLOOR = ${SHADOW_FLOOR};
float sampleSunShadowRaw(vec3 world, vec3 normal) {
  int count = int(uShadowCascades.x + 0.5);
  for (int index = 0; index < 3; index++) {
    if (index >= count) break;
    vec3 offset = normal * (2.0 * sunShadowTexelWorld(index));
    vec3 projected = (sunShadowMatrix(index) * vec4(world + offset, 1.0)).xyz;
    if (sunShadowEdge(projected) < 0.0) continue;
    vec2 origin = sunShadowOrigin(index);
    float lit = 0.0;
    for (int tap = 0; tap < 4; tap++) {
      vec2 corner = vec2(float(tap & 1), float(tap >> 1)) - 0.5;
      vec2 uv = origin + (projected.xy + corner * uShadowTexel) * uShadowAtlas;
      lit += projected.z - SHADOW_DEPTH_BIAS > textureLod(uShadowMap, uv, 0.0).r ? 0.0 : 1.0;
    }
    return lit * 0.25;
  }
  return 1.0;
}
`;
