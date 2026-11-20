import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BoxGeometry, CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { createNationBuildingRecipe } from "../../src/render-common/buildings/nation-building-recipe";
import { rotateByEuler } from "../../src/render-common/buildings/recipe-rotation";
import { createIndigenousRoofGeometry } from "../../src/renderers/three/buildings/indigenous-roof-geometry";

const records = [];
for (const detailed of [true, false]) {
  const recipe = createNationBuildingRecipe(BUILDING_CATALOG.find(item => item.id === 18)!, "indigenous", detailed);
  const roof = recipe.parts.find(part => part.indigenousRoof === "barrel")!;
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const shell = new Mesh(createIndigenousRoofGeometry("barrel", detailed), material);
  shell.scale.set(...roof.size); shell.position.set(...roof.position);
  shell.rotation.set(...(roof.rotation ?? [0, 0, 0])); shell.updateMatrixWorld(true);
  const hits = [];
  for (const [index, part] of recipe.parts.entries()) {
    if (part.surface !== "wood" || part.stock || !["box", "cylinder"].includes(part.shape)) continue;
    const geometry = part.shape === "box" ? new BoxGeometry(1, 1, 1)
      : new CylinderGeometry(.5, .5, 1, part.radialSegments ?? (detailed ? 8 : 4));
    const positions = geometry.getAttribute("position"), protrusions = [];
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const local = rotateByEuler([positions.getX(vertex) * part.size[0], positions.getY(vertex) * part.size[1],
        positions.getZ(vertex) * part.size[2]], part.rotation ?? [0, 0, 0]);
      const point = new Vector3(...part.position).add(new Vector3(...local));
      const projected = new Raycaster(new Vector3(point.x, 10, point.z), new Vector3(0, -1, 0)).intersectObject(shell);
      if (!projected.length || point.y < projected[0]!.point.y + .002 || point.y > roof.position[1] + roof.size[1] / 2 + .1)
        continue;
      protrusions.push({ vertex: point.toArray(), roofY: projected[0]!.point.y,
        penetration: point.y - projected[0]!.point.y });
    }
    if (protrusions.length) hits.push({ index, shape: part.shape, position: part.position,
      size: part.size, rotation: part.rotation, stage: part.stage, protrusions });
    geometry.dispose();
  }
  records.push({ detailed, roof, hits }); shell.geometry.dispose(); material.dispose();
}
const path = resolve("../resources/project-reviews/nation-expansion-current/indigenous/varied-textiles/fishery-roof-contact.json");
writeFileSync(path, JSON.stringify(records, null, 2));
console.log(JSON.stringify(records));
