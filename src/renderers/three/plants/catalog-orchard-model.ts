import { type BufferGeometry,Group, Mesh } from "three";

import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import { catalogBotanicalEnvelope } from "../../../render-common/plants/catalog-orchard-bounds";
import { type BotanicalGraph, type BotanicalPoint,
  createCatalogOrchardGraph } from "../../../render-common/plants/catalog-orchard-graph";
import { type CatalogBotanicalMaterials,createCatalogBotanicalMaterials } from "./catalog-orchard-materials";
import { appendBotanicalBlade, appendBotanicalFan, appendBotanicalFruit, appendBotanicalTube,
  createBotanicalSurface, finishBotanicalSurface } from "./catalog-orchard-surfaces";
import { definePlantCompletionFamily, type PlantCompletionModel,
  type PlantCompletionTier } from "./plant-completion-contract";

/** Uniform horizontal fitting preserves every joint while respecting the existing canonical placement envelope. */
/** Attachment-local coordinates, baked into the palm's shared bunch surface. */
const attachmentPoint = (point: BotanicalPoint, yaw: number, anchor: BotanicalPoint): BotanicalPoint => {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return [point[0] * cos + point[2] * sin + anchor[0], point[1] + anchor[1],
    -point[0] * sin + point[2] * cos + anchor[2]];
};

const fitCanonicalEnvelope = (geometries: BufferGeometry[], graph: BotanicalGraph) => {
  const { horizontal, vertical } = catalogBotanicalEnvelope(graph);
  for (const geometry of geometries) {
    geometry.scale(horizontal, vertical, horizontal);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  }
};

export const createCatalogBotanicalModel = (pack: CatalogBotanicalMaterials, graph: BotanicalGraph,
  detail: number): PlantCompletionModel => {
  const geometries: BufferGeometry[] = [];
  let triangles = 0;
  const addSurfaces = (source: BotanicalGraph, target: Group, suffix = "",
    transform?: (geometry: BufferGeometry) => void) => {
    const wood = createBotanicalSurface(), foliage = createBotanicalSurface(), fruit = createBotanicalSurface();
    source.tubes.forEach(tube => appendBotanicalTube(tube.green ? foliage : wood, tube, detail));
    source.blades.forEach(blade => appendBotanicalBlade(foliage, blade, detail));
    source.fans.forEach(fan => appendBotanicalFan(foliage, fan, detail));
    source.fruits.forEach(item => appendBotanicalFruit(fruit, item, detail));
    for (const [name, surface] of [["wood", wood], ["foliage", foliage], ["fruit", fruit]] as const) {
      if (surface.indices.length === 0) continue;
      const geometry = finishBotanicalSurface(surface);
      transform?.(geometry);
      const mesh = new Mesh(geometry, pack.materials[name]);
      mesh.name = `catalog-botanical-${name}${suffix}`;
      mesh.castShadow = true; mesh.receiveShadow = true;
      target.add(mesh); geometries.push(geometry); triangles += surface.indices.length / 3;
    }
  };
  const root = new Group();
  addSurfaces(graph, root);
  // Date bunches stay separate attachable content, but all bunches of one palm share a single
  // mesh/draw. The bunch ranges keep them individually addressable for a future harvest feature.
  if (graph.attachments.length > 0) {
    const surface = createBotanicalSurface();
    const bunchRanges: { bunch: number; count: number; start: number }[] = [];
    for (const [index, attachment] of graph.attachments.entries()) {
      const start = surface.indices.length;
      for (const tube of attachment.graph.tubes) {
        appendBotanicalTube(surface, {
          ...tube,
          path: tube.path.map(point => attachmentPoint(point, attachment.yaw, attachment.anchor))
        }, detail);
      }
      for (const fruit of attachment.graph.fruits) {
        appendBotanicalFruit(surface, {
          ...fruit,
          centre: attachmentPoint(fruit.centre, attachment.yaw, attachment.anchor)
        }, detail);
      }
      bunchRanges.push({ bunch: index, count: surface.indices.length - start, start });
    }
    const geometry = finishBotanicalSurface(surface);
    const mesh = new Mesh(geometry, pack.materials.fruit);
    mesh.name = "catalog-botanical-date-bunches";
    mesh.userData.bunchRanges = bunchRanges;
    mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh); geometries.push(geometry); triangles += surface.indices.length / 3;
  }
  fitCanonicalEnvelope(geometries, graph);
  let disposed = false;
  return { root, triangles, dispose: () => {
    if (disposed) return;
    disposed = true;
    geometries.forEach(geometry => geometry.dispose());
    root.clear();
  } };
};

export const orchardCompletionAdapter = definePlantCompletionFamily({
  id: "catalog-orchard",
  species: ["olive-standard", "orange-standard", "acacia-standard", "italian-stone-pine"] as const,
  createMaterials: createCatalogBotanicalMaterials,
  createModel: (pack: CatalogBotanicalMaterials, asset: PlantDecorationAsset, detailed: boolean,
    tier: PlantCompletionTier) => {
    let detail = detailed ? 2 : 1;
    if (tier === "far") detail = 0;
    return createCatalogBotanicalModel(pack, createCatalogOrchardGraph(asset.species, asset.variant, detail, asset.form === "standalone"), detail);
  }
});
