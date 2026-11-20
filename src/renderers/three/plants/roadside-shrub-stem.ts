import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from "three";

import type { OrnamentalLimb } from "../../../render-common/plants/ornamental-tree-graph";

/** Seven main young stems get continuous curvature and smooth taper, without trunk tessellation. */
export const createShrubStemGeometry = (limb: OrnamentalLimb, detailed: boolean) => {
  const curve = new CatmullRomCurve3(limb.path.map(point => new Vector3(...point)));
  const twig = limb.role === "twig";
  let rings = detailed ? 5 : 2, sides = detailed ? 5 : 4;
  if (twig) { rings = 3; sides = 3; }
  const frames = curve.computeFrenetFrames(rings, false);
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings, centre = curve.getPointAt(t);
    const radius = limb.radius + (limb.tipRadius - limb.radius) * t;
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const normal = frames.normals[ring]!.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(frames.binormals[ring]!, Math.sin(angle));
      positions.push(...centre.clone().addScaledVector(normal, radius).toArray()); normals.push(...normal.toArray());
      colours.push(.91, .90, .85); uvs.push(side / sides, t);
      if (ring >= rings || side >= sides) continue;
      const a = ring * (sides + 1) + side, b = a + sides + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  for (const end of [0, rings]) {
    const centre = curve.getPointAt(end / rings), normal = frames.tangents[end]!.clone();
    if (end === 0) normal.negate();
    const offset = positions.length / 3;
    positions.push(...centre.toArray()); normals.push(...normal.toArray()); colours.push(.8, .76, .65); uvs.push(.5, .5);
    for (let side = 0; side <= sides; side++) {
      const at = (end * (sides + 1) + side) * 3;
      positions.push(positions[at]!, positions[at + 1]!, positions[at + 2]!);
      normals.push(...normal.toArray()); colours.push(.86, .82, .73);
      const angle = side / sides * Math.PI * 2;
      uvs.push(.5 + Math.cos(angle) * .48, .5 + Math.sin(angle) * .48);
      if (side >= sides) continue;
      if (end === 0) indices.push(offset, offset + side + 2, offset + side + 1);
      else indices.push(offset, offset + side + 1, offset + side + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
