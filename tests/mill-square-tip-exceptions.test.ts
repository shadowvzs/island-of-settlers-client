import { BoxGeometry, Mesh } from "three";
import { expect, it } from "vitest";

import { ROMAN_MILL_ROTOR_SCALE } from "../src/render-common/buildings/roman-mill-dimensions";
import { createNationalMillMechanism } from "../src/renderers/three/buildings/national-mill-mechanism";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

it.each([true, false])("restores actual Roman and Viking straight cloth ends and Roman timber at detail %s", detailed => {
  const materials = createPlainBuildingMaterials();
  for (const nation of ["roman", "viking"] as const) {
    const root = createNationalMillMechanism(materials, detailed, nation);
    try {
      const cloth = nation === "roman" ? root.getObjectByName("mill_cloth_sail_0") as Mesh :
        root.children.find(child => child instanceof Mesh && child.userData.ownedMaterial) as Mesh;
      const positions = cloth.geometry.getAttribute("position");
      const top = (nation === "roman" ? .69 : 1.91) * ROMAN_MILL_ROTOR_SCALE;
      const topXs: number[] = [];
      for (let vertex = 0; vertex < positions.count; vertex++)
        if (Math.abs(positions.getY(vertex) - top) < 1e-6) topXs.push(positions.getX(vertex));
      expect(topXs.length).toBeGreaterThan(1);
      expect(Math.max(...topXs) - Math.min(...topXs)).toBeCloseTo(
        (nation === "roman" ? .42 : .40) * ROMAN_MILL_ROTOR_SCALE, 6);
      if (nation === "roman") {
        const frames = root.children.filter(child => child instanceof Mesh && child.geometry instanceof BoxGeometry &&
          child.geometry.parameters.width === .022 && child.geometry.parameters.height === 1.42);
        expect(frames).toHaveLength(8);
        const ribs = root.children.filter(child => child instanceof Mesh && child.geometry instanceof BoxGeometry &&
          child.geometry.parameters.width === .46 && child.geometry.parameters.height === .018);
        expect(ribs).toHaveLength(4 * (detailed ? 8 : 4));
      }
    } finally {
      root.traverse(child => { if (child instanceof Mesh) {
        child.geometry.dispose();
        if (child.userData.ownedMap) child.material.map?.dispose();
        if (child.userData.ownedMaterial) child.material.dispose();
      } });
    }
  }
  Object.values(materials).forEach(material => material.dispose());
});
