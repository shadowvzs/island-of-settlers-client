import {
  BufferGeometry, Float32BufferAttribute
} from "three";

export type { WisteriaLodAtlasMetadata } from "../../render-common/wisteria-lod-layout";
export { groupWisteriaBotany, wisteriaAtlasBounds,   wisteriaRacemeTransform, wisteriaSprayFrame,
wisteriaSprayTransform } from "../../render-common/wisteria-lod-layout";

export type WisteriaLodTile = "racemeFront" | "racemeSide" | "fixedFront" | "fixedSide" | "sprayFront" | "spraySide";
export const WISTERIA_LOD_ATLAS_SIZE = 1024;
export const WISTERIA_LOD_TILES: Readonly<Record<WisteriaLodTile, readonly [number, number, number, number]>> = {
  racemeFront: [0, 0, 256, 768], racemeSide: [256, 0, 256, 768],
  fixedFront: [512, 0, 256, 768], fixedSide: [768, 0, 256, 768],
  sprayFront: [0, 768, 512, 256], spraySide: [512, 768, 512, 256]
};
/** Four triangles retain a raceme/spray's front and side mass without camera-facing CPU updates. */
export const createWisteriaCrossCard = (front: WisteriaLodTile, side: WisteriaLodTile) => {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (const [tile, sideways] of [[front, false], [side, true]] as const) {
    const [x, y, width, height] = WISTERIA_LOD_TILES[tile], first = positions.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      positions.push(sideways ? 0 : u - .5, v! - .5, sideways ? .5 - u! : 0);
      // Half-texel insets avoid neighbouring neutral/fixed-colour tiles bleeding at lower mips.
      uv.push((x + .5 + u! * (width - 1)) / WISTERIA_LOD_ATLAS_SIZE,
        1 - (y + height - .5 - v! * (height - 1)) / WISTERIA_LOD_ATLAS_SIZE);
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

