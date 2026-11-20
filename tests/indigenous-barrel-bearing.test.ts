import { BoxGeometry, CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { rotateByEuler } from "../src/render-common/buildings/recipe-rotation";
import { createIndigenousRoofGeometry } from "../src/renderers/three/buildings/indigenous-roof-geometry";

const boxContains = (part: BuildingPart, point: Vector3) => {
  const object = new Mesh(); object.scale.set(...part.size); object.position.set(...part.position);
  object.rotation.order = "ZYX";
  object.rotation.set(...(part.rotation ?? [0, 0, 0])); object.updateMatrixWorld(true);
  const local = object.worldToLocal(point.clone());
  return Math.max(Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)) < .500001;
};

it("keeps every actual barrel-frame vertex below the opaque membrane in both LODs", () => {
  const affected = new Set<number>();
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    const recipe = createNationBuildingRecipe(definition, "indigenous", detailed);
    for (const roof of recipe.parts.filter(part => part.indigenousRoof === "barrel")) {
      affected.add(definition.id);
      const material = new MeshBasicMaterial({ side: DoubleSide });
      const shell = new Mesh(createIndigenousRoofGeometry("barrel", detailed), material);
      shell.scale.set(...roof.size); shell.position.set(...roof.position);
      shell.rotation.set(...(roof.rotation ?? [0, 0, 0])); shell.updateMatrixWorld(true);
      const beams = recipe.parts.filter(part => part.surface === "wood" && part.shape === "box" && part.stage === 3);
      const posts = recipe.parts.filter(part => part.surface === "wood" && part.shape === "cylinder" && part.stage === 1);
      expect(posts.length).toBe(4);
      let checked = 0;
      for (const part of [...beams, ...posts]) {
        const geometry = part.shape === "box" ? new BoxGeometry(1, 1, 1)
          : new CylinderGeometry(.5, .5, 1, part.radialSegments ?? (detailed ? 8 : 4));
        const positions = geometry.getAttribute("position");
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const local = rotateByEuler([positions.getX(vertex) * part.size[0], positions.getY(vertex) * part.size[1],
            positions.getZ(vertex) * part.size[2]], part.rotation ?? [0, 0, 0]);
          const point = new Vector3(...part.position).add(new Vector3(...local));
          const hits = new Raycaster(new Vector3(point.x, 10, point.z), new Vector3(0, -1, 0)).intersectObject(shell);
          if (!hits.length) continue;
          expect(point.y, `${definition.id}/${detailed}/${point.toArray().join(",")}`)
            .toBeLessThanOrEqual(hits[0]!.point.y - .005);
          checked++;
        }
        geometry.dispose();
      }
      expect(checked).toBeGreaterThan(200);
      for (const post of posts) {
        const head = new Vector3(...post.position); head.y += post.size[1] / 2;
        expect(beams.some(beam => boxContains(beam, head)), "Real post head must enter a connected tie/rafter")
          .toBe(true);
      }
      const purlins = beams.filter(beam => Math.abs(beam.position[2] - roof.position[2]) < 1e-6
        && Math.abs(Math.abs(beam.position[0] - roof.position[0]) / roof.size[0] - .3) < 1e-6);
      expect(purlins.length).toBe(2);
      for (const purlin of purlins) for (const side of [-1, 1]) {
        const bearing = new Vector3(purlin.position[0], purlin.position[1] - .01,
          roof.position[2] + side * .42 * roof.size[2]);
        expect(beams.some(beam => beam !== purlin && boxContains(beam, bearing)),
          "Purlin underside must actually intersect its arched rafter, not merely overlap an AABB").toBe(true);
      }
      shell.geometry.dispose(); material.dispose();
    }
  }
  expect([...affected]).toEqual([18]);
});
