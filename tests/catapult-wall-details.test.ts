import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { buildingPartNavigationVolumes } from "../src/render-common/buildings/building-navigation-profile";
import { getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { CATAPULT_SHAFT_HEIGHT } from "../src/render-common/buildings/catapult-dimensions";
import { catapultShellOuterRadius, catapultShellVoid } from "../src/render-common/buildings/catapult-national-shell-profile";
import { createCatapultTowerRecipe } from "../src/render-common/buildings/catapult-tower-recipe";
import { catapultIvyGrowth } from "../src/render-common/buildings/catapult-wall-details";
import { createCatapultIvyMaterial } from "../src/renderers/three/buildings/catapult-ivy-material";
import { createCatapultAxeMetalMaterial, isCatapultEntryAxe } from "../src/renderers/three/buildings/catapult-viking-axe-metal";
import { createNationBuilding } from "../src/renderers/three/buildings/nation-building";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

describe("actual national Catapult wall details", () => {
  it.each([true, false])("roots numerous ivy stems and bonds every leaf to a real branch (%s)", detailed => {
    const { leaves, stems } = catapultIvyGrowth(detailed);
    expect(stems.filter(stem => stem.from[1] === 0)).toHaveLength(detailed ? 15 : 9);
    expect(leaves.length).toBeGreaterThanOrEqual(detailed ? 210 : 54);
    for (const leaf of leaves) {
      expect(stems.some(stem => stem.to.every((value, axis) => value === leaf.bearing[axis]))).toBe(true);
      expect(catapultShellVoid(Math.atan2(leaf.center[0], leaf.center[2]), leaf.center[1])).toBeUndefined();
    }
  });

  it.each([true, false])("keeps actual ivy vertices out of entrances/windows and within the shaft envelope (%s)", detailed => {
    const recipe = createCatapultTowerRecipe("roman", detailed);
    const part = recipe.parts.find(candidate => candidate.shape === "catapult-wall-ivy")!;
    const geometry = createRomanPartGeometry(part, detailed), position = geometry.getAttribute("position");
    try {
      for (let vertex = 0; vertex < position.count; vertex++) {
        const x = position.getX(vertex), y = position.getY(vertex), z = position.getZ(vertex);
        expect(Math.abs(x)).toBeLessThan(.85);
        expect(Math.abs(z)).toBeLessThan(.85);
        expect(y).toBeGreaterThan(-.008);
        expect(y).toBeLessThan(CATAPULT_SHAFT_HEIGHT);
        expect(catapultShellVoid(Math.atan2(x, z), y)).toBeUndefined();
        expect(Math.hypot(x, z) - catapultShellOuterRadius("roman", Math.atan2(x, z), y)).toBeGreaterThan(0);
      }
    } finally { geometry.dispose(); }
  });

  it("mounts exactly two shields below Viking windows, preserving all physical and service data", () => {
    for (const nation of ["roman", "viking"] as const) {
      const recipe = createCatapultTowerRecipe(nation, true);
      const originalParts = recipe.parts.filter(part => !part.wallMountedDecoration && part.shape !== "catapult-wall-ivy");
      expect(buildingPartNavigationVolumes(recipe.parts, 1)).toEqual(buildingPartNavigationVolumes(originalParts, 1));
      expect(getRomanRecipeBounds(getBuildingDefinition(16), recipe)).toEqual(
        getRomanRecipeBounds(getBuildingDefinition(16), { ...recipe, parts: originalParts }));
      expect(recipe.parts.filter(part => part.shape === "round-shield")).toHaveLength(nation === "viking" ? 2 : 0);
      if (nation !== "viking") continue;
      const shields = recipe.parts.filter(part => part.shape === "round-shield");
      expect(shields.map(part => Math.sign(part.position[0]))).toEqual([-1, 1]);
      expect(shields.every(part => part.position[1] + part.size[1] / 2 < 1.785)).toBe(true);
      expect(recipe.parts.filter(part => part.wallMountedDecoration && part.surface === "wood")).toHaveLength(4);
    }
    for (const nation of ["japanese", "chinese", "maya", "nubian", "persian", "indigenous"] as const) {
      expect(createCatapultTowerRecipe(nation, false).parts.some(part =>
        part.wallMountedDecoration || part.shape === "catapult-wall-ivy")).toBe(false);
    }
  });

  it("replaces the door crest with two sculpted bearded axes while retaining both side shields", () => {
    for (const detailed of [true, false]) {
      const recipe = createCatapultTowerRecipe("viking", detailed);
      const axes = recipe.parts.filter(part => part.shape === "bearded-axe-head");
      expect(axes).toHaveLength(2);
      expect(axes.every(part => part.surface === "steel" && part.position[2] > .81)).toBe(true);
      expect(recipe.parts.filter(part => part.shape === "round-shield")).toHaveLength(2);
    }
  });

  it("uses dedicated forged metal only on the mounted entrance axe heads and releases shared maps", () => {
    const recipe = createCatapultTowerRecipe("viking", true);
    expect(recipe.parts.filter(isCatapultEntryAxe)).toHaveLength(2);
    const source = new MeshStandardMaterial(), first = createCatapultAxeMetalMaterial(source, true);
    const second = createCatapultAxeMetalMaterial(source, true);
    expect(first.map).toBe(second.map); expect(first.normalMap).toBeTruthy();
    expect(first.roughnessMap).toBeTruthy(); expect(first.vertexColors).toBe(false);
    const pixels = (first.map!.image as { data: Uint8Array }).data;
    const channels = Array.from(pixels).filter((_, index) => index % 4 === 0);
    expect(channels.reduce((maximum, value) => Math.max(maximum, value), 0) -
      channels.reduce((minimum, value) => Math.min(minimum, value), 255)).toBeGreaterThan(60);
    let released = 0; first.map!.addEventListener("dispose", () => released++);
    first.dispose(); first.dispose(); expect(released).toBe(0);
    second.dispose(); expect(released).toBe(1); source.dispose();
  });

  it("keeps every affected level below the original national triangle caps", () => {
    const materials = createPlainBuildingMaterials();
    try {
    for (const nation of ["roman", "viking"] as const) for (const detailed of [true, false]) {
      for (const level of [1, 2, 3, 4, 5] as const) {
        const model = createNationBuilding(getBuildingDefinition(16), materials, nation, detailed, level);
        try { expect(model.triangles(false), `${nation}/${detailed}/${level}`).toBeLessThanOrEqual(detailed ? 15_000 : 3_450); }
        finally { model.dispose(); }
      }
    }
    } finally { Object.values(materials).forEach(material => material.dispose()); }
  }, 15_000);

  it("shares the original ivy surface maps until the last material owner releases them", () => {
    const source = new MeshStandardMaterial(), first = createCatapultIvyMaterial(source, false);
    const second = createCatapultIvyMaterial(source, false), map = first.map!, normal = first.normalMap!;
    let mapDisposals = 0, normalDisposals = 0;
    map.addEventListener("dispose", () => mapDisposals++);
    normal.addEventListener("dispose", () => normalDisposals++);
    expect(first.alphaTest).toBe(0);
    expect(first.transparent).toBe(false);
    expect(first.map).toBe(second.map); expect(first.normalMap).toBe(second.normalMap);
    first.dispose(); first.dispose();
    expect(mapDisposals).toBe(0);
    second.dispose(); second.dispose();
    expect(mapDisposals).toBe(1); expect(normalDisposals).toBe(1);
    source.dispose();
  });
});
