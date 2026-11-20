import type { BufferGeometry } from "three";

/** Physical edge wear stays inside the authored solid; consistent world-scale mineral UVs avoid stretched wedges. */
export const finishRoadDecorationStoneGeometry = (geometry: BufferGeometry, detailed: boolean, wearEdges = true) => {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const middle = [0, 1, 2].map(axis => (bounds.min.getComponent(axis) + bounds.max.getComponent(axis)) / 2);
  for (let index = 0; index < positions.count; index++) {
    const point = [positions.getX(index), positions.getY(index), positions.getZ(index)];
    if (detailed && wearEdges) {
      const edgeAxes = point.map((value, axis) => Math.min(Math.abs(value - bounds.min.getComponent(axis)),
        Math.abs(value - bounds.max.getComponent(axis))) < .013);
      const chip = Math.sin(point[0]! * 97.3 + point[1]! * 131.7 + point[2]! * 83.1);
      const wear = edgeAxes.filter(Boolean).length >= 2 && chip > .32 ? .0015 + (chip - .32) * .005 : 0;
      for (let axis = 0; axis < 3; axis++)
        point[axis]! -= edgeAxes[axis] ? Math.sign(point[axis]! - middle[axis]!) * wear : 0;
      positions.setXYZ(index, point[0]!, point[1]!, point[2]!);
    }
    const nx = Math.abs(normals.getX(index)), ny = Math.abs(normals.getY(index)), nz = Math.abs(normals.getZ(index));
    // One tile is half a world unit; block joints are real geometry, never a second rectangular grid.
    if (ny > nx && ny > nz) uv.setXY(index, point[0]! * 2, point[2]! * 2);
    else if (nx > nz) uv.setXY(index, point[2]! * 2, point[1]! * 2);
    else uv.setXY(index, point[0]! * 2, point[1]! * 2);
  }
  positions.needsUpdate = true; uv.needsUpdate = true;
  if (detailed && wearEdges) geometry.computeVertexNormals();
};
