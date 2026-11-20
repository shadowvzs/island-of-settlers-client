import { type BufferGeometry, type MeshStandardMaterial } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { ownBuildingMaterial } from "./building-material-ownership";
import { dataTexture } from "./viking-statue-textures";

export const isCatapultEntryAxe = (part: BuildingPart) =>
  part.shape === "bearded-axe-head" && part.catapultWallOrnament === true;

/** Profile UVs stay attached to the blade when the two complete axes are crossed/mirrored. */
export const applyCatapultAxeMetalUv = (geometry: BufferGeometry, part: BuildingPart) => {
  if (!isCatapultEntryAxe(part)) return;
  const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  for (let index = 0; index < position.count; index++)
    uv.setXY(index, position.getX(index) + .5, position.getY(index) + .5);
};

/** Subtle forge hammering and lengthwise grinding; the curved cutting edge is freshly polished. */
const paintForgedAxeMaps = (size: number) => {
  const albedo = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4), heights = new Float32Array(size * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const u = column / (size - 1), v = row / (size - 1), index = (row * size + column) * 4;
    const edge = .985 - (1 - v) * .145;
    const polish = Math.max(0, Math.min(1, (u - edge + .075) / .028));
    const hammer = Math.sin(u * 67 + Math.sin(v * 39) * 2.4) * Math.cos(v * 57 + Math.sin(u * 43));
    const grain = Math.sin(v * 650 + Math.sin(u * 27) * 3) * .5 + Math.sin(v * 237 + u * 31) * .5;
    const tone = 145 + hammer * 5 + grain * 2 + polish * 60;
    albedo.set([tone * .94, tone * .98, tone, 255], index);
    const rough = 165 - polish * 112 + hammer * 4;
    roughness.set([rough, rough, rough, 255], index);
    heights[row * size + column] = hammer * .025 * (1 - polish * .75) + grain * .006;
  }
  const at = (x: number, y: number) => heights[Math.max(0, Math.min(size - 1, y)) * size +
    Math.max(0, Math.min(size - 1, x))]!;
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const dx = (at(column - 1, row) - at(column + 1, row)) * 2;
    const dy = (at(column, row - 1) - at(column, row + 1)) * 2;
    const length = Math.hypot(dx, dy, 1);
    normal.set([127.5 + dx / length * 127.5, 127.5 + dy / length * 127.5,
      127.5 + 127.5 / length, 255], (row * size + column) * 4);
  }
  return { albedo: dataTexture(albedo, size, true), normal: dataTexture(normal, size, false),
    roughness: dataTexture(roughness, size, false) };
};

const packs = new Map<boolean, { maps: ReturnType<typeof paintForgedAxeMaps>; users: number }>();
export const createCatapultAxeMetalMaterial = (source: MeshStandardMaterial, detailed: boolean) => {
  let pack = packs.get(detailed);
  if (!pack) { pack = { maps: paintForgedAxeMaps(detailed ? 256 : 128), users: 0 }; packs.set(detailed, pack); }
  pack.users++;
  const material = source.clone();
  material.color.setRGB(1, 1, 1); material.vertexColors = false; material.map = pack.maps.albedo;
  material.normalMap = pack.maps.normal; material.normalScale.set(.18, .18);
  material.roughnessMap = pack.maps.roughness; material.roughness = 1;
  material.metalness = .52; material.metalnessMap = null; material.bumpMap = null;
  ownBuildingMaterial(material, source, true);
  const held = pack;
  const release = () => {
    material.removeEventListener("dispose", release);
    if (--held.users === 0 && packs.get(detailed) === held) packs.delete(detailed);
  };
  material.addEventListener("dispose", release);
  return material;
};
