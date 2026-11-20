import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, type MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace
} from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { sinHash2 } from "../../../shared/world/noise";
import type { HostileCatapultVariant } from "../../../shared/world/scenario-catapult";

const colours = {
  bandit: { stone: 0xc2ae88, wood: 0x9d6233, planks: 0xb67b40, iron: 0x514b43,
    rope: 0xe2c18b, paint: 0xffffff, cloth: 0xa63427 },
  pirate: { stone: 0xb9b8a4, wood: 0xac7444, planks: 0xd0a76c, iron: 0x436c72,
    rope: 0xe8c78c, paint: 0xffffff, cloth: 0x225c69 }
};

/** Original grained salvage timber, uneven mortar and hammered metal, independent of camp maps. */
const surfaceMaps = (surface: string, detailed: boolean) => {
  const size = detailed ? 256 : 128;
  const pixels = new Uint8Array(size * size * 4), heights = new Uint8Array(pixels.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, noise = sinHash2(x, y);
    let shade = .90 + (noise - .5) * .065;
    if (surface === "stone") {
      const row = Math.floor(v * 5), px = u * 4 + (row % 2) * .5;
      const jointX = px % 1, jointY = v * 5 % 1;
      const edge = Math.min(jointX, 1 - jointX, jointY, 1 - jointY);
      shade *= .83 + sinHash2(Math.floor(px), row) * .17;
      if (edge < .025) shade *= .56;
      else if (edge < .05) shade *= .85;
      shade -= Math.pow(noise, 14) * .09;
    } else if (["wood", "planks", "paint"].includes(surface)) {
      const grain = u * 31 + Math.sin(v * 12 + u * 3) * .25;
      shade -= Math.pow(.5 + .5 * Math.sin(grain * Math.PI * 2), 12) * .17;
      const knot = Math.hypot((u - .36) * 1.8, (v - .59) * .72);
      if (knot < .13) shade -= (.5 + .5 * Math.cos(knot * 180)) * .13;
      if (surface === "planks" && u * 6 % 1 < .025) shade *= .63;
    } else if (["cloth", "rope"].includes(surface)) {
      shade += Math.cos(x * Math.PI) * .025 + Math.cos(y * Math.PI) * .025;
      if (surface === "rope") shade -= (.5 + .5 * Math.sin((u * 12 + v * 5) * Math.PI * 2)) * .12;
    } else if (surface === "iron") shade -= Math.pow(noise, 5) * .15;
    const value = Math.round(Math.max(0, Math.min(1, shade)) * 255), index = (y * size + x) * 4;
    pixels.set([value, value, value, 255], index); heights.set([value, value, value, 255], index);
  }
  const map = new DataTexture(pixels, size, size), bump = new DataTexture(heights, size, size);
  map.colorSpace = SRGBColorSpace;
  for (const texture of [map, bump]) {
    texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.wrapS = texture.wrapT = RepeatWrapping; texture.needsUpdate = true;
  }
  return [map, bump] as const;
};

type Materials = Record<BuildingSurface, MeshStandardMaterial>;
const pools = new WeakMap<Materials, Map<string, ReturnType<typeof makePack>>>();
const makePack = (base: Materials, variant: HostileCatapultVariant, detailed: boolean) => {
  const materials = { ...base }, owned: MeshStandardMaterial[] = [], maps: DataTexture[] = [];
  for (const [key, colour] of Object.entries(colours[variant])) {
    const surface = key as keyof typeof colours.bandit, material = base[surface].clone();
    const [map, bump] = surfaceMaps(surface, detailed); maps.push(map, bump);
    material.color.setHex(colour); material.map = map; material.normalMap = null;
    material.roughnessMap = null; material.bumpMap = detailed ? bump : null; material.bumpScale = .012;
    material.roughness = surface === "iron" ? .73 : .92;
    material.metalness = surface === "iron" ? .45 : 0;
    materials[surface] = material; owned.push(material);
  }
  return { materials, users: 0, dispose: () => {
    owned.forEach(material => material.dispose()); maps.forEach(map => map.dispose());
  } };
};

/** Models borrow one owner per existing theme pack/variant/quality; last borrower releases all maps. */
export const borrowHostileCatapultMaterials = (base: Materials, variant: HostileCatapultVariant, detailed: boolean) => {
  let pool = pools.get(base);
  if (!pool) { pool = new Map(); pools.set(base, pool); }
  const key = `${variant}:${detailed}`, pack = pool.get(key) ?? makePack(base, variant, detailed);
  pool.set(key, pack); pack.users++;
  let released = false;
  return { materials: pack.materials, release: () => {
    if (released) return;
    released = true;
    if (--pack.users) return;
    pool.delete(key); pack.dispose();
  } };
};
