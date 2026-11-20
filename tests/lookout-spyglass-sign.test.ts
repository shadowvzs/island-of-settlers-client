import { expect, it, vi } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { BUILDING_LEVELS } from "../src/render-common/buildings/levels/building-level";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { productionBuildingIconSource } from "../src/render-common/buildings/production-icon-sources";
import { shareBuildingMaterialOwnership } from "../src/renderers/three/buildings/building-material-ownership";
import { createLookoutSpyglassMaterial } from "../src/renderers/three/buildings/lookout-spyglass-material";

it("only type14 shares the genuine spyglass asset and every national/level facade actually keeps a backed sign", () => {
  expect(getBuildingDefinition(14).name).toBe("Lookout tower");
  expect(productionBuildingIconSource(14)).toContain("spyglass.png");
  expect(productionBuildingIconSource(4)).toBeUndefined();
  for (const nation of ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"] as const)
    for (const level of BUILDING_LEVELS) for (const detailed of [true, false]) {
      const recipe = createNationBuildingRecipe(getBuildingDefinition(14), nation, detailed, level);
      const signs = recipe.parts.filter(part => part.shape === "lookout-spyglass-sign");
      expect(signs, `${nation}/${level}/${detailed}`).toHaveLength(1);
      const sign = signs[0]!;
      expect(recipe.parts.some(part => part !== sign && !part.stock && part.size[2] > .02 &&
        Math.abs(part.position[0] - sign.position[0]) < .02 &&
        Math.abs(part.position[1] - sign.position[1]) < .02 &&
        part.position[2] < sign.position[2] && Math.abs(part.position[2] - sign.position[2]) < .08),
      `${nation}/${level}/${detailed}`).toBe(true);
    }
});

it("facades, roadposts and a placement ghost share one bitmap until the final owner disposes", () => {
  const facade = createLookoutSpyglassMaterial(), roadpost = createLookoutSpyglassMaterial(false);
  const ghost = facade.clone(); shareBuildingMaterialOwnership(facade, ghost);
  expect(facade.map).toBe(roadpost.map); expect(ghost.map).toBe(facade.map);
  expect(facade.vertexColors).toBe(true);
  expect(roadpost.vertexColors).toBe(false); // Plain roadpost planes have no colour attribute.
  const freed = vi.fn(); facade.map!.addEventListener("dispose", freed);
  facade.dispose(); roadpost.dispose(); expect(freed).not.toHaveBeenCalled();
  ghost.dispose(); expect(freed).toHaveBeenCalledOnce();
});
