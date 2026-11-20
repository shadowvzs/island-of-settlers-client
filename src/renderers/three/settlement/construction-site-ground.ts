import { type Group, type InstancedMesh, Matrix4, type Mesh } from "three";

export interface ConstructionGround {
  sample: (x: number, z: number) => number;
  revision?: () => number;
}

/** Refit only when placement or terrain changes; original vertex/matrix arrays stay allocated. */
export const createConstructionGroundFitter = (
  root: Group, ground: ConstructionGround | undefined, surfaces: readonly Mesh[], stocks: readonly InstancedMesh[]
) => {
  if (!ground) return () => {};
  const positions = surfaces.map(mesh => ({ mesh, positions: mesh.geometry.getAttribute("position"),
    base: new Float32Array(mesh.geometry.getAttribute("position").array) }));
  const matrices = stocks.map(mesh => ({ mesh, base: new Float32Array(mesh.instanceMatrix.array) }));
  const matrix = new Matrix4();
  let previousX = NaN, previousY = NaN, previousZ = NaN, previousRotation = NaN, previousRevision = NaN;
  return () => {
    const { x, y, z } = root.position, rotation = root.rotation.y, revision = ground.revision?.() ?? 0;
    if (x === previousX && y === previousY && z === previousZ && rotation === previousRotation && revision === previousRevision) return;
    previousX = x; previousY = y; previousZ = z; previousRotation = rotation; previousRevision = revision;
    const cosine = Math.cos(rotation), sine = Math.sin(rotation);
    const elevation = (localX: number, localZ: number) =>
      ground.sample(x + localX * cosine + localZ * sine, z - localX * sine + localZ * cosine) - y;
    for (const entry of positions) {
      for (let vertex = 0; vertex < entry.positions.count; vertex++) {
        const offset = vertex * 3;
        entry.positions.setY(vertex, entry.base[offset + 1]! + elevation(entry.base[offset]!, entry.base[offset + 2]!));
      }
      entry.positions.needsUpdate = true;
      entry.mesh.geometry.computeBoundingBox();
      entry.mesh.geometry.computeBoundingSphere();
    }
    for (const entry of matrices) {
      for (let slot = 0; slot < entry.mesh.userData.capacity; slot++) {
        matrix.fromArray(entry.base, slot * 16);
        matrix.elements[13] = entry.base[slot * 16 + 13]! + elevation(matrix.elements[12]!, matrix.elements[14]!);
        entry.mesh.setMatrixAt(slot, matrix);
      }
      entry.mesh.instanceMatrix.needsUpdate = true;
    }
  };
};
