import { type BufferGeometry, Float32BufferAttribute, type MeshStandardMaterial } from "three";

/**
 * Hanging decorations (paper lanterns, cedar balls) swing about their hang point on High. The
 * swing runs in the vertex shader of one shared material per base material: no per-object
 * transforms or extra draw calls beyond the one merged "sway" mesh of a building.
 */
const SWAY_PIVOT_ATTRIBUTE = "swayPivot";

/** The shared clock/wind record; the WebGPU TSL twin binds the same values. */
export const hangingDecorSwayUniforms = { uSwayTime: { value: 0 }, uSwayWind: { value: 0 } };
const uniforms = hangingDecorSwayUniforms;
const swayMaterials = new WeakMap<MeshStandardMaterial, MeshStandardMaterial>();

/**
 * Sway tuning shared by the GLSL template and the WebGPU TSL twin (`webgpu/tsl/buildings.ts`).
 * `swayGlsl` prints each value as the literal the template used (`.73`, `.1`, `0.`), so the
 * generated WebGL shader source stays byte-identical.
 */
export const HANGING_DECOR_SWAY = {
  originXWeight: .73,
  originZWeight: 1.13,
  phaseWeightX: 3.1,
  phaseWeightY: 1.7,
  phaseWeightZ: 2.3,
  pitchRate: 1.6,
  rollPhase: 1.3,
  rollPhaseWeight: 1.7,
  rollRate: 1.13,
  rollShare: .7,
  strengthBase: .05,
  strengthWind: .1,
  windClampMax: 1.5,
  windClampMin: 0
} as const;
const SWAY = HANGING_DECOR_SWAY;
const swayGlsl = (value: number) =>
  (Number.isInteger(value) ? `${value}.` : String(value).replace(/^0\./, "."));

const SWAY_HEADER = /* glsl */ `
attribute vec3 swayPivot;
uniform float uSwayTime;
uniform float uSwayWind;
mat3 swayRotation;
`;

/**
 * Two small pendulum angles with a per-lantern phase (from its pivot and the building's world
 * position), stronger in wind; normals turn with the lantern.
 */
const SWAY_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
{
  vec3 origin = modelMatrix[3].xyz;
  float phase = dot(swayPivot, vec3(${swayGlsl(SWAY.phaseWeightX)}, ${swayGlsl(SWAY.phaseWeightY)}, ` +
  `${swayGlsl(SWAY.phaseWeightZ)})) + origin.x * ${swayGlsl(SWAY.originXWeight)} + ` +
  `origin.z * ${swayGlsl(SWAY.originZWeight)};
  float strength = ${swayGlsl(SWAY.strengthBase)} + ${swayGlsl(SWAY.strengthWind)} * ` +
  `clamp(uSwayWind, ${swayGlsl(SWAY.windClampMin)}, ${swayGlsl(SWAY.windClampMax)});
  float pitch = strength * sin(uSwayTime * ${swayGlsl(SWAY.pitchRate)} + phase);
  float roll = strength * ${swayGlsl(SWAY.rollShare)} * sin(uSwayTime * ` +
  `${swayGlsl(SWAY.rollRate)} + phase * ${swayGlsl(SWAY.rollPhaseWeight)} + ${swayGlsl(SWAY.rollPhase)});
  float cp = cos(pitch), sp = sin(pitch), cr = cos(roll), sr = sin(roll);
  mat3 aroundX = mat3(1., 0., 0., 0., cp, sp, 0., -sp, cp);
  mat3 aroundZ = mat3(cr, sr, 0., -sr, cr, 0., 0., 0., 1.);
  swayRotation = aroundZ * aroundX;
  objectNormal = swayRotation * objectNormal;
}
`;

const SWAY_POSITION = /* glsl */ `
#include <begin_vertex>
transformed = swayPivot + swayRotation * (transformed - swayPivot);
`;

/** The swinging variant of a building material, created once and shared by every building. */
export const getSwayMaterial = (base: MeshStandardMaterial) => {
  const cached = swayMaterials.get(base);
  if (cached) return cached;
  const material = base.clone();
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = SWAY_HEADER + shader.vertexShader
      .replace("#include <beginnormal_vertex>", SWAY_NORMAL)
      .replace("#include <begin_vertex>", SWAY_POSITION);
  };
  material.customProgramCacheKey = () => "hanging-decor-sway";
  // The WebGPU presenter selects its TSL sway extension by this key.
  material.userData.shaderKey = "hanging-decor-sway-v1";
  swayMaterials.set(base, material);
  return material;
};

/** Every vertex of a hanging part swings about the part's hang point. */
export const setSwayPivot = (geometry: BufferGeometry, pivot: readonly number[]) => {
  const count = geometry.getAttribute("position").count, values = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex++) values.set(pivot, vertex * 3);
  geometry.setAttribute(SWAY_PIVOT_ATTRIBUTE, new Float32BufferAttribute(values, 3));
};

/** Shared clock and wind for all swinging decorations (called from building updates). */
export const updateHangingDecorSway = (time: number, windStrength = 0) => {
  uniforms.uSwayTime.value = time;
  uniforms.uSwayWind.value = windStrength;
};
