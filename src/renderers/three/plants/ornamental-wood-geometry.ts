import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from "three";

import type { OrnamentalLimb } from "../../../render-common/plants/ornamental-tree-graph";

/** Closed, outward-facing tapered limbs; continuous wood replaces stacked cylinder fragments. */
export const createOrnamentalWoodGeometry = (limb: OrnamentalLimb, detailed: boolean, seed = 0,
  topology?: { rings: number; sides: number }) => {
  const curve = new CatmullRomCurve3(limb.path.map(point => new Vector3(...point)));
  let rings = detailed ? 18 : 9, sides = detailed ? 12 : 7;
  if (limb.role === "root") { rings = detailed ? 9 : 5; sides = detailed ? 8 : 5; }
  if (limb.role === "branch") { rings = detailed ? 12 : 7; sides = detailed ? 9 : 6; }
  if (limb.role === "twig") { rings = detailed ? 5 : 3; sides = detailed ? 5 : 3; }
  if (topology) { rings = topology.rings; sides = topology.sides; }
  const frames = curve.computeFrenetFrames(rings, false);
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], uvs: number[] = [], indices: number[] = [];
  const length = curve.getLength();
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings, centre = curve.getPointAt(t);
    const radius = limb.radius * (1 - t) ** .95 + limb.tipRadius * t;
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const normal = frames.normals[ring]!.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(frames.binormals[ring]!, Math.sin(angle));
      const irregularity = 1 + .065 * Math.sin(angle * 5 + t * 4 + seed) +
        .028 * Math.cos(angle * 9 - t * 7 + seed * .4);
      const vertex = centre.clone().addScaledVector(normal, radius * irregularity);
      positions.push(...vertex.toArray()); normals.push(...normal.toArray());
      const shade = .86 + .12 * Math.cos(angle * 3 + t * 4 + seed);
      colours.push(shade, shade, shade); uvs.push(side / sides, t * length * 4);
      if (ring < rings && side < sides) {
        const a = ring * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  for (const end of [0, rings]) {
    const offset = positions.length / 3, centre = curve.getPointAt(end / rings);
    const normal = frames.tangents[end]!.clone().multiplyScalar(end === 0 ? -1 : 1);
    positions.push(...centre.toArray()); normals.push(...normal.toArray());
    colours.push(.7, .65, .56); uvs.push(.5, .5);
    for (let side = 0; side <= sides; side++) {
      const vertex = (end * (sides + 1) + side) * 3;
      positions.push(positions[vertex]!, positions[vertex + 1]!, positions[vertex + 2]!);
      normals.push(...normal.toArray()); colours.push(.76, .70, .60);
      const angle = side / sides * Math.PI * 2;
      uvs.push(.5 + Math.cos(angle) * .48, .5 + Math.sin(angle) * .48);
      if (side < sides) {
        if (end === 0) indices.push(offset, offset + side + 2, offset + side + 1);
        else indices.push(offset, offset + side + 1, offset + side + 2);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
