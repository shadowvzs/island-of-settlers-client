import { BufferGeometry, Euler, Float32BufferAttribute, Group, Matrix4, Mesh } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { OrnamentalLeaf } from "../../../render-common/plants/ornamental-tree-graph";
import { createRomanGardenTreeGraph, type RomanGardenTreeSpecies } from "../../../render-common/plants/roman-garden-tree-graph";
import { createCypressFoliageCore } from "./cypress-foliage-core";
import { createOrnamentalWoodGeometry } from "./ornamental-wood-geometry";
import type { RomanGardenTreeMaterials } from "./roman-garden-tree-materials";
import { createWillowPetioleGeometry, willowWoodTopology } from "./willow-tree-geometry";

export { createRomanGardenTreeMaterials } from "./roman-garden-tree-materials";

const blade = (leaf: OrnamentalLeaf, willow: boolean, detailed: boolean) => {
  const position: number[] = [], colours: number[] = [], uv: number[] = [], indices: number[] = [];
  if (willow) {
    let outline = [[0, 0], [-.5, .45], [0, 1], [.5, .45]];
    if (detailed) outline = [[0, 0], [-.33, .20], [-.5, .48], [-.28, .77],
      [0, 1], [.28, .77], [.5, .48], [.33, .20]];
    for (const [x = 0, t = 0] of outline) {
      position.push(x * leaf.width, Math.sin(t * Math.PI) * leaf.length * .04, t * leaf.length);
      const shade = .90 + Math.sin(leaf.seed * 7.13) * .08;
      colours.push(shade, shade, shade); uv.push(x + .5, t);
    }
    const centre = position.length / 3;
    position.push(0, leaf.length * .075, leaf.length * .5);
    colours.push(1, 1, 1); uv.push(.5, .5);
    for (let index = 0; index < outline.length; index++) indices.push(centre, index, (index + 1) % outline.length);
  }
  const rings = willow ? -1 : 2;
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings;
    const halfWidth = Math.sin(Math.PI * t) ** (willow ? .72 : 1.1) * leaf.width * .5;
    const curl = Math.sin(t * Math.PI) * leaf.length * .075;
    for (const side of [-1, 0, 1]) {
      position.push(side * halfWidth, curl + (side === 0 ? leaf.length * .025 : 0), t * leaf.length);
      const shade = .87 + Math.sin(leaf.seed * 7.13) * .10 + t * .07;
      colours.push(shade, shade, shade); uv.push(side * .5 + .5, t);
    }
    if (ring < rings) for (let side = 0; side < 2; side++) {
      const start = ring * 3 + side;
      indices.push(start, start + 3, start + 1, start + 1, start + 3, start + 4);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ"));
  matrix.setPosition(...leaf.position); geometry.applyMatrix4(matrix);
  return geometry;
};

const merge = (pieces: BufferGeometry[]) => {
  const geometries = pieces.map(piece => {
    const result = piece.index ? piece.toNonIndexed() : piece;
    if (piece !== result) piece.dispose();
    return result;
  });
  const result = mergeGeometries(geometries, false);
  geometries.forEach(geometry => geometry.dispose());
  if (!result) throw new Error("Unable to merge garden tree surface");
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
};

/** Two batched surfaces per template; every close leaf has a physical contour and raised midrib. */
export const createRomanGardenTreeModel = (materials: RomanGardenTreeMaterials, species: RomanGardenTreeSpecies,
  detailed: boolean, variant = 0, tier: "near" | "far" = "near") => {
  const full = detailed && tier === "near", far = tier === "far";
  const graph = createRomanGardenTreeGraph(species, full, variant);
  const wood = graph.limbs.flatMap((limb, index) => {
    if (far && limb.role === "twig") return [];
    if (!full && species === "cypress-tree" && limb.role === "twig" && index % 2) return [];
    if (species === "willow-tree")
      return [createOrnamentalWoodGeometry(limb, full, index, willowWoodTopology(limb, full, far))];
    const topology = { rings: 2, sides: 3 };
    if (limb.path.length === 2) topology.rings = 1;
    if (limb.role === "trunk") { topology.rings = full ? 16 : 8; topology.sides = full ? 12 : 7; }
    if (limb.role === "branch") { topology.rings = full ? 6 : 4; topology.sides = full ? 5 : 3; }
    if (far) { topology.rings = 2; topology.sides = 4; }
    return [createOrnamentalWoodGeometry(limb, full, index, topology)];
  });
  if (species === "willow-tree" && !far) for (const leaf of graph.leaves) {
    const petiole = createWillowPetioleGeometry(leaf);
    if (petiole) wood.push(petiole);
  }
  const renderedLeaves: OrnamentalLeaf[] = [];
  const leafPieces = graph.leaves.flatMap((leaf, index) => {
    if (species === "cypress-tree" && index % 3 !== 0) return [];
    if (far && index % (species === "willow-tree" ? 5 : 4) !== 0) return [];
    const source = { ...leaf };
    if (far) { source.length *= 1.4; source.width *= 1.7; }
    renderedLeaves.push(source);
    return [blade(source, species === "willow-tree", full)];
  });
  if (species === "cypress-tree") leafPieces.push(createCypressFoliageCore(graph, detailed, far));
  const bark = merge(wood), foliage = merge(leafPieces);
  const root = new Group(); root.name = `${species}-${variant}-${tier}`;
  const trunk = new Mesh(bark, materials.bark), leaves = new Mesh(foliage, materials.foliage);
  trunk.name = `${species}-connected-limbs`; leaves.name = `${species}-folded-leaves`;
  for (const mesh of [trunk, leaves]) { mesh.castShadow = detailed; mesh.receiveShadow = detailed; }
  root.add(trunk, leaves);
  const triangles = (bark.getAttribute("position").count + foliage.getAttribute("position").count) / 3;
  let disposed = false;
  return { graph, renderedLeaves, root, triangles, dispose: () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear(); bark.dispose(); foliage.dispose();
  } };
};
