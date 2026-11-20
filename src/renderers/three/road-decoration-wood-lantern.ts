import { DataTexture, MeshStandardMaterial, RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";

import type { BuildingSurface } from "../../render-common/buildings/building-recipe";
import { createWoodenRoadLanternRecipe } from "../../render-common/road-decoration-wood-lanterns";
import { createRoadDecorationModel } from "./road-decoration-model";

/** Paper has its own neutral fibre surface: a nation's coloured clothing atlas is not lantern paper. */
export const createWoodenRoadLanternModel = (nation: "japanese" | "chinese", detailed: boolean,
  materials: Record<BuildingSurface, MeshStandardMaterial>) => {
  let paper: MeshStandardMaterial | undefined, texture: DataTexture | undefined;
  if (nation === "japanese") {
    const size = detailed ? 64 : 32, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fibre = (x * 17 + Math.floor(y / 9) * 13) % 29 < 2;
      const cross = y % 13 === 0 && x % 7 < 5;
      const shade = 249 - (fibre ? 10 : 0) - (cross ? 5 : 0), index = (y * size + x) * 4;
      pixels.set([shade, shade - 1, shade - 4, 255], index);
    }
    texture = new DataTexture(pixels, size, size, RGBAFormat);
    texture.colorSpace = SRGBColorSpace; texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.needsUpdate = true;
    paper = new MeshStandardMaterial({ map: texture, vertexColors: true, roughness: .94 });
    if (detailed) { paper.bumpMap = texture; paper.bumpScale = .001; }
  }
  const model = createRoadDecorationModel(createWoodenRoadLanternRecipe(nation, detailed),
    { ...materials, cloth: paper ?? materials.cloth }, detailed);
  let disposed = false;
  return { root: model.root, triangles: model.triangles, dispose: () => {
    if (disposed) return;
    disposed = true; model.dispose(); paper?.dispose(); texture?.dispose();
    if (texture) texture.image.data = null;
  } };
};
