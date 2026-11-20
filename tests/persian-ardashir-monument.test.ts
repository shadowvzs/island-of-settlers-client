import { Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { roofTopAt } from "../src/render-common/buildings/levels/level-roof-surface";
import { MONUMENT_PLOT, monumentRecipe } from "../src/render-common/buildings/monument-definition";
import { persianArdashirMonumentRecipe } from "../src/render-common/buildings/persian-ardashir-monument";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("uses three full equal ceremonial chambers with identical High/Minimal massing and original anchors", () => {
  const high = persianArdashirMonumentRecipe(true), minimal = persianArdashirMonumentRecipe(false);
  const { parts: _originalParts, ...anchors } = monumentRecipe();
  for (const recipe of [high, minimal]) {
    const { parts: _parts, ...actualAnchors } = recipe;
    expect(actualAnchors).toEqual(anchors);
    const domes = recipe.parts.filter(part => part.shape === "persian-dome");
    expect(domes.map(part => part.position)).toEqual([[-2.65, 4.675, -1.125], [0, 4.675, -1.125],
      [2.65, 4.675, -1.125]]);
    expect(domes.every(part => part.size.join(",") === "2.65,1.65,2.65")).toBe(true);
    expect(recipe.parts.some(part => part.shape === "ogive-dome" || part.shape === "dome")).toBe(false);
  }
  expect(MONUMENT_PLOT).toEqual([9, 9]);
});

it.each([true, false])("has actual vaulted interior ceilings and matching exterior roof contacts (%s)", detailed => {
  const recipe = persianArdashirMonumentRecipe(detailed), materials = createPlainBuildingMaterials();
  const model = createRomanBuilding(getBuildingDefinition(7), materials, detailed, recipe, "persian");
  model.root.updateMatrixWorld(true);
  for (const [x, z] of [[.3, -1.125], [-2.4, -1.2], [2.9, -1.05], [.3, 2.1]]) {
    const outside = new Raycaster(new Vector3(x!, 8, z!), new Vector3(0, -1, 0))
      .intersectObject(model.root, true);
    const inside = new Raycaster(new Vector3(x!, 1.4, z!), new Vector3(0, 1, 0))
      .intersectObject(model.root, true);
    expect(inside[0]!.point.y).toBeGreaterThan(4.3);
    expect(outside[0]!.point.y).toBeCloseTo(roofTopAt(recipe.parts, x!, z!, detailed)!, 5);
    expect(outside[0]!.point.y - inside[0]!.point.y).toBeGreaterThan(.08);
  }
  model.dispose(); Object.values(materials).forEach(material => material.dispose());
});

it.each([true, false])("bonds the new portal ornament to real masonry without crossing the entrance (%s)", detailed => {
  const recipe = persianArdashirMonumentRecipe(detailed), materials = createPlainBuildingMaterials();
  const structural = { ...recipe, parts: recipe.parts.filter(part =>
    part.shape !== "persian-palmette-panel" && part.shape !== "paint-ellipse") };
  const model = createRomanBuilding(getBuildingDefinition(7), materials, detailed, structural, "persian");
  model.root.updateMatrixWorld(true);
  const front = recipe.parts.filter(part => part.position[2] > 4.05 &&
    ["persian-palmette-panel", "paint-ellipse"].includes(part.shape));
  expect(front.length).toBeGreaterThanOrEqual(18);
  for (const part of front) {
    const hit = new Raycaster(new Vector3(part.position[0], part.position[1], 5), new Vector3(0, 0, -1))
      .intersectObject(model.root, true)[0];
    expect(hit, `${part.position}`).toBeDefined();
    expect(hit!.point.z).toBeGreaterThanOrEqual(part.position[2] - part.size[2] / 2 - .002);
  }
  model.dispose(); Object.values(materials).forEach(material => material.dispose());
});
