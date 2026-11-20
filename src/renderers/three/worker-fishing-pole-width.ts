import { Box3, type BufferAttribute, Float32BufferAttribute, type Mesh, type Object3D,Vector3 } from "three";

/** Widen the original tapered shaft while keeping its length, bend centerline and wrapped grip. */
export const thickenFishingPole = (root: Object3D) => {
  const pole = root.getObjectByName("fishing_pole") as Mesh | undefined;
  if (!pole?.isMesh || pole.userData.boldShaft) return;
  const geometry = pole.geometry;
  const packed = geometry.getAttribute("position");
  const center = new Box3().setFromBufferAttribute(packed as BufferAttribute).getCenter(new Vector3());
  const values = new Float32Array(packed.count * 3);
  for (let vertex = 0; vertex < packed.count; vertex++) {
    values[vertex * 3] = packed.getX(vertex); values[vertex * 3 + 1] = packed.getY(vertex);
    values[vertex * 3 + 2] = packed.getZ(vertex);
  }
  // Exported positions may be normalized integers; widen decoded values without re-quantizing.
  const positions = new Float32BufferAttribute(values, 3);
  geometry.setAttribute("position", positions);
  const morphs = geometry.morphAttributes.position ?? [];
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const dx = (positions.getX(vertex) - center.x) * .3;
    const dz = (positions.getZ(vertex) - center.z) * .3;
    positions.setX(vertex, positions.getX(vertex) + dx);
    positions.setZ(vertex, positions.getZ(vertex) + dz);
    if (geometry.morphTargetsRelative) continue;
    for (const morph of morphs) {
      morph.setX(vertex, morph.getX(vertex) + dx);
      morph.setZ(vertex, morph.getZ(vertex) + dz);
    }
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");
  geometry.morphAttributes.normal = morphs.map(morph => {
    const target = geometry.clone(), targetPositions = positions.clone();
    for (let vertex = 0; vertex < positions.count; vertex++) {
      if (geometry.morphTargetsRelative) {
        targetPositions.setXYZ(vertex, positions.getX(vertex) + morph.getX(vertex),
          positions.getY(vertex) + morph.getY(vertex), positions.getZ(vertex) + morph.getZ(vertex));
      } else targetPositions.setXYZ(vertex, morph.getX(vertex), morph.getY(vertex), morph.getZ(vertex));
    }
    target.setAttribute("position", targetPositions); target.computeVertexNormals();
    const targetNormals = target.getAttribute("normal").clone();
    if (geometry.morphTargetsRelative) for (let vertex = 0; vertex < normals.count; vertex++) {
      targetNormals.setXYZ(vertex, targetNormals.getX(vertex) - normals.getX(vertex),
        targetNormals.getY(vertex) - normals.getY(vertex), targetNormals.getZ(vertex) - normals.getZ(vertex));
    }
    target.dispose(); return targetNormals;
  });
  positions.needsUpdate = true;
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  pole.userData.boldShaft = true;
};
