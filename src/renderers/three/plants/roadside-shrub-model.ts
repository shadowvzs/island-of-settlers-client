import { type BufferGeometry, Float32BufferAttribute, Group, Mesh } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { createRoadsideShrubGraph } from "../../../render-common/plants/roadside-shrub-graph";
import { createBonsaiPotGeometries } from "./bonsai-pot-geometry";
import { createOrnamentalShootGeometry } from "./ornamental-shoot-geometry";
import { createOrnamentalWoodGeometry } from "./ornamental-wood-geometry";
import { createShrubFlowerGeometry, createShrubLeafGeometry } from "./roadside-shrub-foliage";
import type { createRoadsideShrubMaterials } from "./roadside-shrub-materials";
import { createShrubSoilGeometry, fitShrubPotUvs } from "./roadside-shrub-pot";
import { createShrubStemGeometry } from "./roadside-shrub-stem";

type Materials = ReturnType<typeof createRoadsideShrubMaterials>["materials"];

export const mergeShrubGeometry = (pieces: BufferGeometry[]) => {
  const flat = pieces.map(piece => {
    const geometry = piece.index ? piece.toNonIndexed() : piece;
    if (geometry !== piece) piece.dispose();
    if (!geometry.hasAttribute("color")) geometry.setAttribute("color",
      new Float32BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 3).fill(1), 3));
    geometry.clearGroups();
    return geometry;
  });
  const merged = mergeGeometries(flat, false);
  flat.forEach(piece => piece.dispose());
  if (!merged) throw new Error("Unable to merge shrub surface");
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
};

/** Private shrub family: one merged mesh per real surface, borrowed palette/texture owner. */
export const createDenseRoadsideShrubModel = (materials: Materials, detailed: boolean,
  variant = 0, potted = false) => {
  const graph = createRoadsideShrubGraph(variant, detailed, potted);
  const root = new Group(); root.name = `roadside-shrub-${variant}`;
  const surfaces: Record<keyof Materials, BufferGeometry[]> = {
    bark: graph.limbs.map((limb, index) => {
      if (limb.role === "trunk") return createOrnamentalWoodGeometry(limb, detailed, index);
      if (limb.role === "branch") return createShrubStemGeometry(limb, detailed);
      if (detailed) return createShrubStemGeometry(limb, true);
      return createOrnamentalShootGeometry(limb);
    }),
    foliage: graph.leaves.map(leaf => createShrubLeafGeometry(leaf, detailed)),
    flowers: graph.blossoms.map(flower => createShrubFlowerGeometry(flower, detailed)), ceramic: [], soil: []
  };
  if (graph.pot) {
    const pot = createBonsaiPotGeometries(graph.pot, detailed);
    for (const part of pot.ceramic) fitShrubPotUvs(part, graph.pot);
    pot.soil.dispose();
    surfaces.ceramic = pot.ceramic; surfaces.soil = [createShrubSoilGeometry(graph.pot, detailed)];
  }
  const geometries: BufferGeometry[] = [], counts = { bark: 0, ceramic: 0, flowers: 0, foliage: 0, soil: 0 };
  for (const surface of Object.keys(surfaces) as (keyof Materials)[]) {
    if (!surfaces[surface].length) continue;
    const geometry = mergeShrubGeometry(surfaces[surface]); geometries.push(geometry);
    counts[surface] = geometry.getAttribute("position").count / 3;
    const mesh = new Mesh(geometry, materials[surface]); mesh.name = surface;
    mesh.castShadow = detailed; mesh.receiveShadow = detailed; root.add(mesh);
  }
  let disposed = false;
  return { root, graph, counts, triangles: Object.values(counts).reduce((sum, count) => sum + count, 0),
    dispose: () => {
      if (disposed) return;
      disposed = true; root.removeFromParent(); root.clear(); geometries.forEach(geometry => geometry.dispose());
    } };
};
