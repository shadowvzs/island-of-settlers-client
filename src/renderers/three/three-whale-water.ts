import {
  BufferAttribute,
  DoubleSide,
  GLSL3,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  RawShaderMaterial
} from "three";

import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { WATER_SWELL_GLSL } from "../../render-common/shaders/water-glsl";
import type { WhaleFrame } from "../../render-common/whales/whale-director";
import { SPRAY_KIND } from "../../render-common/whales/whale-spray";
import { commitInstanceAttributes, createDynamicInstanceAttribute } from "./three-flyers";
import { RIPPLE_RING_GLSL } from "./three-ripples";

/**
 * The whale's water: one blended draw of camera-facing spray (the blow's mist, splash droplets)
 * and one of flat layers riding the swell (the submerged body's shadow, foam, rings). iPlace:
 * x, y, z, size; iLook: age (shadow: heading), kind, seed (shadow: species), opacity.
 */
const LOOK_KIND = { ...SPRAY_KIND, ring: 4, shadow: 3 } as const;
/** Flat instances lie this far above the swell (the water mesh interpolates between its vertices). */
const FLAT_CLEARANCE = 0.035;
/** Vertices per side of a flat instance (it follows the swell between them). */
const FLAT_GRID = 5;

const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec4 iPlace;
in vec4 iLook;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
${COMMON_UNIFORMS_GLSL}
${WATER_SWELL_GLSL}
out vec3 vWorld;
out vec2 vLocal;
out vec4 vLook;

vec3 flatPoint(vec2 corner) {
  if (iLook.y < 3.5 && iLook.y > 2.5) {
    vec2 forward = vec2(cos(iLook.x), -sin(iLook.x));
    vec2 side = vec2(-forward.y, forward.x);
    vec2 offset = (forward * corner.x + side * corner.y) * iPlace.w * 0.5;
    return vec3(iPlace.x + offset.x, iPlace.y, iPlace.z + offset.y);
  }
  return iPlace.xyz + vec3(corner.x, 0.0, corner.y) * iPlace.w;
}

void main() {
  vec2 corner = position.xz;
  vLocal = corner;
  vLook = iLook;
#ifdef FLAT_LAYER
  vec3 world = flatPoint(corner);
  world.y += getSwell(world.xz, uTime).x * getMapInterior(world.xz) + ${FLAT_CLEARANCE};
#else
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = iPlace.xyz + (right * corner.x + up * corner.y) * iPlace.w;
#endif
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec2 vLocal;
in vec4 vLook;
out vec4 fragColor;
uniform vec3 cameraPosition;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${RIPPLE_RING_GLSL}
const vec3 WHALE_SHADOW = vec3(0.004, 0.03, 0.045);
const vec3 FLIPPER_GLOW = vec3(0.12, 0.42, 0.42);

/** Top view of the submerged body: x -1 tail .. 1 nose, y across (half a body length each way). */
vec2 shadowMask(vec2 local, float species) {
  float along = (1.0 - local.x) * 0.5;
  float across = abs(local.y) * 0.5;
  float halfWidth = 0.105 * pow(sin(3.14159 * clamp(along / 0.94, 0.02, 1.0)), 0.7);
  float body = 1.0 - smoothstep(halfWidth * 0.5, halfWidth * 1.35 + 0.001, across);
  float flukeSpan = (species < 0.5 ? 0.17 : 0.13) * smoothstep(0.84, 0.95, along)
    * (1.0 - smoothstep(0.96, 1.0, along));
  float flukes = (1.0 - smoothstep(0.6, 1.1, across / max(flukeSpan, 0.001))) * step(0.001, flukeSpan);
  float flipperReach = species < 0.5 ? 0.33 : 0.17;
  float flipperAlong = 0.27 + (across - 0.07) * 0.3;
  float flipper = (1.0 - smoothstep(0.0, 0.05, abs(along - flipperAlong))) * 0.7
    * (1.0 - smoothstep(flipperReach * 0.85, flipperReach, across)) * smoothstep(0.04, 0.08, across);
  float glow = species < 0.5 ? flipper : 0.0;
  return vec2(max(max(body, flukes), flipper), glow);
}

vec4 litFoam(float alpha, vec3 normal) {
  vec3 color = lightSurface(FOAM, normal, 1.0, 1.0, vWorld.xz);
  return vec4(finishSurface(color, vWorld), alpha);
}

void main() {
  float kind = vLook.y;
  float distance = length(vLocal);
  float fade = 1.0 - vLook.x;
#ifdef FLAT_LAYER
  if (kind > 3.5) {
    float alpha = rippleAlpha(vLook.x, distance);
    if (alpha < 0.01) discard;
    fragColor = litFoam(alpha, vec3(0.0, 1.0, 0.0));
    return;
  }
  if (kind > 2.5) {
    vec2 mask = shadowMask(vLocal, vLook.z);
    float alpha = mask.x * vLook.w * 0.38;
    if (alpha < 0.01) discard;
    vec3 color = mix(WHALE_SHADOW, FLIPPER_GLOW * (uAmbientSky + uSunColor * 0.4), mask.y * 0.4);
    fragColor = vec4(finishSurface(color, vWorld), alpha);
    return;
  }
  // Fresh white water in the middle, dissolving into lace towards the rim and with age.
  float lace = smoothstep(0.32, 0.6, fbm3(vWorld.xz * 7.0 + vLook.z * 40.0));
  float fresh = (1.0 - smoothstep(0.0, 0.45, distance)) * fade * fade;
  float alpha = mix(lace, 1.0, fresh) * (1.0 - smoothstep(0.4, 1.0, distance)) * pow(fade, 1.5) * vLook.w * 0.8;
  if (alpha < 0.01) discard;
  fragColor = litFoam(alpha, vec3(0.0, 1.0, 0.0));
#else
  // Mist: a wispy puff (two noise octaves, drifting open with age), faint on its own so that
  // the overlapping puffs build a column with a dense core and ragged edges.
  vec2 seed = vec2(vLook.z * 31.0, vLook.z * 17.0);
  float body = 1.0 - smoothstep(0.1, 1.0, distance);
  float cloud = valueNoise(vLocal * 1.6 + seed) * 0.65 + valueNoise(vLocal * 3.7 - seed) * 0.35;
  float mist = body * smoothstep(0.32 + 0.25 * vLook.x, 0.75, cloud) * pow(fade, 1.2) * 0.32;
  // Spray: speckled droplets around a thin sheet of water.
  float speckle = smoothstep(0.45, 0.75, valueNoise(vLocal * 9.0 + seed));
  float droplets = (1.0 - smoothstep(0.25, 1.0, distance)) * mix(0.35, 1.0, speckle) * pow(fade, 0.7) * 0.85;
  float alpha = (kind < 0.5 ? mist : droplets) * vLook.w;
  if (alpha < 0.01) discard;
  vec3 toEye = normalize(cameraPosition - vWorld);
  float forward = pow(max(dot(-toEye, uSunDirection), 0.0), 6.0);
  vec4 color = litFoam(alpha, normalize(toEye + vec3(0.0, 1.0, 0.0)));
  color.rgb *= kind < 0.5 ? 0.82 : 0.92;
  color.rgb += uSunColor * forward * 0.25 * alpha;
  fragColor = color;
#endif
}
`;

const createInstances = (grid: number, capacity: number) => {
  const geometry = new InstancedBufferGeometry();
  const corners: number[] = [];
  for (let row = 0; row < grid; row += 1) {
    for (let column = 0; column < grid; column += 1) {
      corners.push((column / (grid - 1)) * 2 - 1, 0, (row / (grid - 1)) * 2 - 1);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < grid - 1; row += 1) {
    for (let column = 0; column < grid - 1; column += 1) {
      const corner = row * grid + column;
      indices.push(corner, corner + grid, corner + 1, corner + 1, corner + grid, corner + grid + 1);
    }
  }
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(corners), 3));
  geometry.setIndex(indices);
  const place = createDynamicInstanceAttribute(capacity);
  const look = createDynamicInstanceAttribute(capacity);
  geometry.setAttribute("iPlace", place);
  geometry.setAttribute("iLook", look);
  geometry.instanceCount = 0;
  return { geometry, look, place };
};

type Look = [number, number, number, number];

const createLayer = (shared: Record<string, IUniform>, capacity: number, flat: boolean) => {
  const instances = createInstances(flat ? FLAT_GRID : 2, capacity);
  const material = new RawShaderMaterial({
    defines: flat ? { FLAT_LAYER: "" } : {},
    depthWrite: false,
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    // The grid is wound for a top view; the camera-facing quads show their back.
    side: DoubleSide,
    transparent: true,
    uniforms: shared,
    vertexShader: VERTEX_GLSL
  });
  const mesh = new Mesh(instances.geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  const places = instances.place.array as Float32Array;
  const looks = instances.look.array as Float32Array;
  let count = 0;
  const push = (x: number, y: number, z: number, size: number, look: Look) => {
    if (count >= capacity) return;
    const offset = count * 4;
    places[offset] = x;
    places[offset + 1] = y;
    places[offset + 2] = z;
    places[offset + 3] = size;
    for (let channel = 0; channel < 4; channel += 1) looks[offset + channel] = look[channel]!;
    count += 1;
  };
  const commit = () => {
    instances.geometry.instanceCount = count;
    mesh.visible = count > 0;
    if (count > 0) commitInstanceAttributes([instances.place, instances.look], count);
    count = 0;
  };
  return { commit, mesh, push };
};

/** The whale's spray and its flat water marks (two blended draws, none while nothing is live). */
export const createThreeWhaleWater = (shared: Record<string, IUniform>, spray: number, rings: number) => {
  const billboards = createLayer(shared, spray, false);
  const flats = createLayer(shared, spray + rings + 1, true);
  const look: Look = [0, 0, 0, 0];

  const update = (frame: WhaleFrame) => {
    const { pose, ripples, shadow } = frame;
    if (frame.active && shadow.opacity > 0.01) {
      look[0] = shadow.yaw; look[1] = LOOK_KIND.shadow; look[2] = pose.species; look[3] = shadow.opacity;
      flats.push(shadow.x, shadow.y, shadow.z, shadow.length, look);
    }
    const { count, look: looks, placement } = frame.spray;
    for (let index = 0; index < count; index += 1) {
      const offset = index * 4;
      for (let channel = 0; channel < 4; channel += 1) look[channel] = looks[offset + channel]!;
      const layer = look[1] === LOOK_KIND.foam ? flats : billboards;
      layer.push(placement[offset]!, placement[offset + 1]!, placement[offset + 2]!, placement[offset + 3]!, look);
    }
    for (let index = 0; index < ripples.count; index += 1) {
      look[0] = ripples.age[index]!; look[1] = LOOK_KIND.ring; look[2] = 0; look[3] = 1;
      flats.push(ripples.x[index]!, ripples.y[index]!, ripples.z[index]!, ripples.size[index]!, look);
    }
    flats.commit();
    billboards.commit();
  };

  return { meshes: [flats.mesh, billboards.mesh], update };
};
