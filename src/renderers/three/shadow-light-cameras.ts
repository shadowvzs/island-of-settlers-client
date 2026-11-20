import {
  ArrayCamera,
  Matrix4,
  OrthographicCamera,
  type PerspectiveCamera,
  type Scene,
  Vector3,
  Vector4,
  type WebGLRenderer,
  type WebGLRenderTarget
} from "three";

import { getSunVector } from "../../render-common/environment";
import type { SunDirection } from "../../shared/world/world-data";
import { SHADOW_CASTER_LAYER, SHADOW_NEAR_CASTER_LAYER } from "./shadow-cascades";
import { SUN_SHADOW_DISTANCE } from "./sun-shadow-glsl";

/** The possessed eye: the cascades' common centre. */
export interface ShadowEye {
  x: number;
  y: number;
  z: number;
}

/** A texel rectangle of the atlas. */
export interface ShadowRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

const BIAS = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const origin = new Vector3();

/** Orthographic light camera aimed from the sun (or moon) at `centre`. */
const aimLightCamera = (camera: OrthographicCamera, centre: Vector3, sun: SunDirection) => {
  const [x, y, z] = getSunVector(sun);
  camera.position.set(centre.x + x * SUN_SHADOW_DISTANCE, centre.y + y * SUN_SHADOW_DISTANCE,
    centre.z + z * SUN_SHADOW_DISTANCE);
  camera.lookAt(centre);
  camera.updateMatrixWorld();
};

/** Also resets the projection every frame (the texel snap below offsets it). */
const setLightExtent = (camera: OrthographicCamera, half: number) => {
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
};

/** Moves the projection by the sub-texel offset of the world origin: no shimmer when panning. */
const snapToTexels = (camera: OrthographicCamera, mapSize: number) => {
  origin.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  const texelX = (origin.x * mapSize) / 2;
  const texelY = (origin.y * mapSize) / 2;
  camera.projectionMatrix.elements[12]! += ((Math.round(texelX) - texelX) * 2) / mapSize;
  camera.projectionMatrix.elements[13]! += ((Math.round(texelY) - texelY) * 2) / mapSize;
};

/** One light camera of the atlas: its slot viewport and world -> local uv/depth matrix. */
export interface ShadowCascadeCamera {
  camera: OrthographicCamera;
  /** Takes another cascade's fit (the far cascade freezes its view for a strip cycle). */
  copy: (source: ShadowCascadeCamera) => void;
  /** Aims at `centre` over ±`half` world units, texel-snapped for a `size`² tile. */
  fit: (centre: Vector3, half: number, sun: SunDirection, size: number) => void;
  halfExtent: number;
  index: number;
  matrix: Matrix4;
  viewport: Vector4;
}

export const createCascadeCamera = (index: number): ShadowCascadeCamera => {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, SUN_SHADOW_DISTANCE * 2);
  const viewport = new Vector4();
  // WebGLRenderer draws an ArrayCamera's sub-camera into its `viewport` (render target texels).
  Object.assign(camera, { viewport });
  const cascade: ShadowCascadeCamera = {
    camera,
    copy: source => {
      camera.position.copy(source.camera.position);
      camera.quaternion.copy(source.camera.quaternion);
      camera.updateMatrixWorld();
      camera.projectionMatrix.copy(source.camera.projectionMatrix);
      cascade.halfExtent = source.halfExtent;
      cascade.matrix.copy(source.matrix);
    },
    fit: (centre, half, sun, size) => {
      cascade.halfExtent = half;
      setLightExtent(camera, half);
      aimLightCamera(camera, centre, sun);
      snapToTexels(camera, size);
      cascade.matrix.multiplyMatrices(BIAS, camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    },
    halfExtent: 0,
    index,
    matrix: new Matrix4(),
    viewport
  };
  return cascade;
};

/** Static casters of a tile: layer 0, plus the near-only casters (plants, rubble) when detailed. */
export const setStaticLayers = (camera: OrthographicCamera, detailed: boolean) => {
  camera.layers.set(0);
  if (detailed) camera.layers.enable(SHADOW_NEAR_CASTER_LAYER);
};

/**
 * Clears `rect` and draws the static shadow scene into it with `camera` (three culls the scene to
 * that camera, so a tile only submits its own casters). Returns the draws and triangles.
 */
export const drawShadowTile = (
  renderer: WebGLRenderer,
  target: WebGLRenderTarget,
  scene: Scene,
  camera: OrthographicCamera,
  rect: ShadowRect
) => {
  target.viewport.set(rect.x, rect.y, rect.width, rect.height);
  target.scissor.copy(target.viewport);
  target.scissorTest = true;
  renderer.setRenderTarget(target);
  renderer.clear();
  target.scissorTest = false;
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
};

/**
 * The moving casters' draw over several tiles: one ArrayCamera render per caster scene, so the
 * caster subtrees are traversed (and their skeletons updated) once; every caster is culled by the
 * outermost tile and drawn into each sub-camera's tile. WebGLRenderer reads only the sub-cameras'
 * matrices, layers and viewport, so orthographic light cameras work in the perspective-typed list.
 */
export const createDynamicLightCamera = (tiles: readonly ShadowCascadeCamera[]) => {
  const array = new ArrayCamera(tiles.map(tile => tile.camera) as unknown as PerspectiveCamera[]);
  array.matrixWorldAutoUpdate = false;
  const outer = tiles[tiles.length - 1]!.camera;
  return () => {
    array.layers.set(SHADOW_CASTER_LAYER);
    for (const tile of tiles) tile.camera.layers.set(SHADOW_CASTER_LAYER);
    array.projectionMatrix.copy(outer.projectionMatrix);
    array.matrixWorld.copy(outer.matrixWorld);
    array.matrixWorldInverse.copy(outer.matrixWorldInverse);
    return array;
  };
};

/** Recent pass times (main thread, ms): mean and p95 for the profiler receipt. */
export const createShadowTiming = (capacity = 240) => {
  const samples = new Float64Array(capacity);
  let count = 0;
  let next = 0;
  return {
    add: (milliseconds: number) => {
      samples[next] = milliseconds;
      next = (next + 1) % capacity;
      count = Math.min(count + 1, capacity);
    },
    report: () => {
      if (count === 0) return { mean: 0, p95: 0 };
      const sorted = samples.slice(0, count).sort();
      let sum = 0;
      for (const sample of sorted) sum += sample;
      return { mean: sum / count, p95: sorted[Math.min(count - 1, Math.floor(count * 0.95))]! };
    },
    reset: () => {
      count = 0;
      next = 0;
    }
  };
};

/** Profiler detail text of a timing report: "mean 0.41 / p95 0.62". */
export const describeShadowTiming = ({ mean, p95 }: { mean: number; p95: number }) =>
  `mean ${mean.toFixed(2)} / p95 ${p95.toFixed(2)}`;

type ShadowFilterName = "pcf3" | "poisson12";

declare global {
  interface Window {
    /**
     * Development only (R08 A/B): `__sunShadows.filter("pcf3" | "poisson12")` switches the lookup
     * filter live (no argument reads it); `timing()` / `resetTiming()` read and restart the
     * pass's main-thread mean/p95.
     */
    __sunShadows?: {
      filter: (name?: ShadowFilterName) => ShadowFilterName;
      resetTiming: () => void;
      timing: () => { mean: number; p95: number };
    };
  }
}

/** Development console hook of the sun shadow pass; returns its remover. */
export const exposeSunShadowDevHook = (
  filterUniform: { value: Vector4 },
  timing: ReturnType<typeof createShadowTiming>
): (() => void) => {
  if (!import.meta.env.DEV || typeof window === "undefined") return () => {};
  const hook = {
    filter: (name?: ShadowFilterName) => {
      if (name) filterUniform.value.w = name === "poisson12" ? 1 : 0;
      return filterUniform.value.w > 0.5 ? "poisson12" : "pcf3";
    },
    resetTiming: timing.reset,
    timing: timing.report
  };
  window.__sunShadows = hook;
  return () => {
    if (window.__sunShadows === hook) delete window.__sunShadows;
  };
};
