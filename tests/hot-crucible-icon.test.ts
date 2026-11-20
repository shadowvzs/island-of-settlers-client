import { Box3, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { createHotCrucibleIconModel } from "../src/renderers/three/settlement/hot-crucible-icon-model";

/** Geometry/lighting contract only; 42px native visual acceptance remains separate. */
describe("hot crucible icon", () => {
  it("has an open thick shell, integrated lip and upward facing recessed molten surface", () => {
    const model = createHotCrucibleIconModel();
    const cup = model.root.getObjectByName("thick_refractory_cup_with_pour_lip") as Mesh;
    const liquid = model.root.getObjectByName("incandescent_molten_surface") as Mesh;
    const positions = cup.geometry.getAttribute("position"), normals = liquid.geometry.getAttribute("normal");
    let inner = false, outer = false, lip = false;
    for (let index = 0; index < positions.count; index++) {
      const radius = Math.hypot(positions.getX(index), positions.getZ(index));
      const y = positions.getY(index);
      if (y > .49 && radius > .24 && radius < .29) inner = true;
      if (y > .48 && radius > .30) outer = true;
      if (positions.getZ(index) > .35) lip = true;
      expect(y > .45 && radius < .20).toBe(false);
    }
    expect(inner && outer && lip).toBe(true);
    for (let index = 0; index < normals.count; index++) expect(normals.getY(index)).toBeGreaterThan(.9);
    const cupBounds = new Box3().setFromObject(cup), liquidBounds = new Box3().setFromObject(liquid);
    expect(liquidBounds.max.y).toBeLessThan(cupBounds.max.y - .08);
    expect((liquid.material as MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(1);
    expect(model.triangles()).toBeLessThan(2500); expect(model.recipe.tool).toBe(false);
    model.dispose();
  });
  it("releases owned geometries and materials", () => {
    const model = createHotCrucibleIconModel();
    let geometries = 0, materials = 0;
    model.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.geometry.addEventListener("dispose", () => geometries++);
      (object.material as MeshStandardMaterial).addEventListener("dispose", () => materials++);
    });
    model.dispose(); expect(geometries).toBe(3); expect(materials).toBe(3);
  });
});
