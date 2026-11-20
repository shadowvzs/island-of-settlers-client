import { type BufferGeometry, CatmullRomCurve3, Vector3 } from "three";

import type { OrnamentalLimb } from "../../../render-common/plants/ornamental-tree-graph";

/** Match lighting across an embedded woody bearing without adding collars, gaps or extra faces. */
export const softenPeachBranchBearing = (geometry: BufferGeometry, limb: OrnamentalLimb,
  parent: OrnamentalLimb | undefined) => {
  if (!parent || limb.role !== "branch" || limb.radius <= .045 || parent.radius <= .07) return;
  const path = new CatmullRomCurve3(parent.path.map(point => new Vector3(...point))).getSpacedPoints(32);
  const position = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const point = new Vector3(), from = new Vector3(...limb.path[0]!), candidate = new Vector3();
  const direction = new Vector3(), offset = new Vector3(), radial = new Vector3(), normal = new Vector3();
  const maximumReach = parent.radius * 2 + limb.radius;
  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index);
    if (point.distanceToSquared(from) > maximumReach * maximumReach) continue;
    let nearest = Infinity, along = 0;
    for (let segment = 0; segment < path.length - 1; segment++) {
      direction.subVectors(path[segment + 1]!, path[segment]!);
      const lengthSquared = direction.lengthSq();
      if (lengthSquared < 1e-12) continue;
      const t = Math.max(0, Math.min(1, offset.subVectors(point, path[segment]!).dot(direction) / lengthSquared));
      candidate.copy(path[segment]!).addScaledVector(direction, t);
      const distance = point.distanceToSquared(candidate);
      if (distance < nearest) {
        nearest = distance; along = (segment + t) / (path.length - 1); radial.subVectors(point, candidate);
      }
    }
    const radius = parent.radius * (1 - along) ** .95 + parent.tipRadius * along;
    const blend = Math.max(0, 1 - Math.abs(Math.sqrt(nearest) - radius) / (limb.radius * .45));
    if (blend <= 0 || radial.lengthSq() < 1e-12) continue;
    normal.fromBufferAttribute(normals, index).lerp(radial.normalize(), blend).normalize();
    normals.setXYZ(index, normal.x, normal.y, normal.z);
  }
};
