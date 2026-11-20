/**
 * Reused bolt geometry and one optional non-shadow point light. A strike rewrites the preallocated
 * position buffer; there is no per-strike geometry allocation and no shadow-map render. The addi-
 * tive bolt is depth-tested against the scene, and the point light (when the tier budgets it) never
 * casts a shadow.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
  type Object3D,
  PointLight,
  Scene,
  type WebGLRenderer
} from "three";

import type {
  ExplorationLightningFrame,
  ExplorationLightningStrike
} from "./exploration-lightning-model";
import { createPresentationRandom, mixPresentationSeed } from "./presentation-random";

export interface ExplorationLightningObjectOptions {
  /** Main scene root; only the optional world light is attached here. */
  parent?: Object3D | null;
  /** Maximum vertices written by one bolt (profile cap). */
  segments: number;
  seed?: number;
  worldLight: boolean;
}

export interface ExplorationLightningObjectStats {
  disposed: boolean;
  drawnPairs: number;
  geometries: number;
  lights: number;
  materials: number;
  renderTargets: number;
  segments: number;
  worldLight: boolean;
}

export interface ExplorationLightningObject {
  dispose: () => void;
  render: (renderer: WebGLRenderer, camera: Camera) => void;
  stats: () => ExplorationLightningObjectStats;
  update: (frame: ExplorationLightningFrame) => void;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const renderDependent = (renderer: WebGLRenderer, scene: Scene, camera: Camera) => {
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.render(scene, camera);
  renderer.autoClear = autoClear;
};

export const createExplorationLightningObject = (
  options: ExplorationLightningObjectOptions
): ExplorationLightningObject => {
  const maxVertices = Math.max(0, Math.floor(options.segments));
  const maxPairs = Math.floor(maxVertices / 2);
  const positions = new Float32Array(maxVertices * 3);
  const geometry = new BufferGeometry();
  const attribute = new BufferAttribute(positions, 3);
  attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", attribute);
  geometry.setDrawRange(0, 0);
  const coreMaterial = new LineBasicMaterial({
    blending: AdditiveBlending,
    color: 0xe8f4ff,
    depthTest: true,
    depthWrite: false,
    fog: false,
    opacity: 0,
    transparent: true
  });
  const glowMaterial = new LineBasicMaterial({
    blending: AdditiveBlending,
    color: 0x6ea9ff,
    depthTest: true,
    depthWrite: false,
    fog: false,
    opacity: 0,
    transparent: true
  });
  const core = new LineSegments(geometry, coreMaterial);
  const glow = new LineSegments(geometry, glowMaterial);
  core.frustumCulled = glow.frustumCulled = false;
  core.renderOrder = glow.renderOrder = 10;
  const scene = new Scene().add(glow, core);
  const worldLight = options.worldLight
    ? new PointLight(0xbfd8ff, 0, 48, 2)
    : null;
  if (worldLight) {
    worldLight.name = "exploration-lightning-world-light";
    worldLight.castShadow = false;
    options.parent?.add(worldLight);
  }
  let disposed = false;
  let drawnPairs = 0;
  let lastStrikeId = 0;
  let hasStrike = false;
  let lastFlash = 0;

  const writeSegment = (offset: number, ax: number, ay: number, az: number,
    bx: number, by: number, bz: number) => {
    positions[offset] = ax;
    positions[offset + 1] = ay;
    positions[offset + 2] = az;
    positions[offset + 3] = bx;
    positions[offset + 4] = by;
    positions[offset + 5] = bz;
    return offset + 6;
  };

  const build = (strike: ExplorationLightningStrike) => {
    if (maxPairs === 0) {
      drawnPairs = 0;
      geometry.setDrawRange(0, 0);
      return;
    }
    const random = createPresentationRandom(
      mixPresentationSeed(options.seed ?? strike.seed, strike.seed)
    );
    const topY = strike.y + 8;
    const height = 32;
    const mainPoints = Math.min(20, Math.floor(maxPairs * 0.6));
    let offset = 0;
    let pairs = 0;
    let previousX = strike.x;
    let previousY = topY;
    let previousZ = strike.z;
    for (let index = 1; index < mainPoints && pairs < maxPairs; index++) {
      const t = index / Math.max(1, mainPoints - 1);
      const x = strike.x + (random() - 0.5) * (1.5 - t * 1.1);
      const y = topY - t * height;
      const z = strike.z + (random() - 0.5) * (0.8 - t * 0.5);
      offset = writeSegment(offset, previousX, previousY, previousZ, x, y, z);
      previousX = x;
      previousY = y;
      previousZ = z;
      pairs++;
    }
    for (const [rootFraction, branches] of [[0.24, 4], [0.46, 4], [0.64, 3]] as const) {
      let x = strike.x + (random() - 0.5) * 0.6;
      let y = topY - height * rootFraction;
      let z = strike.z + (random() - 0.5) * 0.4;
      const angle = random() * Math.PI * 2;
      for (let step = 0; step < branches && pairs < maxPairs; step++) {
        const nx = x + Math.cos(angle) * (0.55 + random() * 0.55);
        const ny = Math.max(topY - height * 0.86, y - 0.8 - random() * 0.7);
        const nz = z + Math.sin(angle) * (0.55 + random() * 0.55);
        offset = writeSegment(offset, x, y, z, nx, ny, nz);
        x = nx;
        y = ny;
        z = nz;
        pairs++;
      }
    }
    drawnPairs = pairs;
    geometry.setDrawRange(0, pairs * 2);
    attribute.needsUpdate = pairs > 0;
    if (worldLight) worldLight.position.set(strike.x, strike.y - 8, strike.z);
  };

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      drawnPairs = 0;
      lastFlash = 0;
      geometry.setDrawRange(0, 0);
      geometry.dispose();
      coreMaterial.dispose();
      glowMaterial.dispose();
      core.removeFromParent();
      glow.removeFromParent();
      scene.clear();
      worldLight?.removeFromParent();
    },
    render: (renderer, camera) => {
      if (disposed || !hasStrike || lastFlash <= 0.001) return;
      renderDependent(renderer, scene, camera);
    },
    stats: () => ({
      disposed,
      drawnPairs: disposed ? 0 : drawnPairs,
      geometries: disposed ? 0 : 1,
      lights: disposed || !worldLight ? 0 : 1,
      materials: disposed ? 0 : 2,
      renderTargets: 0,
      segments: maxVertices,
      worldLight: Boolean(worldLight)
    }),
    update: (frame) => {
      if (disposed) return;
      if (frame.strike && frame.strike.id !== lastStrikeId) {
        lastStrikeId = frame.strike.id;
        hasStrike = true;
        build(frame.strike);
      }
      lastFlash = clamp01(frame.flash);
      coreMaterial.opacity = lastFlash;
      glowMaterial.opacity = lastFlash * 0.28;
      if (worldLight) worldLight.intensity = clamp01(frame.worldLight) * 22;
    }
  };
};
