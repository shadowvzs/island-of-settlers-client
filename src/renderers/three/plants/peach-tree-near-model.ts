import { type BufferGeometry, Group, Mesh, type MeshBasicMaterial } from "three";

import type { PeachTreeGraph } from "../../../render-common/plants/flowering-peach-graph";
import { createOrnamentalLeafGeometry } from "./ornamental-foliage-geometry";
import { createPeachWoodGeometry } from "./peach-bark-geometry";
import { mergePeachBlossomSurface } from "./peach-blossom-merged";
import type { PeachBlossomTreeTemplates } from "./peach-blossom-tree-templates";
import { createPeachCrownImpostorGeometry } from "./peach-crown-impostor";
import { createPeachCrownLayout, selectPeachCrownDetails } from "./peach-crown-layout";
import { mergePeachSurfaces, type PeachTreeMaterials } from "./peach-tree-model";

/** Normal production near: supported real3D wood/flowers/leaves around independently positioned crown captures. */
export const createPeachTreeNearModel = (graph: PeachTreeGraph, materials: PeachTreeMaterials,
  detailed: boolean, templates: PeachBlossomTreeTemplates, crowns: MeshBasicMaterial) => {
  const root = new Group(), selection = selectPeachCrownDetails(graph, detailed);
  const wood = [...selection.wood].map(index => {
    const limb = graph.limbs[index]!;
    const coarse = limb.role === "branch" && limb.radius <= .02 ? { ...limb, role: "twig" as const } : limb;
    const geometry = createPeachWoodGeometry(coarse, detailed && limb.radius > .035, index,
      limb.parent === null ? undefined : graph.limbs[limb.parent]);
    if (limb.radius <= .045) {
      const colour = geometry.getAttribute("color");
      for (let vertex = 0; vertex < colour.count; vertex++)
        colour.setXYZ(vertex, colour.getX(vertex) * 1.2, colour.getY(vertex) * .52, colour.getZ(vertex) * .43);
    }
    return geometry;
  });
  const flowers = [...selection.flowers].map(index => graph.blossoms[index]!);
  const heroFlowers = [...selection.heroFlowers].map(index => graph.blossoms[index]!);
  const canopyFlowers = [...selection.flowers].filter(index => !selection.heroFlowers.has(index)).map(index => graph.blossoms[index]!);
  const flowerSurfaces = (["petals", "calyx", "centre"] as const).flatMap(surface => [
    mergePeachBlossomSurface(heroFlowers, templates.hero[surface], templates.materials[surface].color),
    mergePeachBlossomSurface(canopyFlowers, templates.canopy[surface], templates.materials[surface].color)
  ]);
  const geometries: BufferGeometry[] = [mergePeachSurfaces(wood), mergePeachSurfaces(flowerSurfaces),
    mergePeachSurfaces([...selection.leaves].map(index => createOrnamentalLeafGeometry(graph.leaves[index]!, detailed))),
    createPeachCrownImpostorGeometry(createPeachCrownLayout(graph))];
  const meshMaterials = [materials.bark, materials.blossom, materials.foliage, crowns];
  const names = ["peach-core-wood", "peach-real-selected-flowers", "peach-real-selected-leaves", "peach-original-crown-masses"];
  geometries.forEach((geometry, index) => {
    const mesh = new Mesh(geometry, meshMaterials[index]); mesh.name = names[index]!;
    mesh.castShadow = detailed; mesh.receiveShadow = detailed && index !== 3;
    if (index === 3) mesh.customDepthMaterial = crowns.userData.peachDepthMaterial;
    root.add(mesh);
  });
  const triangles = geometries.reduce((sum, geometry) => sum + (geometry.index?.count ?? geometry.getAttribute("position").count) / 3, 0);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear(); geometries.forEach(geometry => geometry.dispose());
  };
  return { root, triangles, individualFlowers: flowers.length, representedFlowers: graph.blossoms.length,
    heroFlowers: heroFlowers.length, realLeaves: selection.leaves.size, realWoodLimbs: selection.wood.size, budgetPassed: triangles <= (detailed ? 24000 : 6000), dispose };
};
