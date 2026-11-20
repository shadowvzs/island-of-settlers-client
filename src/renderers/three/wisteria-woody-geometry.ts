import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from "three";

export type WisteriaWoodPoint = readonly [number, number, number];

/** Continuous old wood, with true taper, unequal swellings and longitudinal bark UVs across joints. */
export const createWisteriaWoodyGeometry = (path: readonly WisteriaWoodPoint[], baseRadius: number,
  tipRadius: number, segments = 36, sides = 10, grounded = false) => {
  const curve = new CatmullRomCurve3(path.map(point => new Vector3(...point))), length = curve.getLength();
  const frame = curve.computeFrenetFrames(segments, false), positions: number[] = [], normals: number[] = [];
  const uvs: number[] = [], colours: number[] = [], indices: number[] = [];
  for (let ring = 0; ring <= segments; ring++) {
    const t = ring / segments, centre = curve.getPointAt(t);
    const swelling = 1 + .25 * Math.exp(-(((t - .22) / .06) ** 2)) +
      .15 * Math.exp(-(((t - .63) / .08) ** 2)) + .04 * Math.sin(t * 13 + baseRadius * 27);
    const radius = (baseRadius * (1 - t) ** 1.25 + tipRadius * t) * swelling;
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2, ridge = 1 + .06 * Math.sin(angle * 3 + t * 11);
      const direction = frame.normals[ring]!.clone().multiplyScalar(Math.cos(angle))
        .addScaledVector(frame.binormals[ring]!, Math.sin(angle));
      const at = centre.clone().addScaledVector(direction, radius * ridge);
      if (grounded) at.y = Math.max(0, at.y);
      positions.push(at.x, at.y, at.z); normals.push(direction.x, direction.y, direction.z);
      uvs.push(side / sides * 2, t * length * 1.7);
      const shade = .90 + .09 * Math.cos(angle * 2 + t * 7); colours.push(shade, shade, shade);
      if (ring < segments && side < sides) {
        const a = ring * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
