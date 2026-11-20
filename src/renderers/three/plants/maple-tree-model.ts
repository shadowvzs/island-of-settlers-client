import { BufferGeometry, Float32BufferAttribute, Group, Mesh, type MeshStandardMaterial } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { createMapleTreeGraph } from "../../../render-common/plants/maple-tree-graph";
import { createMapleBarkMaterial } from "./maple-bark-material";
import { createMapleConnectedWood } from "./maple-connected-wood";
import { createMapleFarAlpha } from "./maple-far-alpha";
import { createMapleLeafMaterials, type MapleLeafPalette } from "./maple-leaf-material";
import { createMapleProductionLeafGeometry } from "./maple-production-leaf-geometry";
import { createMapleFarSurfaces } from "./maple-tree-far-model";

/** Shared across every structure and colour; palette choice never creates more textures. */
export const createMapleTreeMaterials = (detailed = true) => {
  const wood = createMapleBarkMaterial();
  const leaves = createMapleLeafMaterials(detailed);
  const distant = new Map<MapleLeafPalette, MeshStandardMaterial>();
  let alpha: ReturnType<typeof createMapleFarAlpha> | undefined;
  let disposed = false;
  const farLeaves = (palette: MapleLeafPalette) => {
    if (disposed) throw new Error("Maple material owner disposed");
    const existing = distant.get(palette);
    if (existing) return existing;
    alpha ??= createMapleFarAlpha();
    const material = leaves.material(palette).clone();
    material.name = `maple_far_leaf_${palette}`;
    // The source blade occupies44% of its carrier: retain its final averaged mip at distance.
    material.alphaMap = alpha; material.alphaTest = .40;
    distant.set(palette, material);
    return material;
  };
  return { bark: wood.material, farLeaves, foldedLeaves: farLeaves, isDisposed: () => disposed, leaves,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const material of distant.values()) material.dispose();
      distant.clear();
      if (alpha) { alpha.dispose(); alpha.image.data = null; }
      wood.dispose(); leaves.dispose();
    } };
};

export type MapleTreeMaterials = ReturnType<typeof createMapleTreeMaterials>;

const mergeSurface = (pieces: BufferGeometry[]) => {
  const flat = pieces.map(piece => {
    const geometry = piece.index ? piece.toNonIndexed() : piece;
    if (geometry !== piece) piece.dispose();
    if (!geometry.hasAttribute("color"))
      geometry.setAttribute("color", new Float32BufferAttribute(
        new Float32Array(geometry.getAttribute("position").count * 3).fill(1), 3));
    geometry.clearGroups();
    return geometry;
  });
  const merged = mergeGeometries(flat, false);
  flat.forEach(piece => piece.dispose());
  if (!merged) throw new Error("Unable to merge ornamental maple surface");
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
};

const createMapleTreeSurfaces = (detailed: boolean, variant: number, tier: "near" | "far") => {
  const graph = createMapleTreeGraph(variant, tier === "near" && detailed);
  let bark: BufferGeometry, foliage: BufferGeometry;
  if (tier === "far") ({ bark, foliage } = createMapleFarSurfaces(graph));
  else {
    const pieces = graph.limbs.map((limb, index) => createMapleConnectedWood(graph, limb, detailed, index));
    bark = mergeSurface(pieces);
    foliage = mergeSurface(graph.leaves.map(leaf => createMapleProductionLeafGeometry(leaf, detailed)));
  }
  const counts = { bark: (bark.index?.count ?? bark.getAttribute("position").count) / 3,
    foliage: (foliage.index?.count ?? foliage.getAttribute("position").count) / 3 };
  return { bark, counts, foliage, graph, triangles: counts.bark + counts.foliage };
};

interface GeometryLease {
  surfaces: ReturnType<typeof createMapleTreeSurfaces>;
  users: number;
}
const geometryOwners = new WeakMap<MapleTreeMaterials, Map<string, GeometryLease>>();

/** Palette-specific templates borrow the same neutral geometry while any colour still uses it. */
export const createMapleTreeTemplate = (materials: MapleTreeMaterials, detailed: boolean, variant = 0,
  tier: "near" | "far" = "near") => {
  if (materials.isDisposed()) throw new Error("Maple material owner disposed");
  let pool = geometryOwners.get(materials);
  if (!pool) { pool = new Map(); geometryOwners.set(materials, pool); }
  const key = `${variant}:${detailed}:${tier}`;
  let entry = pool.get(key);
  if (!entry) {
    entry = { surfaces: createMapleTreeSurfaces(detailed, variant, tier), users: 0 };
    pool.set(key, entry);
  }
  entry.users++;
  const { bark, counts, foliage, graph, triangles } = entry.surfaces;
  let disposed = false;
  return { graph, counts, triangles,
    create: (palette: MapleLeafPalette = "yellow") => {
      if (disposed) throw new Error("Maple template is disposed");
      const root = new Group(); root.name = `ornamental-maple-${variant}-${palette}`;
      const leafMaterial = tier === "far" ? materials.farLeaves(palette) : materials.foldedLeaves(palette);
      const trunk = new Mesh(bark, materials.bark), leaves = new Mesh(foliage, leafMaterial);
      trunk.name = "maple-bark"; leaves.name = "maple-leaves";
      for (const mesh of [trunk, leaves]) { mesh.castShadow = detailed; mesh.receiveShadow = detailed; }
      root.add(trunk, leaves);
      // The instance borrows its two meshes' geometry/materials for the complete template lifetime.
      return { root, dispose: () => { root.removeFromParent(); root.clear(); } };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (--entry.users > 0) return;
      bark.dispose(); foliage.dispose(); pool.delete(key);
      if (!pool.size) geometryOwners.delete(materials);
    } };
};
