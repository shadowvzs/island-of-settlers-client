import { Group, Mesh, MeshStandardMaterial } from "three";

import type { BuildingSurface } from "../../render-common/buildings/building-recipe";
import { createHangingLanternRoadRecipe, type HangingLanternNation } from "../../render-common/road-decoration-hanging-lanterns";
import { createRoadDecorationModel } from "./road-decoration-model";

/** One shared neutral surface per template preserves the canonical paper/silk vertex colours. */
export const createHangingLanternRoadModel = (nation: HangingLanternNation, detailed: boolean,
  materials: Record<BuildingSurface, MeshStandardMaterial>) => {
  const recipe = createHangingLanternRoadRecipe(nation, detailed);
  const paper = new MeshStandardMaterial({ roughness: .9, vertexColors: true });
  const frame = createRoadDecorationModel(recipe.frame, materials, detailed);
  const fittings = createRoadDecorationModel(recipe.fittings, { ...materials, paint: paper }, detailed);
  const root = new Group(); root.name = recipe.definition.id;
  // Runtime decoration batching consumes direct meshes, not the showcase's nested groups.
  // Source owners retain the original meshes so their normal disposal still releases geometry once.
  for (const source of [frame.root, fittings.root])
    for (const part of source.children) if (part instanceof Mesh) {
      const mesh = part.clone();
      if (source === fittings.root && part.name === "paint") mesh.name = "hanging_lantern_paper";
      root.add(mesh);
    }
  let disposed = false;
  return { root, triangles: frame.triangles + fittings.triangles, dispose: () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear(); frame.dispose(); fittings.dispose(); paper.dispose();
  } };
};
