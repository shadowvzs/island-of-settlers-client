import { expect, it } from "vitest";

import { getRoadDecorationItem, type RoadDecorationItemId } from "../../island-of-settlers-shared/src/road-decoration-items";
import type { Point3 } from "../src/render-common/buildings/building-recipe";
import { bambooGroveClearanceVolumes } from "../src/render-common/plants/bamboo-grove-clearance";
import { createBambooGroveGraph } from "../src/render-common/plants/bamboo-grove-graph";
import { BAMBOO_CONTENT_IDS, bambooBudget,
  type BambooGroveVariant } from "../src/render-common/plants/bamboo-grove-species";
import { roadDecorationClearance } from "../src/render-common/road-decoration-clearance";
import { createBambooGroveModel } from "../src/renderers/three/plants/bamboo-grove-model";
import type { BambooMaterials } from "../src/renderers/three/plants/bamboo-materials";
import { ornamentalDecorationProfile } from "../src/renderers/three/plants/ornamental-decoration-profile";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { findDecorationEntryForItem } from "../src/shared/world/editing/decoration-registry";

const VARIANTS = [0, 1, 2, 3, 4, 5] as const satisfies readonly BambooGroveVariant[];
const IDS = BAMBOO_CONTENT_IDS;
const distance = (a: Point3, b: Point3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const materials = {} as BambooMaterials;

it.each(VARIANTS)("variant %i stays inside the per-tier triangle ceilings", variant => {
  for (const tier of ["high", "minimal", "far"] as const) {
    const model = createBambooGroveModel(materials, variant, tier);
    expect(model.triangles).toBeLessThanOrEqual(bambooBudget(variant)[tier]);
    expect(model.root.children).toHaveLength(2);
    model.dispose();
  }
});

it.each(VARIANTS)("variant %i attaches every branch to a culm node and every leaf to a branch or culm tip", variant => {
  const graph = createBambooGroveGraph(variant);
  for (const branch of graph.branches) {
    const culm = graph.culms[branch.culm]!;
    const nearestNode = Math.min(...culm.nodes.map(node => distance(node, branch.points[0]!)));
    const parentTwig = graph.branches.some(other =>
      !other.twig && distance(other.points[1]!, branch.points[0]!) < 1e-9);
    expect(branch.twig ? parentTwig : nearestNode < culm.radii[0]!).toBe(true);
  }
  const supports = [...graph.branches.map(branch => branch.points.at(-1)!),
    ...graph.culms.map(culm => culm.nodes.at(-1)!)];
  for (const leaf of graph.leaves) expect(supports.some(point => distance(point, leaf.base) < 1e-9)).toBe(true);
  for (const culm of graph.culms) expect(culm.nodes[0]![1]).toBeLessThan(0);
});

it.each(VARIANTS)("variant %i is maple-tall, deterministic, and grounded by a narrow support", variant => {
  const graph = createBambooGroveGraph(variant);
  const top = Math.max(...graph.culms.map(culm => culm.nodes.at(-1)![1]));
  expect(top).toBeGreaterThan(5.5); expect(top).toBeLessThan(8);
  expect(bambooGroveClearanceVolumes(variant)).toEqual(bambooGroveClearanceVolumes(variant));
  const definition = getRoadDecoration(IDS[variant]!)!;
  expect(definition.bambooVariant).toBe(variant);
  const { supports, volumes } = roadDecorationClearance(definition);
  expect(supports).toHaveLength(1);
  const [support] = supports;
  expect(support!.max[0] - support!.min[0]).toBeLessThan(1.6);
  expect(Math.max(...volumes.map(box => box.max[1]))).toBeGreaterThan(top);
  // The crown reservation (last box) leaves the ground passage beside the culms free.
  expect(bambooGroveClearanceVolumes(variant).at(-1)!.min[1]).toBeGreaterThan(1.5);
});

it("stands every single culm taller and thicker than the clumps, with larger leaves", () => {
  const clump = createBambooGroveGraph(0), tops = [0, 1].flatMap(variant =>
    createBambooGroveGraph(variant as BambooGroveVariant).culms.map(culm => culm.nodes.at(-1)![1]));
  const clumpTop = Math.max(...tops);
  for (const variant of [2, 3, 4, 5] as const) {
    const graph = createBambooGroveGraph(variant);
    expect(graph.culms).toHaveLength(1);
    // Owner 2026-11-10: standalone culms stand 10-30 % above the tallest clump culm.
    const ratio = graph.culms[0]!.nodes.at(-1)![1] / clumpTop;
    expect(ratio).toBeGreaterThanOrEqual(1.1); expect(ratio).toBeLessThanOrEqual(1.3);
    expect(graph.culms[0]!.radii[0]).toBeGreaterThan(Math.max(...clump.culms.map(culm => culm.radii[0]!)));
    expect(graph.species.leafLength).toBeGreaterThan(clump.species.leafLength);
  }
});

it("registers every bamboo model for buildings and the map editor palette, never the gem shop", () => {
  for (const [variant, content] of IDS.entries()) {
    const id = `roadDecoration:${content}:native`, item = getRoadDecorationItem(id)!;
    const budget = bambooBudget(variant as BambooGroveVariant);
    expect(item).toMatchObject({ category: "trees", nation: "chinese", shopAvailable: false,
      uses: ["building", "editor"] });
    expect(findDecorationEntryForItem(id as RoadDecorationItemId)).toBeDefined();
    const profile = ornamentalDecorationProfile(id, true)!;
    expect(profile).toMatchObject({ cost: budget.high, farCost: budget.far, large: true, overview: true });
    expect(ornamentalDecorationProfile(id, false)!.cost).toBe(budget.minimal);
  }
  const stand = getRoadDecorationItem("roadDecoration:japanese-bamboo-stand:native")!;
  expect(stand).toMatchObject({ nation: "japanese", shopAvailable: false, uses: ["building", "editor"] });
  expect(findDecorationEntryForItem("roadDecoration:japanese-bamboo-stand:native")).toBeDefined();
});
