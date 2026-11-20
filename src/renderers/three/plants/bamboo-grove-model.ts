import { Group, Mesh } from "three";

import { type BambooGroveGraph, type BambooLeaf,
  createBambooGroveGraph } from "../../../render-common/plants/bamboo-grove-graph";
import { bambooMoundRadius, type BambooGroveVariant } from "../../../render-common/plants/bamboo-grove-species";
import { addBambooCulms, type BambooTier } from "./bamboo-culm-geometry";
import { addBambooBranches, addBambooGround, bambooMoundHeight } from "./bamboo-ground-geometry";
import { addBambooLeaf, type BambooLeafPaint } from "./bamboo-leaf-geometry";
import type { BambooMaterials } from "./bamboo-materials";
import { bambooGeometry, type BambooMeshBuffers, type BambooRgb, createBambooBuffers } from "./bamboo-mesh-buffers";

/** Leaves each tier keeps per spray: lower tiers keep the large central ones, never an empty twig. */
const keptLeaves = (tier: BambooTier, sprayLeaves: number) => {
  if (tier === "high") return sprayLeaves + 1;
  return tier === "far" ? 2 : Math.max(2, sprayLeaves - 1);
};
const LITTER: BambooRgb = [.74, .6, .36];
const YOUNG: BambooRgb = [.62, .82, .3];
const DRY_TIP: BambooRgb = [.8, .7, .38];

const leafPaint = (graph: BambooGroveGraph, leaf: BambooLeaf): BambooLeafPaint => {
  const base = graph.species.leafColour, shade = .86 + leaf.shade * .26, young = leaf.shade < .22 ? .35 : 0;
  const tone = (index: 0 | 1 | 2) => Math.min(1, (base[index] + (YOUNG[index] - base[index]) * young) * shade);
  return { colour: [tone(0), tone(1), tone(2)], phase: graph.culms[leaf.culm]!.phase,
    tip: leaf.shade > .9 ? DRY_TIP : undefined };
};

const addFoliage = (buffers: BambooMeshBuffers, graph: BambooGroveGraph, tier: BambooTier) => {
  for (const leaf of graph.leaves) {
    if (leaf.rank >= keptLeaves(tier, graph.species.sprayLeaves) || tier === "far" && leaf.twig) continue;
    addBambooLeaf(buffers, leaf, tier, leafPaint(graph, leaf));
  }
  if (tier === "far") return;
  const mound = bambooMoundRadius(graph.species);
  for (const litter of graph.litter.slice(0, tier === "high" ? undefined : 6)) {
    const [x, , z] = litter.position, direction = [Math.cos(litter.yaw), 0, Math.sin(litter.yaw)] as const;
    const y = bambooMoundHeight(Math.hypot(x, z) / mound) + .006;
    addBambooLeaf(buffers, { base: [x - direction[0] * litter.length / 2, y, z - direction[2] * litter.length / 2],
      bend: 0, culm: 0, direction: [...direction], length: litter.length, rank: 0, roll: 0, shade: 0,
      twig: false, width: litter.width }, tier, { colour: LITTER, phase: 0 }, true);
  }
};

export const bambooTriangles = (geometryIndices: readonly number[]) => geometryIndices.length / 3;

/**
 * One grove as two merged meshes (culm surfaces, leaves): every part of a tier shares two materials,
 * so N instances cost two instanced draws.
 */
export const createBambooGroveModel = (materials: BambooMaterials, variant: BambooGroveVariant, tier: BambooTier) => {
  const graph = createBambooGroveGraph(variant);
  const wood = createBambooBuffers(), foliage = createBambooBuffers();
  addBambooGround(wood, graph, tier);
  addBambooCulms(wood, graph, tier);
  addBambooBranches(wood, graph, tier);
  addFoliage(foliage, graph, tier);
  const culmGeometry = bambooGeometry(wood, .5), leafGeometry = bambooGeometry(foliage, .6);
  const root = new Group(); root.name = `bamboo-grove-${variant}-${tier}`;
  const culms = new Mesh(culmGeometry, materials.culm), leaves = new Mesh(leafGeometry, materials.leaf);
  culms.name = "bamboo-culms"; leaves.name = "bamboo-leaves";
  root.add(culms, leaves);
  let disposed = false;
  return { root, triangles: bambooTriangles(wood.indices) + bambooTriangles(foliage.indices), dispose: () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear(); culmGeometry.dispose(); leafGeometry.dispose();
  } };
};
