import { CylinderGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from "three";

import type { OrnamentalLimb } from "../../../render-common/plants/ornamental-tree-graph";
import type { GardenTreeLeaf } from "../../../render-common/plants/roman-garden-tree-graph";

export const willowWoodTopology = (limb: OrnamentalLimb, detailed: boolean, far: boolean) => {
  if (far) return { rings: 2, sides: 4 };
  if (limb.role === "trunk") return { rings: detailed ? 18 : 10, sides: detailed ? 12 : 7 };
  if (limb.role === "root") return { rings: detailed ? 5 : 3, sides: detailed ? 5 : 3 };
  if (limb.role === "twig") return { rings: detailed ? 4 : 3, sides: 3 };
  if (limb.radius >= .07) return { rings: detailed ? 10 : 6, sides: detailed ? 8 : 5 };
  if (limb.radius >= .035) return { rings: detailed ? 8 : 5, sides: detailed ? 6 : 4 };
  return { rings: detailed ? 6 : 4, sides: detailed ? 5 : 3 };
};

/** Six actual tapered side facets join an authored wood node to the precise blade base.
 * Both ends enter their supporting surfaces, so separate cap discs would be hidden triangles.
 */
export const createWillowPetioleGeometry = (leaf: GardenTreeLeaf) => {
  if (!leaf.petiole) return undefined;
  const start = new Vector3(...leaf.petiole.node), end = new Vector3(...leaf.position);
  const direction = end.clone().sub(start);
  const geometry = new CylinderGeometry(leaf.petiole.radius * .65, leaf.petiole.radius,
    direction.length(), 3, 1, true);
  const pose = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  const matrix = new Matrix4().makeRotationFromQuaternion(pose);
  matrix.setPosition(start.add(end).multiplyScalar(.5)); geometry.applyMatrix4(matrix);
  const colours = new Float32Array(geometry.getAttribute("position").count * 3).fill(1);
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  return geometry;
};
