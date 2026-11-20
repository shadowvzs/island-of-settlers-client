import { BufferGeometry, Float32BufferAttribute, Group, Mesh, type MeshStandardMaterial } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { createBonsaiElmGraph } from "../../../render-common/plants/bonsai-elm-graph";
import { createBonsaiPineGraph } from "../../../render-common/plants/bonsai-pine-graph";
import { ornamentalNoise, type OrnamentalTreeGraph } from "../../../render-common/plants/ornamental-tree-graph";
import { createBonsaiElmLeafGeometry } from "./bonsai-elm-leaf-geometry";
import { createBonsaiNeedleGeometry } from "./bonsai-needle-geometry";
import { createBonsaiPotGeometries } from "./bonsai-pot-geometry";
import { createOrnamentalShootGeometry } from "./ornamental-shoot-geometry";
import { createOrnamentalWoodGeometry } from "./ornamental-wood-geometry";

export type BonsaiMaterials = Record<"bark" | "ceramic" | "foliage" | "soil", MeshStandardMaterial>;

const addSurfaceColour = (geometry: BufferGeometry) => {
  if (!geometry.index) {
    geometry.setIndex(Array.from({ length: geometry.getAttribute("position").count }, (_, index) => index));
  }
  if (geometry.hasAttribute("color")) return;
  const position = geometry.getAttribute("position"), colours: number[] = [];
  for (let vertex = 0; vertex < position.count; vertex++) {
    const seed = position.getX(vertex) * 37 + position.getY(vertex) * 53 + position.getZ(vertex) * 71;
    const shade = .91 + ornamentalNoise(seed) * .09;
    colours.push(shade, shade, shade);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
};

/** Private, unregistered hero candidate. Four merged surfaces and borrowed template materials. */
const createBonsaiGraphModel = (graph: OrnamentalTreeGraph, materials: BonsaiMaterials,
  detailed: boolean, distant = false) => {
  const root = new Group();
  root.name = `${graph.species}-candidate-${graph.variant}`;
  const pot = createBonsaiPotGeometries(graph.pot!, detailed);
  const surfaces = {
    bark: graph.limbs.filter(limb => !distant || limb.role !== "twig").map((limb, index) => {
      if (distant) return createOrnamentalShootGeometry(limb);
      if (graph.species === "bonsai-elm" && limb.role === "twig") return createOrnamentalShootGeometry(limb);
      return createOrnamentalWoodGeometry(limb, detailed, index);
    }),
    ceramic: pot.ceramic,
    foliage: graph.leaves.map(leaf => createBonsaiElmLeafGeometry(leaf, detailed, distant)),
    soil: [pot.soil]
  };
  if (!graph.leaves.length) surfaces.foliage.push(createBonsaiNeedleGeometry(graph, detailed));
  const counts = { bark: 0, ceramic: 0, foliage: 0, soil: 0 };
  const geometries: BufferGeometry[] = [];
  try {
    for (const surface of Object.keys(surfaces) as Array<keyof typeof surfaces>) {
      const pieces = surfaces[surface];
      pieces.forEach(addSurfaceColour);
      const geometry = mergeGeometries(pieces, false);
      if (!geometry) throw new Error(`Cannot merge bonsai ${surface}`);
      geometries.push(geometry);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      counts[surface] = geometry.index!.count / 3;
      const mesh = new Mesh(geometry, materials[surface]);
      mesh.name = surface; mesh.castShadow = true; mesh.receiveShadow = true;
      root.add(mesh);
    }
  } catch (error) {
    geometries.forEach(geometry => geometry.dispose());
    root.clear();
    throw error;
  } finally {
    Object.values(surfaces).flat().forEach(piece => piece.dispose());
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent(); root.clear();
    geometries.forEach(geometry => geometry.dispose());
  };
  return { root, graph, counts, triangles: Object.values(counts).reduce((sum, count) => sum + count, 0), dispose };
};

export const createBonsaiModel = (materials: BonsaiMaterials, detailed: boolean, variant = 0) =>
  createBonsaiGraphModel(createBonsaiPineGraph(variant, detailed), materials, detailed);

export const createBonsaiElmModel = (materials: BonsaiMaterials, detailed: boolean, variant = 0, distant = false) =>
  createBonsaiGraphModel(createBonsaiElmGraph(variant, detailed), materials, detailed, distant);

export { createBonsaiElmMaterials } from "./bonsai-elm-materials";
