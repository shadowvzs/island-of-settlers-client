import {
  AdditiveBlending,
  BufferAttribute,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial
} from "three";

import type { CinematicGlint } from "../../../render-common/cinematic/cinematic-frame";
import { GLINT_OFFSET_STRIDE, GLINT_PARAM_STRIDE, writeGlintArea } from "./region-glint-layout";

type GroundHeight = (x: number, z: number) => number;

export interface RegionGlintOptions {
  cellsX: number;
  groundHeight: GroundHeight;
  /** Sparkles (and edge dots) per highlighted area (QualityPreset.cinematicView.glintSprites). */
  spritesPerArea: number;
}

/** Most areas highlighted at once (more are ignored); the instance buffer is sized for them up front. */
const MAX_AREAS = 4;
/** Instances per area: the sparkles plus the edge dots, each capped at `spritesPerArea`. */
const KINDS_PER_AREA = 2;
/**
 * World units each instance is drawn toward the camera along its view ray: it stays on the surface on screen,
 * but the ground (or a slope) no longer clips the lower half of a sparkle or the flat edge dots.
 */
const SURFACE_PULL = 0.45;

const VERTEX = /* glsl */ `
attribute vec3 aOffset;
attribute vec3 aParams;
uniform float uPull;
uniform float uTime;
varying vec2 vCorner;
varying float vKind;
varying float vLight;
void main() {
  float phase = aParams.x;
  float size = aParams.y;
  vKind = aParams.z;
  vCorner = position.xy;
  vec4 view;
  if (vKind < 0.5) {
    // A sparkle: a camera-facing star that fades in and out slowly on its own rhythm; the steep power keeps most
    // of them dim at any moment, so the area shimmers instead of flashing.
    float wave = 0.5 + 0.5 * sin(uTime * (0.9 + phase * 1.3) + phase * 37.0);
    vLight = pow(wave, 4.0);
    view = modelViewMatrix * vec4(aOffset, 1.0);
    view.xy += position.xy * size * (0.55 + 0.45 * vLight);
  } else {
    // An edge dot: a soft glow lying flat on the ground; a slow light runs around the outline.
    vLight = 0.55 + 0.45 * sin(uTime * 1.4 - phase * 18.849556);
    view = modelViewMatrix * vec4(aOffset + vec3(position.x, 0.0, position.y) * size, 1.0);
  }
  // Orthographic views look along -z; perspective views along the ray to the eye at the origin.
  vec3 toward = projectionMatrix[3][3] > 0.5 ? vec3(0.0, 0.0, 1.0) : -normalize(view.xyz);
  view.xyz += toward * uPull;
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vCorner;
varying float vKind;
varying float vLight;
void main() {
  float radius = length(vCorner);
  float light;
  if (vKind < 0.5) {
    float core = exp(-radius * radius * 18.0);
    // A four point star: thin rays along the sprite axes.
    float rays = exp(-abs(vCorner.x) * 26.0) + exp(-abs(vCorner.y) * 26.0);
    rays *= max(0.0, 1.0 - radius);
    light = (core + rays * 0.55) * vLight * 1.5;
  } else {
    light = exp(-radius * radius * 6.0) * max(0.0, 1.0 - radius) * vLight * 0.6;
  }
  if (light < 0.004) discard;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.48) * light, 1.0);
}
`;

/**
 * Highlighted areas (CIN2, reworked in CIN6 after the owner review): small sparkles lying on the surface inside the
 * area's cells plus a soft glow along its outline, all in one instanced additive draw, twinkle in the vertex shader
 * (no per-frame CPU), rebuilt only when the highlighted cells change. `setWarming` draws it empty during loading
 * so its program is compiled before the first highlight.
 */
export const createThreeRegionGlint = ({ cellsX, groundHeight, spritesPerArea }: RegionGlintOptions) => {
  const capacity = MAX_AREAS * spritesPerArea * KINDS_PER_AREA;
  const buffers = { offsets: new Float32Array(capacity * GLINT_OFFSET_STRIDE),
    params: new Float32Array(capacity * GLINT_PARAM_STRIDE) };
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([
    -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0
  ]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const offsetAttribute = new InstancedBufferAttribute(buffers.offsets, GLINT_OFFSET_STRIDE);
  const paramAttribute = new InstancedBufferAttribute(buffers.params, GLINT_PARAM_STRIDE);
  geometry.setAttribute("aOffset", offsetAttribute);
  geometry.setAttribute("aParams", paramAttribute);
  geometry.instanceCount = 0;
  const material = new ShaderMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    fragmentShader: FRAGMENT,
    // Edge dots lie flat: seen from below a slope they must still draw.
    side: DoubleSide,
    transparent: true,
    uniforms: { uPull: { value: SURFACE_PULL }, uTime: { value: 0 } },
    vertexShader: VERTEX
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "region-glint";
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.visible = false;
  let shown: readonly Readonly<Int32Array>[] = [];
  let warming = false;

  const unchanged = (glints: readonly CinematicGlint[]) =>
    glints.length === shown.length && glints.every((glint, index) => glint.cells === shown[index]);

  const rebuild = (glints: readonly CinematicGlint[]) => {
    shown = glints.map(glint => glint.cells);
    let count = 0;
    glints.slice(0, MAX_AREAS).forEach((glint, area) => {
      if (glint.cells.length > 0)
        count += writeGlintArea(buffers, count, { cells: glint.cells, cellsX, groundHeight, spritesPerArea }, area);
    });
    geometry.instanceCount = count;
    offsetAttribute.needsUpdate = true;
    paramAttribute.needsUpdate = true;
  };

  const update = (glints: readonly CinematicGlint[] | undefined, time: number) => {
    const current = glints ?? [];
    if (!unchanged(current)) rebuild(current);
    // While warming, the empty layer is drawn (zero instances: the program compiles, nothing is drawn).
    mesh.visible = geometry.instanceCount > 0 || warming;
    if (mesh.visible) material.uniforms.uTime!.value = time;
  };

  return {
    dispose: () => {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
    mesh,
    setWarming: (on: boolean) => { warming = on; },
    /** Instances drawn: sparkles plus edge dots (renderer stats; one draw call). */
    sprites: () => geometry.instanceCount,
    update
  };
};
