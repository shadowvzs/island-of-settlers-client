import { DoubleSide, type MeshStandardMaterial } from "three";

import { ownBuildingMaterial } from "./building-material-ownership";
import { dataTexture, segmentDistance } from "./viking-statue-textures";

const VEINS: [number, number, number, number][] = [[0, -.29, 0, .47],
  [0, -.26, -.44, .09], [0, -.26, .44, .09], [0, -.27, -.27, -.28], [0, -.27, .27, -.28]];
const FINE_VEINS: [number, number, number, number][] = VEINS.flatMap(([x, y, ex, ey], axis) => {
  const dx = ex - x, dy = ey - y, length = Math.hypot(dx, dy), branches: typeof VEINS = [];
  for (let branch = 1; branch <= 5; branch++) for (const side of [-1, 1]) {
    const t = branch / 6, reach = (1 - t * .52) * (axis === 0 ? .15 : .085);
    const bx = x + dx * t, by = y + dy * t;
    const tx = bx + dx * .10 + side * dy / length * reach;
    const ty = by + dy * .10 - side * dx / length * reach;
    branches.push([bx, by, tx, ty]);
    // Short tertiary branches make the relief read as a network, even at oblique angles.
    branches.push([bx * .3 + tx * .7, by * .3 + ty * .7,
      tx + dx * .065, ty + dy * .065]);
  }
  return branches;
});
const nearestVein = (x: number, y: number, segments: typeof VEINS) => {
  let nearest = Infinity;
  for (const segment of segments) nearest = Math.min(nearest, segmentDistance(x, y, segment));
  return nearest;
};
/** Original evergreen ivy atlas: leather-green shallow lobes, branching pale veins and brown stem strip. */
export const paintCatapultIvyMaps = (size: number) => {
  const albedo = new Uint8Array(size * size * 4), heights = new Float32Array(size * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const u = (column + .5) / size, v = (row + .5) / size, index = (row * size + column) * 4;
    if (u < .11) {
      const grain = .5 + Math.sin(column * .83 + Math.sin(v * 19) * 2) * .13;
      albedo.set([67 + grain * 29, 53 + grain * 20, 30 + grain * 12, 255], index);
      heights[row * size + column] = grain * .1;
      continue;
    }
    const x = (u - .15) / .85 - .5, y = v - .5;
    const distance = nearestVein(x, y, VEINS);
    const vein = Math.max(0, 1 - distance / .007);
    const fineDistance = nearestVein(x, y, FINE_VEINS);
    const secondary = Math.max(0, 1 - fineDistance / .0028);
    const fine = .5 + Math.sin(x * 139 + y * 73) * Math.sin(y * 97 - x * 33) * .5;
    const tone = .5 + y * .22 + Math.sin(x * 23 + y * 17) * .12 + fine * .11;
    albedo.set([35 + tone * 29 + vein * 44 + secondary * 15, 82 + tone * 59 + vein * 43 + secondary * 18,
      24 + tone * 20 + vein * 29 + secondary * 10, 255], index);
    heights[row * size + column] = .22 + vein * .22 + secondary * .065 + fine * .024;
  }
  const normal = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const at = (x: number, y: number) => heights[Math.max(0, Math.min(size - 1, y)) * size +
      Math.max(0, Math.min(size - 1, x))]!;
    const dx = (at(column - 1, row) - at(column + 1, row)) * 2;
    const dy = (at(column, row - 1) - at(column, row + 1)) * 2;
    const length = Math.hypot(dx, dy, 1), index = (row * size + column) * 4;
    normal.set([127.5 + dx / length * 127.5, 127.5 + dy / length * 127.5, 127.5 + 127.5 / length, 255], index);
  }
  return { albedo: dataTexture(albedo, size, true), normal: dataTexture(normal, size, false) };
};

const packs = new Map<boolean, { maps: ReturnType<typeof paintCatapultIvyMaps>; users: number }>();
export const createCatapultIvyMaterial = (source: MeshStandardMaterial, detailed: boolean) => {
  let pack = packs.get(detailed);
  if (!pack) { pack = { maps: paintCatapultIvyMaps(detailed ? 512 : 256), users: 0 }; packs.set(detailed, pack); }
  pack.users++;
  const material = source.clone();
  material.color.setRGB(1, 1, 1); material.map = pack.maps.albedo;
  material.normalMap = pack.maps.normal; material.bumpMap = null;
  material.alphaMap = null; material.alphaTest = 0; material.transparent = false; material.side = DoubleSide;
  material.roughness = .64; material.metalness = 0; material.roughnessMap = null; material.metalnessMap = null;
  ownBuildingMaterial(material, source, true);
  const held = pack;
  const release = () => {
    material.removeEventListener("dispose", release);
    if (--held.users === 0 && packs.get(detailed) === held) packs.delete(detailed);
  };
  material.addEventListener("dispose", release);
  return material;
};
