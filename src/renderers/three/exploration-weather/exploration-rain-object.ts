/**
 * Three.js objects for the bounded FPS rain volume and its splash/ripple pools. Each object owns
 * one reused position/instance buffer, one geometry and its materials; nothing is allocated per
 * drop or per frame. Depth testing against the already-rendered scene supplies occlusion rejection
 * without any per-drop raycast or depth read-back.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
  type WebGLRenderer
} from "three";

import type { ExplorationRainFieldSample } from "./exploration-rain-model";
import { createCrownSplashGeometry, createRippleGeometry } from "./exploration-splash-geometry";
import type { ExplorationSplash, ExplorationSplashFieldSample } from "./exploration-splash-model";

/** Preserve the caller's autoClear state: 01G renders FPS effects after the main scene. */
const renderDependent = (renderer: WebGLRenderer, scene: Scene, camera: Camera) => {
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.render(scene, camera);
  renderer.autoClear = autoClear;
};

export interface ExplorationRainObjectOptions {
  capacity: number;
}

export interface ExplorationRainObjectStats {
  capacity: number;
  disposed: boolean;
  drawn: number;
  geometries: number;
  materials: number;
  renderTargets: number;
  textures: number;
}

export interface ExplorationRainObject {
  dispose: () => void;
  render: (renderer: WebGLRenderer, camera: Camera) => void;
  setVisible: (visible: boolean) => void;
  stats: () => ExplorationRainObjectStats;
  update: (sample: ExplorationRainFieldSample) => void;
}

/**
 * One LineSegments draw for the whole rain volume. The material is depth-tested against the scene
 * drawn earlier in the frame, so rain behind terrain, buildings and the explorer's own body is
 * rejected by the GPU depth buffer rather than a CPU occlusion loop.
 */
export const createExplorationRainObject = (
  options: ExplorationRainObjectOptions
): ExplorationRainObject => {
  const capacity = Math.max(0, Math.floor(options.capacity));
  const positions = new Float32Array(capacity * 2 * 3);
  const geometry = new BufferGeometry();
  const attribute = new BufferAttribute(positions, 3);
  attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", attribute);
  geometry.setDrawRange(0, 0);
  const material = new LineBasicMaterial({
    color: 0xb9d4ee,
    depthTest: true,
    depthWrite: false,
    fog: false,
    opacity: 0.5,
    transparent: true
  });
  const mesh = new LineSegments(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = "exploration-rain-volume";
  mesh.renderOrder = 9;
  const scene = new Scene().add(mesh);
  const root = new Group();
  root.name = "exploration-rain";
  root.visible = false;
  let drawn = 0;
  let disposed = false;

  const update = (sample: ExplorationRainFieldSample) => {
    if (disposed) return;
    let offset = 0;
    if (sample.active) {
      for (const drop of sample.drops) {
        if (!drop.visible) continue;
        positions[offset++] = drop.x;
        positions[offset++] = drop.y;
        positions[offset++] = drop.z;
        positions[offset++] = drop.tailX;
        positions[offset++] = drop.tailY;
        positions[offset++] = drop.tailZ;
      }
      drawn = offset / 6;
    } else {
      drawn = 0;
    }
    geometry.setDrawRange(0, drawn * 2);
    attribute.needsUpdate = drawn > 0;
    const snow = Math.min(1, Math.max(0, sample.snowShare));
    material.color.setRGB(0.725 + snow * 0.225, 0.831 + snow * 0.139, 0.933 + snow * 0.067);
    material.opacity = (0.34 + Math.min(1, sample.intensity) * 0.3) * (1 - snow * .25);
    root.visible = drawn > 0;
    mesh.visible = root.visible;
  };

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      root.visible = false;
      mesh.visible = false;
      drawn = 0;
      geometry.setDrawRange(0, 0);
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
      scene.clear();
      root.clear();
      root.removeFromParent();
    },
    render: (renderer, camera) => {
      if (disposed || !root.visible || drawn === 0) return;
      renderDependent(renderer, scene, camera);
    },
    setVisible: (visible) => {
      root.visible = visible && drawn > 0;
      mesh.visible = root.visible;
    },
    stats: () => ({
      capacity,
      disposed,
      drawn,
      geometries: disposed ? 0 : 1,
      materials: disposed ? 0 : 1,
      renderTargets: 0,
      textures: 0
    }),
    update
  };
};

export interface ExplorationSplashObjectOptions {
  rippleCapacity: number;
  splashCapacity: number;
}

export interface ExplorationSplashObjectStats {
  disposed: boolean;
  geometries: number;
  materials: number;
  renderTargets: number;
  ripples: number;
  splashes: number;
  textures: number;
}

export interface ExplorationSplashObject {
  dispose: () => void;
  render: (renderer: WebGLRenderer, camera: Camera) => void;
  stats: () => ExplorationSplashObjectStats;
  update: (sample: ExplorationSplashFieldSample) => void;
}

const createPool = (
  capacity: number,
  color: number,
  geometry: BufferGeometry,
  dummy: Matrix4
) => {
  const material = new MeshBasicMaterial({
    blending: AdditiveBlending,
    color: 0xffffff,
    depthTest: true,
    depthWrite: false,
    opacity: 0.55,
    side: DoubleSide,
    transparent: true
  });
  const mesh = new InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.frustumCulled = false;
  mesh.visible = capacity > 0;
  mesh.count = Math.max(1, capacity);
  mesh.name = "exploration-splash-pool";
  mesh.renderOrder = 8;
  const hidden = new Color(0, 0, 0);
  for (let index = 0; index < Math.max(1, capacity); index++) {
    dummy.makeScale(0, 0, 0);
    mesh.setMatrixAt(index, dummy);
    mesh.setColorAt(index, hidden);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { color: new Color(color), geometry, material, mesh };
};

/**
 * Two instanced pools: tiny, very short crowns of droplet streaks and small, brief broken ripple
 * rings (open water only). Every impact is yawed and squashed at random and fades through its
 * instance colour (additive blending); hidden instances use a zero scale, so nothing is allocated.
 */
export const createExplorationSplashObject = (
  options: ExplorationSplashObjectOptions
): ExplorationSplashObject => {
  const splashCapacity = Math.max(0, Math.floor(options.splashCapacity));
  const rippleCapacity = Math.max(0, Math.floor(options.rippleCapacity));
  const scene = new Scene();
  const dummyMatrix = new Matrix4();
  const poolPosition = new Vector3();
  const poolScale = new Vector3();
  const poolRotation = new Quaternion();
  const poolColor = new Color();
  const up = new Vector3(0, 1, 0);
  const splashPool = createPool(splashCapacity, 0xd7eaff, createCrownSplashGeometry(0x5c1a), dummyMatrix);
  const ripplePool = createPool(rippleCapacity, 0x7fb4d8, createRippleGeometry(0x71b0), dummyMatrix);
  scene.add(splashPool.mesh, ripplePool.mesh);
  const root = new Group();
  root.name = "exploration-splashes";
  root.visible = false;
  let disposed = false;
  let visibleSplashes = 0;
  let visibleRipples = 0;

  const writeImpact = (pool: ReturnType<typeof createPool>, index: number, splash: ExplorationSplash) => {
    poolPosition.set(splash.x, splash.y, splash.z);
    poolRotation.setFromAxisAngle(up, splash.angle);
    poolScale.set(splash.scale * splash.stretch, splash.scale, splash.scale / splash.stretch);
    dummyMatrix.compose(poolPosition, poolRotation, poolScale);
    pool.mesh.setMatrixAt(index, dummyMatrix);
    pool.mesh.setColorAt(index, poolColor.copy(pool.color).multiplyScalar(splash.fade));
  };

  const writePool = (pool: ReturnType<typeof createPool>, splashes: readonly ExplorationSplash[],
    capacity: number) => {
    let visible = 0;
    for (let index = 0; index < Math.max(1, capacity); index++) {
      const splash = splashes[index];
      if (splash?.active && capacity > 0) {
        writeImpact(pool, index, splash);
        visible++;
      } else {
        dummyMatrix.makeScale(0, 0, 0);
        pool.mesh.setMatrixAt(index, dummyMatrix);
      }
    }
    pool.mesh.instanceMatrix.needsUpdate = true;
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    pool.mesh.visible = visible > 0;
    return visible;
  };

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      visibleSplashes = 0;
      visibleRipples = 0;
      root.visible = false;
      splashPool.mesh.removeFromParent();
      ripplePool.mesh.removeFromParent();
      splashPool.material.dispose();
      ripplePool.material.dispose();
      splashPool.geometry.dispose();
      ripplePool.geometry.dispose();
      scene.clear();
      root.clear();
      root.removeFromParent();
    },
    render: (renderer, camera) => {
      if (disposed || !root.visible) return;
      renderDependent(renderer, scene, camera);
    },
    stats: () => ({
      disposed,
      geometries: disposed ? 0 : 2,
      materials: disposed ? 0 : 2,
      renderTargets: 0,
      ripples: visibleRipples,
      splashes: visibleSplashes,
      textures: 0
    }),
    update: (sample) => {
      if (disposed) return;
      visibleSplashes = writePool(splashPool, sample.splashes, splashCapacity);
      visibleRipples = writePool(ripplePool, sample.ripples, rippleCapacity);
      root.visible = sample.active && visibleSplashes + visibleRipples > 0;
    }
  };
};
