import type { Random } from "../../../shared/world/rng";
import { MeshBuilder, type Vec3, type VertexStyle } from "../mesh-builder";

/** Ribbed succulent flesh, including its rounded crown and smoothly rising branch elbows. */
const addStem = (builder: MeshBuilder, points: Vec3[], radii: number[], ribs: number, style: VertexStyle) => {
  const sides = ribs * 2, first = builder.vertexCount;
  for (let ring = 0; ring < points.length; ring++) {
    const point = points[ring]!, previous = points[Math.max(0, ring - 1)]!;
    const next = points[Math.min(points.length - 1, ring + 1)]!;
    const dx = next[0] - previous[0], dy = next[1] - previous[1], length = Math.hypot(dx, dy) || 1;
    const nx = dy / length, ny = -dx / length;
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
      const radius = radii[ring]! * (.91 + .09 * Math.cos(angle * ribs));
      builder.addVertex([point[0] + nx * c * radius, point[1] + ny * c * radius, point[2] + s * radius],
        [nx * c, ny * c, s], style);
    }
  }
  for (let ring = 0; ring < points.length - 1; ring++) for (let side = 0; side < sides; side++) {
    const a = first + ring * (sides + 1) + side, b = a + sides + 1;
    builder.addTriangle(a, b, a + 1); builder.addTriangle(a + 1, b, b + 1);
  }
};

/** Small pale woolly areoles and radial spines; all disappear in the inexpensive distant LOD. */
const addSpines = (builder: MeshBuilder, points: Vec3[], radii: number[], ribs: number) => {
  builder.detail = true;
  const thorn: VertexStyle = { flutter: 0, color: () => [.72, .65, .44] };
  for (let row = 1; row < 8; row++) for (let side = 0; side < ribs; side++) {
    const angle = side / ribs * Math.PI * 2, x = Math.cos(angle), z = Math.sin(angle);
    const along = row / 9 * 4, ring = Math.floor(along), t = along - ring;
    const first = points[ring]!, next = points[ring + 1]!;
    const y = first[1] + (next[1] - first[1]) * t;
    const centreX = first[0] + (next[0] - first[0]) * t;
    const radius = radii[ring]! + (radii[ring + 1]! - radii[ring]!) * t, reach = radius + .023;
    for (const tilt of [-1, 1]) {
      const root: Vec3 = [centreX + x * radius, y, z * radius];
      const a = builder.addVertex([root[0] - z * .005, y - .005, root[2] + x * .005], [x, 0, z], thorn);
      const b = builder.addVertex([root[0] + z * .005, y + .005, root[2] - x * .005], [x, 0, z], thorn);
      const c = builder.addVertex([centreX + x * reach, y + tilt * .02, z * reach], [x, 0, z], thorn);
      builder.addTriangle(a, b, c);
    }
  }
};

/** Two modest column cacti and a short barrel cactus; palms remain the desert's tall silhouettes. */
export const createCactus = (random: Random, variant: number) => {
  const builder = new MeshBuilder(), barrel = variant === 2;
  const height = barrel ? .37 + random() * .09 : .72 + random() * .24;
  const radius = barrel ? .23 : .09 + random() * .025, ribs = barrel ? 10 : 8;
  const flesh: VertexStyle = { flutter: 0, color: (point, normal) => {
    const angle = Math.atan2(normal[2], normal[0]), ridge = .84 + .16 * Math.cos(angle * ribs);
    const cork = Math.max(0, 1 - point[1] / (height * .17));
    const mottling = .97 + .03 * Math.sin(point[1] * 61 + angle * 13);
    return [(0.24 + cork * .14) * ridge * mottling,
      (.43 - cork * .12) * ridge * mottling, (.22 - cork * .06) * ridge * mottling];
  } };
  const points: Vec3[] = [], radii: number[] = [], lean = (random() - .5) * .055;
  const shoulder = height - radius * .82;
  for (let ring = 0; ring <= 4; ring++) {
    const t = ring / 4;
    points.push([lean * t * t, shoulder * t, 0]);
    radii.push(radius * (barrel ? .62 + .38 * Math.sin(t * Math.PI * .65) : 1.08 - t * .12));
  }
  for (let ring = 1; ring <= 3; ring++) {
    const angle = ring / 3 * Math.PI / 2;
    points.push([lean, shoulder + Math.sin(angle) * radius * .82, 0]);
    radii.push(Math.max(.0004, Math.cos(angle) * radius * .94));
  }
  addStem(builder, points, radii, ribs, flesh);
  if (!barrel) for (const side of variant === 0 ? [-1, 1] : [-1]) {
    const y = height * (side < 0 ? .39 : .56), reach = side * (.18 + random() * .055);
    const armRadius = radius * .65, top = y + height * (.26 + random() * .12);
    const arm: Vec3[] = [[0, y, 0], [reach * .43, y + .015, 0], [reach * .83, y + .055, 0],
      [reach, y + .13, 0], [reach, top - armRadius, 0],
      [reach, top - armRadius * .3, 0], [reach, top, 0]];
    addStem(builder, arm, [armRadius * .9, armRadius, armRadius, armRadius,
      armRadius * .93, armRadius * .65, .0004], 6, flesh);
  }
  addSpines(builder, points, radii, ribs);
  const result = builder.finish({ contactRadius: radius * .85 });
  result.wind.fill(0);
  return result;
};
