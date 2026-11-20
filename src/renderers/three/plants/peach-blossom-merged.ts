import { BufferGeometry, Color, type ColorRepresentation, Euler, Float32BufferAttribute, Matrix3, Matrix4, Quaternion, Uint32BufferAttribute, Vector3 } from "three";

import type { OrnamentalBlossom } from "../../../render-common/plants/ornamental-tree-graph";

/** Bake canonical surfaces once per variant for the flat decoration-instancing template contract. */
export const mergePeachBlossomSurface = (flowers: readonly OrnamentalBlossom[], source: BufferGeometry, colour?: ColorRepresentation) => {
  const unit = source, tint = new Color(colour ?? "#ffffff");
  const sourcePosition = unit.getAttribute("position"), sourceNormal = unit.getAttribute("normal");
  const sourceColour = unit.getAttribute("color"), sourceUv = unit.getAttribute("uv");
  const count = sourcePosition.count * flowers.length;
  const indexCount = source.index?.count ?? sourcePosition.count;
  const indices = new Uint32Array(indexCount * flowers.length);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  const point = new Vector3(), normal = new Vector3(), position = new Vector3(), scale = new Vector3();
  const quaternion = new Quaternion(), rotation = new Euler(0, 0, 0, "YXZ"), matrix = new Matrix4(), normalMatrix = new Matrix3();
  let target = 0, targetIndex = 0;
  for (const flower of flowers) {
    const vertexOffset = target;
    quaternion.setFromEuler(rotation.set(flower.pitch, flower.yaw, 0, "YXZ"));
    matrix.compose(position.set(...flower.position), quaternion, scale.setScalar(flower.radius));
    normalMatrix.getNormalMatrix(matrix);
    for (let index = 0; index < sourcePosition.count; index++, target++) {
      point.fromBufferAttribute(sourcePosition, index).applyMatrix4(matrix).toArray(positions, target * 3);
      normal.fromBufferAttribute(sourceNormal, index).applyMatrix3(normalMatrix).normalize().toArray(normals, target * 3);
      colours[target * 3] = sourceColour.getX(index) * tint.r; colours[target * 3 + 1] = sourceColour.getY(index) * tint.g;
      colours[target * 3 + 2] = sourceColour.getZ(index) * tint.b;
      uvs[target * 2] = sourceUv.getX(index); uvs[target * 2 + 1] = sourceUv.getY(index);
    }
    for (let index = 0; index < indexCount; index++)
      indices[targetIndex++] = vertexOffset + (source.index?.getX(index) ?? index);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
