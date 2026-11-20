import { InstancedMesh, type Matrix4, MeshStandardMaterial } from "three";

import { createHeldGrapeBunchMesh } from "../../../render-common/props/drink-crops/grapevine-mesh";
import { createPropGeometry } from "../three-props";

export const createThreeHarvestGrapes = (detailed: boolean) => {
  const geometry = createPropGeometry(createHeldGrapeBunchMesh(detailed));
  const material = new MeshStandardMaterial({ roughness: 0.7, vertexColors: true });
  const mesh = new InstancedMesh(geometry, material, 32);
  mesh.name = "winegrower_held_grapes";
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = detailed;
  let count = 0;
  return {
    mesh,
    begin: () => {
      count = 0;
    },
    push: (matrix: Matrix4) => {
      if (count < 32) mesh.setMatrixAt(count++, matrix);
    },
    commit: () => {
      mesh.count = count;
      mesh.visible = count > 0;
      if (count) mesh.instanceMatrix.needsUpdate = true;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };
};
