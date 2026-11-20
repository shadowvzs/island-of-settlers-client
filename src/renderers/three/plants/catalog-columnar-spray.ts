import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from "three";

import type { CatalogConiferSpray } from "../../../render-common/plants/catalog-columnar-graph";

/** Connected curved, pointed branchlet volumes fill the scale-bearing interior of each conifer spray. */
export const createCatalogColumnarSpray = (spray: CatalogConiferSpray, detailed: boolean, seed: number) => {
  const rings = 2, sides = 3, fingers = detailed ? 3 : 2;
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], uv: number[] = [];
  const indices: number[] = [];
  for (let finger = 0; finger < fingers; finger++) {
    const spread = (finger / (fingers - 1) - .5) * spray.width * 1.35;
    const yaw = seed * 2.399;
    const path = spray.path.map((point, i) => new Vector3(point[0] + Math.cos(yaw) * spread * i / 2,
      point[1] - (finger % 2) * .018 * i / 2, point[2] + Math.sin(yaw) * spread * i / 2));
    const curve = new CatmullRomCurve3(path), frames = curve.computeFrenetFrames(rings, false);
    const offset = positions.length / 3;
    for (let ring = 0; ring <= rings; ring++) {
      const t = ring / rings, centre = curve.getPointAt(t);
      let radius = Math.sin(t * Math.PI) * spray.width * .27;
      if (ring === 0) radius = .004;
      if (ring === rings) radius = 0;
      for (let side = 0; side <= sides; side++) {
        const angle = side / sides * Math.PI * 2;
        const normal = frames.normals[ring]!.clone().multiplyScalar(Math.cos(angle))
          .addScaledVector(frames.binormals[ring]!, Math.sin(angle));
        const point = centre.clone().addScaledVector(normal, radius);
        positions.push(...point.toArray()); normals.push(...normal.toArray());
        const shade = .79 + .19 * Math.sin(seed * 2.13 + angle + t * 3) ** 2;
        colours.push(shade, shade, shade); uv.push(side / sides, t);
        if (ring >= rings || side >= sides) continue;
        const a = offset + ring * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  return geometry;
};
