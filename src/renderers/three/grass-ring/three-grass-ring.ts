import {
  DataTexture,
  FloatType,
  Group,
  type IUniform,
  Mesh,
  NearestFilter,
  type PerspectiveCamera,
  RGBAFormat,
  type Vector4
} from "three";

import {
  createGrassRingGround,
  createGrassRingGroundSampler,
  fillGrassRingGround,
  type GrassRingGround,
  invalidateGrassRingGround
} from "../../../render-common/grass/grass-ring-ground";
import {
  createGrassRingPatch,
  createGrassRingTiles,
  fillGrassRingTiles,
  getGrassRingSettings,
  getGrassRingTileReach,
  getGrassRingWindowSamples,
  GRASS_RING_PATCH_BLADES,
  GRASS_RING_TILE,
  type GrassRingLevel,
  type GrassRingSettings
} from "../../../render-common/grass/grass-ring-layout";
import { createBiomeGrassRingSampler } from "../../../render-common/props/field-cover";
import type { WorldData } from "../../../shared/world/world-data";
import { createGrassRingGeometry } from "./grass-ring-geometry";
import { createGrassRingMaterial } from "./grass-ring-material";

/** Fixed seed: the patch layout is an asset, identical on every island and every load. */
const GRASS_RING_PATCH_SEED = 0x7a11;

/** The short-grass tuft material's ring uniforms (eye/radius/blend, ring shape). */
export interface ShortGrassHole {
  hole: Vector4;
  shape: Vector4;
}

export interface GrassRingFrame {
  /** 0 hides the ring (iso view), 1 full (possessed); the approach blends it in. */
  blend: number;
  camera: PerspectiveCamera;
  eyeX: number;
  eyeZ: number;
  viewportHeight: number;
}

const createGroundTexture = (ground: GrassRingGround) => {
  const texture = new DataTexture(ground.data, ground.size, ground.size, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

const createBands = (settings: GrassRingSettings, material: ReturnType<typeof createGrassRingMaterial>) => {
  const roots = createGrassRingPatch(GRASS_RING_PATCH_BLADES, GRASS_RING_PATCH_SEED);
  const capacity = (getGrassRingTileReach(settings) * 2 + 1) ** 2;
  return settings.bands.map(band => {
    const { geometry, tiles, triangles } = createGrassRingGeometry(band, roots, capacity);
    const mesh = new Mesh(geometry, material);
    // Visible until the first update: the startup shader compile only visits visible objects.
    mesh.frustumCulled = false;
    mesh.name = `grass-ring-${band.blades}`;
    return { geometry, mesh, tiles, triangles };
  });
};

/**
 * T07 possessed near grass ring (Medium compact, High dense; off on Low/Minimal and in iso). The
 * CPU only touches the GPU when the eye enters another tile: the band tile lists (a few hundred
 * floats) and the ground window samples that entered the ring. OD-T6: `shortGrass.hole` (the
 * short-grass tuft material's uniform) gets the ring's eye, radius and blend every frame and
 * `shortGrass.shape` the ring's shape once, so those tufts give way to the ring's blades inside it
 * (grass-band: cross-fading over a wide band).
 */
export const createThreeGrassRing = (
  world: WorldData,
  uniforms: Record<string, IUniform>,
  level: GrassRingLevel,
  shortGrass: ShortGrassHole
) => {
  const settings = getGrassRingSettings(level);
  if (!settings) return null;
  const reach = getGrassRingTileReach(settings);
  const ground = createGrassRingGround(getGrassRingWindowSamples(settings));
  const sampleGround = createGrassRingGroundSampler(world);
  const sampleBiome = createBiomeGrassRingSampler(world);
  const groundTexture = createGroundTexture(ground);
  const material = createGrassRingMaterial({ ground: groundTexture, uniforms });
  const shape = material.uniforms.uRingShape!.value as Vector4;
  const biome = material.uniforms.uRingBiome!.value as Vector4;
  shape.set(settings.density, settings.fullDensity, settings.radius, settings.tuftCover);
  shortGrass.shape.copy(shape);
  const bands = createBands(settings, material);
  const tiles = createGrassRingTiles(settings);
  const root = new Group();
  root.name = "grass-ring";
  root.add(...bands.map(band => band.mesh));
  let centreX = Number.NaN, centreZ = Number.NaN;

  const uploadTiles = () => {
    bands.forEach((band, index) => {
      const count = tiles.counts[index]!;
      const array = band.tiles.array as Float32Array;
      const source = tiles.tiles[index]!;
      for (let offset = 0; offset < count * 2; offset++) array[offset] = source[offset]!;
      band.tiles.clearUpdateRanges();
      band.tiles.addUpdateRange(0, Math.max(2, count * 2));
      band.tiles.needsUpdate = true;
      band.geometry.instanceCount = count;
    });
  };

  /** Moves the ring when the eye enters another tile: tile lists and the new ground samples. */
  const moveTo = (tileX: number, tileZ: number) => {
    if (tileX === centreX && tileZ === centreZ) return;
    centreX = tileX;
    centreZ = tileZ;
    fillGrassRingTiles(settings, tileX, tileZ, tiles);
    uploadTiles();
    if (fillGrassRingGround(ground, sampleGround, tileX, tileZ, reach) > 0) groundTexture.needsUpdate = true;
  };

  const setVisible = (visible: boolean) => {
    for (const band of bands) band.mesh.visible = visible && band.geometry.instanceCount > 0;
  };

  const update = (frame: GrassRingFrame | null) => {
    if (!frame || frame.blend <= 0) {
      setVisible(false);
      shortGrass.hole.w = 0;
      return;
    }
    moveTo(Math.floor(frame.eyeX / GRASS_RING_TILE), Math.floor(frame.eyeZ / GRASS_RING_TILE));
    const pixelWorld = 2 * Math.tan((frame.camera.fov * Math.PI) / 360) / Math.max(1, frame.viewportHeight);
    const blend = Math.min(1, frame.blend);
    material.uniforms.uRingEye!.value.set(frame.eyeX, frame.eyeZ, blend, pixelWorld);
    const localBiome = sampleBiome(frame.eyeX, frame.eyeZ);
    biome.set(localBiome.heightScale, localBiome.tint[0], localBiome.tint[1], localBiome.tint[2]);
    material.uniforms.uRingSway!.value = localBiome.sway;
    shortGrass.hole.set(frame.eyeX, frame.eyeZ, settings.radius, blend);
    setVisible(true);
  };

  /** Terrain or ground edits: refill the window around the current centre on the next frame. */
  const invalidate = () => {
    invalidateGrassRingGround(ground);
    centreX = Number.NaN;
    centreZ = Number.NaN;
  };

  const dispose = () => {
    shortGrass.hole.w = 0;
    for (const band of bands) band.geometry.dispose();
    material.dispose();
    groundTexture.dispose();
  };

  return {
    dispose,
    invalidate,
    root,
    triangles: bands.reduce((sum, band) => sum + band.triangles, 0),
    update
  };
};

export type ThreeGrassRing = NonNullable<ReturnType<typeof createThreeGrassRing>>;
