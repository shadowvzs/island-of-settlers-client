import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  GLSL3,
  type IUniform,
  Mesh,
  RawShaderMaterial
} from "three";

import { SURFACE_COLOR_OUTPUT_GLSL } from "../../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../../render-common/shaders/prop-glsl";
import { WATER_FOAM_GLSL, WATER_SWELL_GLSL } from "../../../render-common/shaders/water-glsl";
import { LIGHTER_BEAM, LIGHTER_LENGTH } from "../../../render-common/ships/lighter-dimensions";
import { SAILING_SHIP_HULL_BEAM, SAILING_SHIP_HULL_LENGTH } from "../../../render-common/ships/ship-dimensions";
import type { ShipFrame, ShuttleBoatFrame } from "../../../render-common/ships/ship-frame";
import { SHIP_WAKE_FOAM } from "../../../render-common/ships/ship-wake-foam";
import {
  createWakeBuffers,
  createWakeTrails,
  type WakeHull,
  type WakeWaterSampler
} from "../../../render-common/ships/ship-wake-trails";
import { WATER_FIELD_GLSL } from "../../../render-common/water-field";
import { SUN_SHADOW_GLSL } from "../three-shadows";

/** GLSL float literal of a shared tuning value, keeping the generated shader bytes unchanged. */
const wakeFloat = (value: number) => {
  const text = String(value);
  return text.includes(".") ? text : `${text}.0`;
};
const F = SHIP_WAKE_FOAM;

/** The ribbon rides the same swell as the water mesh, a hair above it (depth from the CPU sampler). */
const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec4 wake;
in vec4 shape;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec4 vWake;
out vec4 vShape;
${COMMON_UNIFORMS_GLSL}
${WATER_SWELL_GLSL}

void main() {
  vWake = wake;
  vShape = shape;
  float lift = getSwell(position.xz, uTime).x * getSwellCalm(shape.w, vec2(0.0)) * getMapInterior(position.xz);
  // Clearance for the water mesh's own interpolation between its vertices.
  vWorld = position + vec3(0.0, lift + 0.06, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

/**
 * Foam of the wake: thin Kelvin arms along the ribbon edges and a churned band behind the stern,
 * both widening and dissolving into lace with age; faded by the hull's speed and in the shallows.
 * Lit like the water's own foam (sun and sky, cloud and sun shadow), blended over the surface.
 */
const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec4 vWake;
in vec4 vShape;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${WATER_FIELD_GLSL}
${WATER_FOAM_GLSL}
${SUN_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}

/**
 * Foam of the wake in [0, 1], built from soft continuous profiles across the ribbon (lateral world
 * distance d from the track): the two Kelvin arms (Gaussian lines inside the ribbon edges, widening
 * with age), the churned band behind the stern (widening into the V), and a faint turbulent fill
 * between them so band and arms read as one wake. The lace only modulates the brightness, never
 * thresholds it, so the foam has no dashes, gaps or detached patches.
 */
float wakeFoam(float along, float lateral, float age) {
  float halfWidth = vShape.x, beam = vShape.y, hullLength = vShape.z;
  float d = abs(lateral);
  float armWidth = ${wakeFloat(F.armWidth)} + ${wakeFloat(F.armAgeWidth)} * age;
  float armOffset = (d - halfWidth * ${wakeFloat(F.armOffset)}) / armWidth;
  float arms = exp(-${wakeFloat(2)} * armOffset * armOffset) * (${wakeFloat(F.armGain)} - ${wakeFloat(F.armGainAge)} * age);
  float churnHalf = beam * (${wakeFloat(F.churnHalfBeam)} + ${wakeFloat(F.churnAgeHalf)} * age);
  float churn = exp(-${wakeFloat(2)} * (d / churnHalf) * (d / churnHalf)) * (${wakeFloat(F.churnGain)} - ${wakeFloat(F.churnAgeGain)} * age)
    * smoothstep(hullLength * ${wakeFloat(F.churnStart)}, hullLength * ${wakeFloat(F.churnFull)}, along);
  float fill = ${wakeFloat(F.fillGain)} * (${wakeFloat(1)} - smoothstep(halfWidth * ${wakeFloat(F.fillInner)}, halfWidth * ${wakeFloat(F.fillOuter)}, d))
    * smoothstep(hullLength * ${wakeFloat(F.fillStart)}, hullLength * ${wakeFloat(F.fillEnd)}, along)
    * (${wakeFloat(1)} - smoothstep(hullLength * ${wakeFloat(F.fillTailStart)}, hullLength * ${wakeFloat(F.fillTailEnd)}, along));
  float edge = ${wakeFloat(1)} - smoothstep(halfWidth * ${wakeFloat(F.edgeStart)}, halfWidth, d);
  return max(max(arms, churn), fill) * edge;
}

void main() {
  // Mask and fades from the varyings first: most of the wedge between the arms is discarded before
  // any texture fetch (the vertex depth stands in for the water field's in the shallows fade).
  float age = vWake.z;
  float fade = vWake.w * pow(${wakeFloat(1)} - age, ${wakeFloat(F.ageExponent)}) * smoothstep(${wakeFloat(F.depthStart)}, ${wakeFloat(F.depthEnd)}, vShape.w) * smoothstep(${wakeFloat(F.alongStart)}, ${wakeFloat(F.alongEnd)}, vWake.x);
  float foam = wakeFoam(vWake.x, vWake.y, age) * fade;
  if (foam < ${wakeFloat(F.minimumFoam)}) discard;
  vec4 field = sampleWaterField(vWorld.xz);
  if (isHiddenByFog(field.z, vWorld.xz)) discard;
  foam *= mix(${wakeFloat(F.laceFloor)}, ${wakeFloat(1)}, foamLace(vWorld.xz, uTime));
  vec3 tint = uSunColor * ${wakeFloat(F.sunShare)} + uAmbientSky * ${wakeFloat(F.ambientShare)};
  float light = (${wakeFloat(F.ambientBase)} + ${wakeFloat(F.ambientSun)} * max(uSunDirection.y, ${wakeFloat(0)})) * cloudShadow(vWorld.xz);
  vec3 color = FOAM_COLOR * tint * (${wakeFloat(F.foamBase)} + ${wakeFloat(F.foamLight)} * light) * mix(${wakeFloat(F.shadowFloor)}, ${wakeFloat(1)}, sampleSunShadow(vWorld))
    * foamGlare();
  fragColor = vec4(finishSurface(applyFogOfWar(color, field.z, vWorld.xz), vWorld), foam * ${wakeFloat(F.alpha)});
}
`;

const SHIP_HULL: WakeHull = { beam: SAILING_SHIP_HULL_BEAM, length: SAILING_SHIP_HULL_LENGTH };
const BOAT_HULL: WakeHull = { beam: LIGHTER_BEAM, length: LIGHTER_LENGTH };
/** Ship phases whose hull moves under way; berthed, stranded or away ships leave no new wake. */
const UNDER_WAY: ReadonlySet<ShipFrame["phase"]> = new Set(["positioning", "sailing"]);
const VERTEX_STREAMS = ["position", "wake", "shape"] as const;

const createRibbonGeometry = (buffers: ReturnType<typeof createWakeBuffers>) => {
  const geometry = new BufferGeometry();
  const attribute = (array: Float32Array, size: number) =>
    new BufferAttribute(array, size).setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", attribute(buffers.position, 3));
  geometry.setAttribute("wake", attribute(buffers.wake, 4));
  geometry.setAttribute("shape", attribute(buffers.shape, 4));
  geometry.setIndex(new BufferAttribute(buffers.index, 1).setUsage(DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  return geometry;
};

/**
 * Foam wakes of the moving ships and rowing boats (R18a): `budget` ribbons in one blended draw,
 * shaded only where they cover the water. Presentation only (render-common/ships/ship-wake-trails.ts).
 */
export const createThreeShipWakes = (
  budget: number, uniforms: Record<string, IUniform>, sampleWater: WakeWaterSampler
) => {
  const buffers = createWakeBuffers(budget);
  const trails = createWakeTrails(budget);
  const geometry = createRibbonGeometry(buffers);
  const material = new RawShaderMaterial({
    depthWrite: false,
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    transparent: true,
    uniforms,
    vertexShader: VERTEX_GLSL
  });
  material.userData.wg5ShipWake = true;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;

  const update = (ships: readonly ShipFrame[], boats: readonly ShuttleBoatFrame[], time: number) => {
    for (const ship of ships) {
      if (!UNDER_WAY.has(ship.phase) || ship.sinkProgress) continue;
      trails.track(ship.id * 2, SHIP_HULL, ship.x, ship.z, ship.yaw, time);
    }
    for (const boat of boats) if (boat.rowing) trails.track(boat.id * 2 + 1, BOAT_HULL, boat.x, boat.z, boat.yaw, time);
    const indices = trails.finish(buffers, sampleWater, time);
    mesh.visible = indices > 0;
    if (indices === 0) return;
    geometry.setDrawRange(0, indices);
    // Small streams (a few kB): whole uploads, no partial range bookkeeping.
    for (const name of VERTEX_STREAMS) geometry.getAttribute(name).needsUpdate = true;
    geometry.getIndex()!.needsUpdate = true;
  };

  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };

  return { dispose, mesh, update };
};
