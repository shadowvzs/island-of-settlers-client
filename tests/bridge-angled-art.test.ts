import { type Group, type Mesh, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  type BridgeRecipe,
  type BridgeRecipeInput,
  lowestBridgeBed
} from "../src/render-common/bridges/bridge-recipe";
import { stoneArchBridgeRecipe } from "../src/render-common/bridges/stone-arch-bridge-recipe";
import { stoneSlabBridgeRecipe } from "../src/render-common/bridges/stone-slab-bridge-recipe";
import { woodBridgeRecipe } from "../src/render-common/bridges/wood-bridge-recipe";
import type { BuildingPart, BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createThreeBridges } from "../src/renderers/three/settlement/three-bridges";
import type { BridgeConstructionSnapshot } from "../src/shared/settlement/bridge-construction";
import { planBridge } from "../src/shared/settlement/bridge-planning";
import { createBridgeSurfaceService } from "../src/shared/settlement/bridge-surface";
import { angledBridgeTestWorld, bridgeRules } from "./helpers/bridge-world";

/**
 * An angled crossing meets a skewed bank: across the deck end, one side stands over deep water while
 * the other is still on the bank. Ground falls from +0.3 to -0.9 along a line skewed by 35 degrees.
 */
const skewedInput = (tiles: number, detailed = true): BridgeRecipeInput => {
  const length = tiles * 0.5, skew = Math.tan(35 * Math.PI / 180);
  const bankDistance = (along: number, across: number) =>
    Math.min(along + across * skew, length - along + across * skew);
  return {
    deckTopAt: along => 0.55 + 0.04 * tiles * Math.sin(Math.PI * Math.min(1, Math.max(0, along / length))),
    detailed,
    length,
    terrainAt: (along, across) => Math.max(-0.9, Math.min(0.3, 0.3 - bankDistance(along, across) * 0.8)),
    tiles,
    waterAt: () => 0
  };
};

const partOf = (part: BridgeRecipe["parts"][number]["part"]): BuildingPart => {
  if ("kind" in part) throw new Error("Bridge recipes must use building parts");
  return part;
};

/** Lowest underside of the foundation parts standing at one shore anchor. */
const abutmentFooting = (recipe: BridgeRecipe, along: number) => Math.min(...recipe.parts
  .filter(({ part, stage }) => stage === 0 && Math.abs(partOf(part).position[0] - along) < 0.5 &&
    partOf(part).shape !== "rock")
  .map(({ part }) => partOf(part).position[1] - partOf(part).size[1] / 2));

describe("angled bridge supports on a skewed bank", () => {
  it.each([
    ["wood", (input: BridgeRecipeInput) => woodBridgeRecipe(input), 8],
    ["stone slab", (input: BridgeRecipeInput) => stoneSlabBridgeRecipe(input), 3],
    ["stone arch", (input: BridgeRecipeInput) => stoneArchBridgeRecipe(input), 8]
  ] as const)("%s abutments reach the deepest bed across the deck end", (_, build, tiles) => {
    for (const detailed of [true, false]) {
      const input = skewedInput(tiles, detailed);
      const recipe = build(input);
      for (const along of [0, input.length])
        expect(abutmentFooting(recipe, along)).toBeLessThanOrEqual(lowestBridgeBed(input, along, 1.3) + 1e-9);
    }
  });

  it("rests toe riprap on the bank in front of each abutment, below the deck and off the road", () => {
    const input = { ...skewedInput(8), waterAt: () => 0.25 };
    for (const recipe of [woodBridgeRecipe(input), stoneArchBridgeRecipe(input)]) {
      const rocks = recipe.parts.map(({ part }) => partOf(part)).filter(part => part.shape === "rock");
      expect(rocks.length).toBeGreaterThan(0);
      for (const rock of rocks) {
        const [along, y, across] = rock.position;
        expect(along).toBeGreaterThan(0.4);
        expect(along).toBeLessThan(input.length - 0.4);
        expect(y).toBeLessThanOrEqual(input.terrainAt(along, across) + 0.08 + 1e-9);
        expect(y).toBeLessThanOrEqual(input.deckTopAt(along) - 0.45 + 1e-9);
      }
    }
  });
});

describe("angled bridge scene placement", () => {
  const material = new MeshStandardMaterial();
  const materials = new Proxy({} as Record<BuildingSurface, MeshStandardMaterial>, { get: () => material });

  const angledSegments = () => {
    const world = angledBridgeTestWorld({ angleDegrees: 40, centre: { x: 16, z: 16 }, halfWidth: 1.6 });
    const result = planBridge({ id: 4, kind: "wood", pointer: { x: 16, z: 16 }, rules: bridgeRules(world), world });
    if (!result.ok) throw new Error(result.reason);
    return result.plan;
  };

  const modelRoot = (layer: ReturnType<typeof createThreeBridges>) => {
    let found: Group | undefined;
    layer.root.traverse(child => { if (child.name === "bridge_model") found = child as Group; });
    return found!;
  };

  it.each([true, false])("builds the finished deck along the angled span (High=%s)", detailed => {
    const plan = angledSegments();
    const surface = createBridgeSurfaceService(() => 0.3, () => 0.2);
    surface.update(plan.segments);
    const layer = createThreeBridges({ detailed, materialsFor: () => materials, surface,
      terrainHeight: () => 0.3, waterHeight: () => 0.2 });
    layer.update([]);
    const root = modelRoot(layer);
    root.updateWorldMatrix(true, true);
    const length = Math.hypot(plan.end.x - plan.start.x, plan.end.z - plan.start.z);
    const end = new Vector3(length, 0, 0).applyMatrix4(root.matrixWorld);
    expect(end.x).toBeCloseTo(plan.end.x, 9);
    expect(end.z).toBeCloseTo(plan.end.z, 9);
    const meshes = root.children as Mesh[];
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(mesh.geometry.drawRange.count).toBe(mesh.geometry.getAttribute("position").count);
    layer.dispose();
  });

  it("stages an angled construction site and shows its shore stock until completion", () => {
    const plan = angledSegments();
    const surface = createBridgeSurfaceService(() => 0.3, () => 0.2);
    const layer = createThreeBridges({ detailed: true, materialsFor: () => materials, surface,
      terrainHeight: () => 0.3, waterHeight: () => 0.2 });
    const snapshot = { id: 4, kind: "wood", progress: 0.5, segments: plan.segments,
      stockPoint: plan.approaches[0].outer } as unknown as BridgeConstructionSnapshot;
    layer.update([snapshot]);
    const root = modelRoot(layer);
    const drawn = (root.children as Mesh[]).map(mesh => mesh.geometry.drawRange.count);
    const full = (root.children as Mesh[]).map(mesh => mesh.geometry.getAttribute("position").count);
    expect(drawn.some((count, index) => count < full[index]!)).toBe(true);
    let stock: Group | undefined;
    layer.root.traverse(child => { if (child.name === "bridge_stock_pile") stock = child as Group; });
    expect(stock?.visible).toBe(true);
    expect(stock?.position.x).toBeCloseTo(plan.approaches[0].outer.x, 9);
    layer.dispose();
  });
});
