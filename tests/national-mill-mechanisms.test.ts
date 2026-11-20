import { Mesh, Vector3 } from "three";
import { expect, it } from "vitest";

import { ROMAN_MILL_ROTOR_HALF_DEPTH, ROMAN_MILL_ROTOR_RADIUS } from "../src/render-common/buildings/roman-mill-dimensions";
import { createNationalMillMechanism } from "../src/renderers/three/buildings/national-mill-mechanism";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it("fits all seven national rotors in the existing sail sweep even after construction restores unit scale", () => {
  const materials = createPlainBuildingMaterials();
  const point = new Vector3();
  for (const nation of ["viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"] as const)
    for (const detailed of [true, false]) {
      const rotor = createNationalMillMechanism(materials, detailed, nation);
      expect(rotor.scale.toArray()).toEqual([1, 1, 1]);
      rotor.updateMatrixWorld(true);
      let radius = 0, meshes = 0;
      rotor.traverse(object => {
        if (!(object instanceof Mesh)) return;
        meshes++;
        const positions = object.geometry.getAttribute("position");
        for (let vertex = 0; vertex < positions.count; vertex++) {
          point.fromBufferAttribute(positions, vertex).applyMatrix4(object.matrixWorld);
          radius = Math.max(radius, Math.hypot(point.x, point.y));
          expect(Math.abs(point.z)).toBeLessThanOrEqual(ROMAN_MILL_ROTOR_HALF_DEPTH + .00001);
        }
        object.geometry.dispose();
        if (object.userData.ownedMaterial) object.material.dispose();
      });
      expect(radius).toBeLessThanOrEqual(ROMAN_MILL_ROTOR_RADIUS);
      expect(radius).toBeGreaterThan(ROMAN_MILL_ROTOR_RADIUS * .94);
      expect(meshes).toBeLessThanOrEqual(5);
    }
  Object.values(materials).forEach(material => material.dispose());
});
