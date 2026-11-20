import { LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RepeatWrapping, SphereGeometry,
  SRGBColorSpace } from "three";

import { catapultAmmoColor } from "../../../render-common/buildings/catapult-ammo-colors";
import { textureFromPixels } from "./catapult-rock-geometry";

/**
 * CAT-6 marble round shot (owner 2026-11-08): a smooth polished sphere with grey veining, so its spin
 * reads while it rolls. Unit diameter; High is a fine sphere, Minimal a cheap low-segment one.
 */
const TWO_PI = Math.PI * 2;
const SEGMENTS = { detailed: [32, 20], minimal: [12, 8] } as const;
const BASE_SHADE = 150;
const MAIN_VEIN = { darken: 62, width: .12 };
const FINE_VEIN = { darken: 34, width: .06 };

/** Smooth wandering offset, periodic in u so the seam of the sphere's wrap stays invisible. */
const veinWarp = (u: number, v: number) =>
  .9 * Math.sin(TWO_PI * u * 3 + v * 7.1) + .55 * Math.sin(TWO_PI * u * 5 - v * 11.3 + 1.7) +
  .3 * Math.sin(TWO_PI * u * 9 + v * 19 + .4);

/** 1 on a vein's centre line, falling to 0 at `width`. */
const veinStrength = (phase: number, width: number) => Math.max(0, 1 - Math.abs(Math.sin(phase)) / width);

const pixelGrain = (x: number, y: number) => {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const marbleShade = (x: number, y: number, size: number) => {
  const u = x / size, v = y / size, warp = veinWarp(u, v);
  const main = veinStrength(TWO_PI * u * 2 + v * Math.PI * 4 + warp * 1.6, MAIN_VEIN.width);
  const fine = veinStrength(TWO_PI * u * 4 - v * Math.PI * 9 + warp * 2.4, FINE_VEIN.width);
  return BASE_SHADE + (pixelGrain(x, y) - .5) * 8 - main * MAIN_VEIN.darken - fine * FINE_VEIN.darken;
};

const createMarbleTexture = (detailed: boolean) => {
  const size = detailed ? 128 : 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const shade = marbleShade(x, y, size);
    pixels.set([shade, shade * .99, shade * .96, 255], (y * size + x) * 4);
  }
  const map = textureFromPixels(pixels, size);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
};

export const createMarbleShotGeometry = (detailed: boolean) => {
  const [width, height] = detailed ? SEGMENTS.detailed : SEGMENTS.minimal;
  return new SphereGeometry(.5, width, height);
};

/** Polished stone keeps the shared marble shot tint (CAT-3), multiplied onto its veined texture. */
export const createMarbleShotMaterial = (detailed: boolean) => {
  const tint = catapultAmmoColor("marble")!;
  const material = new MeshStandardMaterial({ map: createMarbleTexture(detailed), metalness: 0,
    roughness: detailed ? .24 : .36 });
  material.color.setRGB(tint[0]!, tint[1]!, tint[2]!);
  return material;
};

/**
 * One geometry and one material shared by every marble shot of an owner (projectiles, rack, cup,
 * porter). Its meshes are flagged as kit-owned: never re-tinted or disposed one by one.
 */
export const createMarbleShotKit = (detailed: boolean) => {
  const geometry = createMarbleShotGeometry(detailed), material = createMarbleShotMaterial(detailed);
  const create = (diameter: number) => {
    const mesh = new Mesh(geometry, material);
    mesh.name = "catapult_marble_shot";
    mesh.scale.setScalar(diameter);
    mesh.castShadow = detailed;
    mesh.userData.catapultBundle = true;
    return mesh;
  };
  const dispose = () => { geometry.dispose(); material.map?.dispose(); material.dispose(); };
  return { create, dispose };
};
