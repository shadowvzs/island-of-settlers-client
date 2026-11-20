import { BufferGeometry, Float32BufferAttribute, Group, Mesh, SphereGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { getRoadPlant } from "../../../../../island-of-settlers-shared/src/road-plant-catalog";
import type { PlantDecorationAsset } from "../../../../../island-of-settlers-shared/src/road-plant-items";
import {
type CatalogBonsaiSpecies,
  createCatalogBonsaiGraph} from "../../../render-common/plants/catalog-bonsai-graph";
import {
  addOrnamentalLimb, ornamentalPointBetween
} from "../../../render-common/plants/ornamental-tree-graph";
import { createBonsaiElmLeafGeometry } from "./bonsai-elm-leaf-geometry";
import { createBonsaiPotGeometries } from "./bonsai-pot-geometry";
import { createCatalogAzaleaTrumpet, createCatalogBonsaiNeedles, createCatalogJuniperSpray } from "./catalog-bonsai-foliage";
import { type CatalogBonsaiMaterials,createCatalogBonsaiMaterials } from "./catalog-bonsai-materials";
import { createOrnamentalWoodGeometry } from "./ornamental-wood-geometry";
import { definePlantCompletionFamily, type PlantCompletionTier } from "./plant-completion-contract";

type Surface = keyof CatalogBonsaiMaterials["materials"];

const completeAttributes = (geometry: BufferGeometry) => {
  const count = geometry.getAttribute("position").count;
  if (!geometry.index) geometry.setIndex(Array.from({ length: count }, (_, index) => index));
  if (!geometry.hasAttribute("color"))
    geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  if (!geometry.hasAttribute("uv"))
    geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(count * 2), 2));
};

const createModel = (pack: CatalogBonsaiMaterials, asset: PlantDecorationAsset,
  detailed: boolean, tier: PlantCompletionTier) => {
  if (asset.species === "bonsai-maple" && asset.potted)
    throw new Error("Accepted potted Elm must retain its existing model");
  const far = tier === "far", { pads, wood } = createCatalogBonsaiGraph(
    asset.species as CatalogBonsaiSpecies, asset.variant, asset.potted);
  const surfaces: Record<Surface, BufferGeometry[]> = { bark: [], ceramic: [], foliage: [], flower: [], soil: [] };
  let shoots = detailed ? 10 : 6;
  if (asset.species === "bonsai-azalea") shoots = detailed ? 6 : 5;
  if (asset.species === "bonsai-juniper") shoots = detailed ? 9 : 6;
  if (far) shoots = 3;
  pads.forEach((pad, padIndex) => {
    for (let shoot = 0; shoot < shoots; shoot++) {
      const seed = padIndex * 71 + shoot * 11 + asset.variant * 101;
      const angle = shoot * 2.399963 + padIndex * .8;
      const distance = Math.sqrt((shoot + .5) / shoots);
      const end: [number, number, number] = [
        pad.centre[0] + Math.cos(angle) * distance * pad.radius,
        pad.centre[1] + .015 + (1 - distance) * .055 + Math.sin(shoot * 2.4) * .016,
        pad.centre[2] + Math.sin(angle) * distance * pad.radius * .72
      ];
            const branchPath = wood.limbs[pad.branch]!.path;
      const bearing = branchPath[shoot % 3 === 0 ? 1 : 2]!;
      const middle = ornamentalPointBetween(bearing, end, .58); middle[1] += .009;
      const twig = addOrnamentalLimb(wood, pad.branch, [bearing, middle, end], .0045, .0015, "twig");
      if (shoot % 2 === 0 && !far) {
        const forkEnd: [number, number, number] = [end[0] + Math.cos(angle + 1.5) * .028,
          end[1] - .012, end[2] + Math.sin(angle + 1.5) * .028];
        addOrnamentalLimb(wood, twig, [middle, ornamentalPointBetween(middle, forkEnd, .6), forkEnd],
          .0028, .001, "twig");
      }
      if (asset.species === "bonsai-pine") {
        const tuftCount = far ? 1 : 3;
        for (let tuft = 0; tuft < tuftCount; tuft++) surfaces.foliage.push(createCatalogBonsaiNeedles(
          ornamentalPointBetween(middle, end, .35 + tuft * .3), angle, seed + tuft, detailed && !far));
        continue;
      }
      if (asset.species === "bonsai-juniper") {
        for (let spray = 0; spray < (far ? 1 : 2); spray++) surfaces.foliage.push(createCatalogJuniperSpray(
          ornamentalPointBetween(middle, end, .25 + spray * .55), angle + spray * .75, seed + spray,
          detailed && !far));
        continue;
      }
      let leafCount = far ? 3 : 5;
      if (asset.species === "bonsai-azalea" && !detailed && !far) leafCount = 4;
      for (let leaf = 0; leaf < leafCount; leaf++) {
        const at = ornamentalPointBetween(middle, end, .05 + leaf / leafCount * .95);
        let length = .059, width = .033;
        if (asset.species === "bonsai-azalea") { length = .050; width = .027; }
        surfaces.foliage.push(createBonsaiElmLeafGeometry({ position: at,
          yaw: angle + leaf * 2.399963, pitch: -.55 + leaf % 3 * .5, roll: Math.sin(leaf * 1.9) * .48,
          length, width, seed: seed + leaf }, detailed && !far, far));
      }
      if (asset.species === "bonsai-azalea" && shoot % 2 === 0)
        surfaces.flower.push(createCatalogAzaleaTrumpet(end, angle, seed, detailed && !far, far));
      if (asset.species === "bonsai-azalea" && shoot % 7 === 1 && !far) {
        const bud = new SphereGeometry(.013, 6, 4);
        bud.scale(.70, 1.35, .70); bud.translate(end[0], end[1] + .012, end[2]);
        surfaces.flower.push(bud);
      }
    }
  });
  wood.limbs.forEach((limb, index) => {
    let rings = detailed ? 10 : 7, sides = detailed ? 9 : 6;
    if (limb.role === "root") { rings = detailed ? 6 : 4; sides = detailed ? 6 : 5; }
    if (limb.role === "branch") { rings = detailed ? 7 : 5; sides = detailed ? 7 : 5; }
    if (limb.role === "twig") { rings = 2; sides = 3; }
    if (far) { rings = limb.role === "trunk" ? 5 : 2; sides = 4; }
    surfaces.bark.push(createOrnamentalWoodGeometry(limb, detailed, index, { rings, sides }));
  });
  if (wood.pot) {
    const pot = createBonsaiPotGeometries(wood.pot, detailed && !far);
    surfaces.ceramic.push(...pot.ceramic); surfaces.soil.push(pot.soil);
  }
  const root = new Group(), owned: BufferGeometry[] = [];
  root.name = `catalog-${asset.species}-${asset.variant}-${tier}`;
  let triangles = 0;
  try {
    for (const surface of Object.keys(surfaces) as Surface[]) {
      const pieces = surfaces[surface];
      if (!pieces.length) continue;
      pieces.forEach(completeAttributes);
      const merged = mergeGeometries(pieces, false);
      if (!merged) throw new Error(`Cannot merge bonsai ${surface}`);
      owned.push(merged); triangles += merged.index!.count / 3;
      const mesh = new Mesh(merged, pack.materials[surface]);
      mesh.name = surface; mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
    }
    // All physical forms share the botanical catalog height, including their real ceramic container.
    const targetHeight = getRoadPlant(asset.species)!.height;
    let maxY = 0;
    for (const geometry of owned) {
      geometry.computeBoundingBox(); maxY = Math.max(maxY, geometry.boundingBox!.max.y);
    }
    const scale = targetHeight / maxY;
    for (const geometry of owned) {
      geometry.scale(.80, scale, .80); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    }
  } catch (error) { owned.forEach(geometry => geometry.dispose()); root.clear(); throw error;
  } finally { Object.values(surfaces).flat().forEach(geometry => geometry.dispose()); }
  let disposed = false;
  return { root, triangles, dispose: () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear(); owned.forEach(geometry => geometry.dispose());
  } };
};

export const catalogBonsaiFamily = definePlantCompletionFamily({
  id: "catalog-bonsai", species: ["bonsai-pine", "bonsai-juniper", "bonsai-azalea", "bonsai-maple"],
  createMaterials: createCatalogBonsaiMaterials, createModel
});
