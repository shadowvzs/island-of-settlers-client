import {
  CanvasTexture, DoubleSide, GLSL3, type InstancedMesh, type IUniform, Object3D, RawShaderMaterial, RepeatWrapping
} from "three";

import { connectCustomAtmosphere } from "../atmosphere/custom-atmosphere";

/**
 * Shared fire for burning buildings: the demolition burn-down and the colony fort siege fire use the
 * same volumetric flames, smoke billboards, embers and charred timber. `age` animates; `fade` (0–1)
 * is set per effect from its own timeline.
 */
const NOISE = `
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
    mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
    mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;
const HEADER = `precision highp float;
uniform float age;
in vec3 position;
in mat4 instanceMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
out vec3 vWorld;
uniform mat4 projectionMatrix;
out vec3 local;
out float seed;
`;
export const FLAME_VERTEX = `${HEADER}
out vec3 cameraLocal;
void main() {
  seed = float(gl_InstanceID) * 1.713;
  local = position;
  vWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
  cameraLocal = (inverse(modelViewMatrix * instanceMatrix) * vec4(0,0,0,1)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

/** Integrate animated density inside a box; the box itself is never shaded or visible. */
export const flameFragment = (steps: number) => `precision highp float;
uniform float age;
uniform float fade;
in vec3 local;
in vec3 vWorld;
in vec3 cameraLocal;
in float seed;
out vec4 fragColor;
${NOISE}
float flameDensity(vec3 p) {
  float height = p.y;
  vec3 wind = vec3(sin(height * 8.0 + age * 2.0 + seed + p.z * 5.0) * height * 0.12, 0.0,
    cos(height * 6.0 - age * 1.7 + seed + p.x * 5.0) * height * 0.1);
  vec3 flowing = (p - wind) * vec3(7.0, 4.0, 7.0) - vec3(0, age * 2.5, 0);
  float turbulence = noise(flowing + seed) * 0.65
    + noise(flowing * 2.1 - age * 1.2) * 0.35;
  ${steps > 12 ? "turbulence = turbulence * 0.85 + noise(flowing * 4.3 + seed) * 0.15;" : ""}
  float radius = 0.43 * (1.0 - height * 0.66);
  float edge = 1.0 - smoothstep(0.45, 1.0,
    length((p - wind).xz) / radius + (turbulence - 0.5) * 0.8);
  float tongues = smoothstep(0.24, 0.68, turbulence - height * 0.28);
  return edge * tongues * smoothstep(0.0, 0.08, height)
    * (1.0 - smoothstep(0.65, 1.0, height));
}
void main() {
  // Only the front box surface starts a ray; discard back faces to avoid doubled fire.
  if (!gl_FrontFacing) discard;
  vec3 direction = normalize(local - cameraLocal);
  vec3 safeDirection = direction + vec3(0.000001);
  vec3 nearPlane = (vec3(-0.5, 0.0, -0.5) - cameraLocal) / safeDirection;
  vec3 farPlane = (vec3(0.5, 1.0, 0.5) - cameraLocal) / safeDirection;
  vec3 nearDistances = min(nearPlane, farPlane), farDistances = max(nearPlane, farPlane);
  float entry = max(0.0, max(nearDistances.x, max(nearDistances.y, nearDistances.z)));
  float exitDistance = min(farDistances.x, min(farDistances.y, farDistances.z));
  if (exitDistance <= entry) discard;
  float stepSize = (exitDistance - entry) / ${steps.toFixed(1)};
  float jitter = hash(vec3(gl_FragCoord.xy, seed));
  vec4 accumulated = vec4(0.0);
  for (int stepIndex = 0; stepIndex < ${steps}; stepIndex++) {
    vec3 p = cameraLocal + direction * (entry + (float(stepIndex) + jitter) * stepSize);
    float density = flameDensity(p);
    float opacity = 1.0 - exp(-density * stepSize * 7.0);
    float heat = clamp(density * 0.85 + (1.0 - p.y) * 0.35, 0.0, 1.0);
    vec3 color = mix(vec3(0.95, 0.09, 0.008), vec3(1.0, 0.61, 0.035), smoothstep(0.1, 0.7, heat));
    color = mix(color, vec3(1.0, 0.94, 0.65), smoothstep(0.7, 1.0, heat));
    float contribution = (1.0 - accumulated.a) * opacity;
    accumulated.rgb += color * contribution;
    accumulated.a += contribution;
  }
  float alpha = accumulated.a * fade;
  if (alpha < 0.015) discard;
  fragColor = vec4(accumulated.rgb / max(accumulated.a, 0.001), alpha);
}
`;
/** Camera-facing quad: x and y sizes from the instance matrix's first two columns. */
export const BILLBOARD_VERTEX = `${HEADER}
void main() {
  seed = float(gl_InstanceID) * 1.713;
  local = position;
  vWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
  vec4 center = modelViewMatrix * instanceMatrix * vec4(0,0,0,1);
  center.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  vWorld = (inverse(viewMatrix) * center).xyz;
  gl_Position = projectionMatrix * center;
}`;
const SMOKE_FRAGMENT = `precision highp float;
uniform float age;
uniform float fade;
uniform float shade;
uniform float density;
in vec3 local;
in vec3 vWorld;
in float seed;
out vec4 fragColor;
${NOISE}
void main() {
  float grain = noise(vec3(local.xy * 7.0 + seed, age * 0.35));
  float edge = 1.0 - smoothstep(0.14, 0.5, length(local.xy) + (grain - 0.5) * 0.1);
  float alpha = edge * fade * density;
  if (alpha < 0.01) discard;
  fragColor = vec4(vec3(shade + grain * 0.12), alpha);
}`;
export const EMBER_VERTEX = `${HEADER}
void main() {
  seed = float(gl_InstanceID) * 1.713;
  local = position;
  vWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
export const EMBER_FRAGMENT = `precision highp float;
uniform float age;
uniform float fade;
in vec3 local;
in vec3 vWorld;
in float seed;
out vec4 fragColor;
void main() {
  float heat = 0.5 + 0.5 * sin(age * 9.0 + seed);
  vec3 color = mix(vec3(1.0, 0.18, 0.008), vec3(1.0, 0.82, 0.34), heat);
  fragColor = vec4(color, fade * 0.85);
}`;

/** A transparent effect material; `age` drives the animation and `fade` the opacity. */
export const burnMaterial = (vertexShader: string, fragmentShader: string,
  extra: Record<string, { value: unknown }> = {},
  atmosphereUniforms: Record<string, IUniform> = {}, additive = false
) => connectCustomAtmosphere(new RawShaderMaterial({
  glslVersion: GLSL3, vertexShader, fragmentShader, side: DoubleSide,
  transparent: true, depthWrite: false, uniforms: { age: { value: 0 }, fade: { value: 1 }, ...extra }
}), atmosphereUniforms, "fragColor", additive);
export type BurnMaterial = ReturnType<typeof burnMaterial>;
/**
 * Smoke billboards: `shade` is the base grey, `density` the peak opacity (the demolition's dark smoke
 * is 0.13 / 0.38; a fort's thick smoke is lighter so it reads against dark cliffs).
 */
export const smokeMaterial = (shade: number, density: number, atmosphereUniforms: Record<string, IUniform> = {}) =>
  burnMaterial(BILLBOARD_VERTEX, SMOKE_FRAGMENT,
    { density: { value: density }, shade: { value: shade } }, atmosphereUniforms);
export const setBurnUniforms = (material: BurnMaterial, age: number, fade: number) => {
  material.uniforms.age!.value = age; material.uniforms.fade!.value = fade;
};

export const charredTimberTexture = () => {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 128;
  const context = canvas.getContext("2d")!, pixels = context.createImageData(256, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) {
    const grain = Math.sin(y * 1.7 + Math.sin(x * .045) * 2.0);
    const split = Math.sin(y * .24 + Math.sin(x * .026)) > .92;
    const value = split ? 5 : 17 + grain * 6 + Math.sin(x * .9 + y * 2.3) * 3;
    pixels.data.set([value + 3, value + 1, value, 255], (y * 256 + x) * 4);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas); texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
};

/** Deterministic 0–1 values per index, varied by the footprint. */
export const burnRandom = (width: number, depth: number) => (index: number) =>
  ((Math.sin(index * 12.9898 + width * 7 + depth) * 43758.5453) % 1 + 1) % 1;

/**
 * A burnt-down fort's pile: charred timbers leaning on each other, highest in the middle, with a few
 * upright stumps of the posts around it.
 */
const layOutCharredHeap = (ruins: InstancedMesh, width: number, depth: number) => {
  const random = burnRandom(width, depth), transform = new Object3D();
  for (let index = 0; index < ruins.count; index++) {
    const post = index % 6 === 0, angle = random(index * 3 + 1) * 6.28;
    const radius = post ? .3 + random(index * 3) * .08 : Math.sqrt(random(index * 3)) * .3;
    const centre = 1 - radius / .3;
    transform.position.set(Math.cos(angle) * radius * width, 0, Math.sin(angle) * radius * depth);
    if (post) {
      const tall = .5 + random(index + 9) * .6;
      transform.rotation.set((random(index + 1) - .5) * .3, random(index + 10) * 6.28, (random(index + 2) - .5) * .3);
      transform.scale.set(.16, tall, .16);
      transform.position.y = tall / 2;
    } else {
      transform.rotation.set((random(index + 1) - .5) * 1.2, random(index + 10) * 6.28, (random(index + 2) - .5) * .4);
      transform.scale.set(.13 + random(index + 3) * .1, .13, .5 + random(index + 9) * .9);
      transform.position.y = .1 + centre * (.25 + random(index + 5) * .45);
    }
    transform.updateMatrix(); ruins.setMatrixAt(index, transform.matrix);
  }
  ruins.instanceMatrix.needsUpdate = true;
};

/** Black charred beams scattered inside the footprint, resting on the ground; `heap`: a fort's pile. */
export const layOutCharredRuin = (ruins: InstancedMesh, width: number, depth: number, heap = false) => {
  if (heap) { layOutCharredHeap(ruins, width, depth); return; }
  const random = burnRandom(width, depth), transform = new Object3D();
  for (let index = 0; index < ruins.count; index++) {
    transform.position.set((random(index * 3) - .5) * width * .75, .07 + random(index + 5) * .15,
      (random(index * 3 + 2) - .5) * depth * .75);
    transform.rotation.set((random(index + 1) - .5) * .25, random(index + 10) * 6.28, .07);
    transform.scale.set(.12 + random(index + 3) * .1, .12, .5 + random(index + 9) * width * .55);
    transform.updateMatrix();
    const matrix = transform.matrix.elements;
    transform.position.y = .01 + (Math.abs(matrix[1]!) + Math.abs(matrix[5]!) + Math.abs(matrix[9]!)) * .5;
    transform.updateMatrix(); ruins.setMatrixAt(index, transform.matrix);
  }
  ruins.instanceMatrix.needsUpdate = true;
};
