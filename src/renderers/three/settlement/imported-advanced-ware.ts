import { Group, Mesh } from "three";

import { CART_CARGO_LAYOUTS } from "../../../render-common/logistics/cart-cargo-layouts";
import { ADVANCED_MATERIAL_SOURCE_DATA } from "../../../render-common/wares/advanced-material-source-data";
import { type MaterialWoodWare,woodWareAppearance } from "../../../render-common/wares/advanced-material-variants";
import { looseTimberSourceChunks } from "../../../render-common/wares/loose-timber-source";
import { timberVariantChunks } from "../../../render-common/wares/timber-variant-source";
import { acquireAdvancedMaterials, type AdvancedAssetChunk,advancedAssetGeometry } from "./advanced-material-assets";
import { minimalPlankChunks } from "./minimal-plank-chunks";

/** Source bundles fit the existing measured contacts/envelope, so warehouses/carts need no footprint change. */
export const createImportedAdvancedWare = (id: MaterialWoodWare, detailed: boolean) => {
  const appearance = woodWareAppearance(id)!;
  const kind = appearance.source;
  const source = ADVANCED_MATERIAL_SOURCE_DATA[kind], pack = acquireAdvancedMaterials(kind, detailed, id);
  const loose = timberVariantChunks(id, looseTimberSourceChunks(kind, source.chunks));
  const chunks: readonly AdvancedAssetChunk[] = !detailed && kind === "planks" ? minimalPlankChunks(loose) : loose;
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const chunk of chunks) (detailed ? chunk.position : chunk.minimalPosition ?? chunk.position)
    .forEach((value, index) => {
    const axis = index % 3;
    bounds.min[axis] = Math.min(bounds.min[axis]!, value); bounds.max[axis] = Math.max(bounds.max[axis]!, value);
  });
  const layout = CART_CARGO_LAYOUTS[appearance.base];
  const target = [layout.width / layout.scale, layout.height / layout.scale, layout.depth / layout.scale];
  const transform = (x: number, y: number, z: number) => [x, y, z].map((value, axis) =>
    (value - (bounds.min[axis]! + bounds.max[axis]!) / 2) * target[axis]! /
      (bounds.max[axis]! - bounds.min[axis]!));
  const root = new Group(); root.name = `approved_${id}`;
  for (let material = 0; material < pack.materials.length; material++) {
    const pieces = chunks.filter(chunk => chunk.material === material);
    if (!pieces.length) continue;
    const geometry = advancedAssetGeometry(pieces, detailed, transform);
    const mesh = new Mesh(geometry, pack.materials[material]);
    mesh.castShadow = detailed; mesh.receiveShadow = detailed; root.add(mesh);
  }
  root.userData.sourceAsset = source.source;
  return { root, triangles: () => root.children.reduce((total, object) =>
    total + (object as Mesh).geometry.getAttribute("position").count / 3, 0), dispose: () => {
    // The ware owner releases actual meshes after any stock merging has replaced the source hierarchy.
    pack.release(); root.removeFromParent();
  } };
};
