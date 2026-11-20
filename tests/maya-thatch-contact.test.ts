import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createMayaThatchRoof } from "../src/renderers/three/buildings/maya-thatch-roof";
import { createRoofEndInfill } from "../src/renderers/three/buildings/roman-occupation-roof";

it("seats every Maya thatch end-panel top inside its actual opaque roof shell in both qualities", () => {
  let checked = 0;
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    const recipe = createNationBuildingRecipe(definition, "maya", detailed);
    for (const infill of recipe.parts.filter(part => part.shape === "roof-infill" && (part.plantRoofStyle || part.surface === "straw"))) {
      const roof = recipe.parts.find(part => part.shape === "occupation-roof" && (part.plantRoofStyle || part.surface === "straw")
        && Math.abs(part.position[0] - infill.position[0]) < 1e-6
        && Math.abs(part.position[2] - infill.position[2]) < 1e-6
        && Math.abs(part.position[1] - infill.position[1] - .001) < 1e-6);
      expect(roof, `${definition.id}: end panel needs its paired roof`).toBeDefined();
      const shell = createMayaThatchRoof(roof!, detailed);
      // Ignore loose straw: structural contact must exist against the actual closed weather core.
      shell.setDrawRange(0, shell.userData.thatch.coreVertices);
      const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(shell, material);
      mesh.updateMatrixWorld(true);
      const panel = createRoofEndInfill(infill, detailed), positions = panel.getAttribute("position");
      for (let vertex = 0; vertex < positions.count; vertex++) {
        if (positions.getY(vertex) <= -.49999) continue;
        const point = new Vector3(positions.getX(vertex) * infill.size[0] / roof!.size[0],
          (positions.getY(vertex) * infill.size[1] + infill.position[1] - roof!.position[1]) / roof!.size[1],
          positions.getZ(vertex) * infill.size[2] / roof!.size[2]);
        const hits = new Raycaster(new Vector3(point.x, 1, point.z), new Vector3(0, -1, 0))
          .intersectObject(mesh);
        const label = `${definition.id}/${detailed ? "High" : "Minimal"}/${point.toArray().join(",")}`;
        expect(hits.length, `${label}: end panel must sit beneath opaque core, not loose fringe`).toBeGreaterThanOrEqual(2);
        expect(point.y, `${label}: no daylight below shell`).toBeGreaterThanOrEqual(hits.at(-1)!.point.y - 1e-5);
        expect(point.y, `${label}: panel must stay below roof exterior`).toBeLessThanOrEqual(hits[0]!.point.y + 1e-5);
      }
      checked++; panel.dispose(); shell.dispose(); material.dispose();
    }
  }
  // Hip thatch closes with its own weather core; only raised ends and prototype covers keep panels.
  expect(checked).toBeGreaterThan(30);
});
