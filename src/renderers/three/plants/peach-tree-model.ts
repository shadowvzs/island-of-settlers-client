import { BufferGeometry,  Float32BufferAttribute, Group, Mesh,
  type MeshStandardMaterial } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { createFloweringPeachGraph } from "../../../render-common/plants/flowering-peach-graph";
import type { OrnamentalTreeGraph } from "../../../render-common/plants/ornamental-tree-graph";
import { createOrnamentalLeafGeometry } from "./ornamental-foliage-geometry";
import { createPeachWoodGeometry } from "./peach-bark-geometry";
import { createPeachBlossomTreeLod } from "./peach-blossom-tree-lod";
import { createPeachBlossomTreeTemplates, type PeachBlossomTreeTemplates } from "./peach-blossom-tree-templates";

type Surface = "bark" | "barkYoung" | "ceramic" | "foliage" | "soil" | "blossom";
export type PeachTreeMaterials = Record<Exclude<Surface, "barkYoung">, MeshStandardMaterial> &
  Partial<Record<"barkYoung", MeshStandardMaterial>>;

export const mergePeachSurfaces = (pieces: BufferGeometry[]) => {
  const flat = pieces.map(piece => {
    const geometry = piece.index ? piece.toNonIndexed() : piece;
    if (piece !== geometry) piece.dispose();
    if (!geometry.hasAttribute("color")) {
      const colours = new Float32Array(geometry.getAttribute("position").count * 3).fill(1);
      geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
    }
    geometry.clearGroups();
    return geometry;
  });
  const merged = mergeGeometries(flat, false);
  flat.forEach(piece => piece.dispose());
  if (!merged) throw new Error("Unable to merge ornamental tree surface");
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
};

/** Private premium candidate: continuous wood and supported foliage, one merged mesh per surface. */
export const createPeachStructureModel = (graph: OrnamentalTreeGraph,
  materials: PeachTreeMaterials, detailed: boolean) => {
  const root = new Group(); root.name = `${graph.species}-candidate-${graph.variant}`;
  const surfaces = {
    bark: graph.limbs.flatMap((limb, index) => limb.radius > .045 ? [createPeachWoodGeometry(limb, detailed, index, limb.parent === null ? undefined : graph.limbs[limb.parent])] : []),
    barkYoung: graph.limbs.flatMap((limb, index) => limb.radius <= .045 ? [createPeachWoodGeometry(limb, detailed, index, limb.parent === null ? undefined : graph.limbs[limb.parent])] : []),
    foliage: graph.leaves.map(leaf => createOrnamentalLeafGeometry(leaf, detailed))
  };
  const geometries: BufferGeometry[] = [];
  const counts: Record<Surface, number> = { bark: 0, barkYoung: 0, blossom: 0, ceramic: 0, foliage: 0, soil: 0 };
  for (const surface of Object.keys(surfaces) as Array<keyof typeof surfaces>) {
    if (!surfaces[surface].length) continue;
    const geometry = mergePeachSurfaces(surfaces[surface]);
    geometries.push(geometry); counts[surface] = geometry.getAttribute("position").count / 3;
    const mesh = new Mesh(geometry, materials[surface] ?? materials.bark);
    mesh.name = surface; mesh.castShadow = detailed; mesh.receiveShadow = detailed;
    root.add(mesh);
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear();
    geometries.forEach(geometry => geometry.dispose());
  };
  return { root, graph, counts, triangles: Object.values(counts).reduce((sum, count) => sum + count, 0), dispose };
};

export const createFloweringPeachModel = (materials: PeachTreeMaterials, detailed: boolean,
  variant = 0, borrowedTemplates?: PeachBlossomTreeTemplates) => {
  // Quality changes geometric detail; adult crown population remains consistent with production.
  const graph = createFloweringPeachGraph(variant, true);
  const templates = borrowedTemplates ?? createPeachBlossomTreeTemplates(detailed);
  const base = createPeachStructureModel({ ...graph, blossoms: [] }, materials, detailed);
  const flowers = createPeachBlossomTreeLod(graph.blossoms, templates, detailed);
  base.root.add(flowers.root);
  const counts = { ...base.counts, blossom: flowers.farTriangles };
  const triangles = base.triangles + flowers.farTriangles;
  const stagedBudgetPassed = triangles <= (detailed ? 24000 : 6000);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; flowers.dispose(); base.dispose();
    if (!borrowedTemplates) templates.dispose();
  };
  const flowerLod = () => {
    const state = flowers.snapshot();
    return { ...state, triangles: base.triangles + state.triangles };
  };
  return { root: base.root, graph, counts, triangles, stagedBudgetPassed, flowerLod, dispose };
};

