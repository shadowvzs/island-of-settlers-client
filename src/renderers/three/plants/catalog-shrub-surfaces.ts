import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

export class ShrubSurface {
  positions: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  vertex(point: Vector3, shade = 1, u = 0, v = 0) {
    const index = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z);
    this.colors.push(shade, shade, shade); this.uvs.push(u, v);
    return index;
  }
  geometry() {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices); geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  }
}
export const shrubStem = (surface: ShrubSurface, start: Vector3, end: Vector3,
  radius: number, sides = 5) => {
  const axis = end.clone().sub(start).normalize();
  const side = new Vector3(0, 0, 1).cross(axis).normalize();
  const up = axis.clone().cross(side).normalize();
  const offset = surface.positions.length / 3;
  for (let row = 0; row < 2; row++) for (let j = 0; j <= sides; j++) {
    const angle = j / sides * Math.PI * 2, width = radius * (row ? .58 : 1);
    const point = (row ? end : start).clone().addScaledVector(side, Math.cos(angle) * width)
      .addScaledVector(up, Math.sin(angle) * width);
    surface.vertex(point, .80 + Math.cos(angle) * .14, j / sides, row);
    if (!row || !j) continue;
    const a = offset + sides + 1 + j;
    surface.indices.push(a - sides - 2, a - 1, a, a - sides - 2, a, a - sides - 1);
  }
};
/** Folded, pointed lamina with real midrib and gently serrated/lobed silhouette. */
export const shrubLeaf = (surface: ShrubSurface, start: Vector3, yaw: number, length: number,
  width: number, kind: "oval" | "broad" | "needle" | "lobed", seed: number, detailed: boolean, compact = false) => {
  const direction = new Vector3(Math.cos(yaw), .20 + Math.sin(seed) * .32, Math.sin(yaw)).normalize();
  const lateral = new Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  let rows = detailed ? 6 : 4;
  if (compact) rows = detailed ? 3 : 2;
  const offset = surface.positions.length / 3;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const middle = start.clone().addScaledVector(direction, length * t);
    middle.y += Math.sin(t * Math.PI) * length * .13;
    let spread = Math.sin(t * Math.PI) ** .68 * width;
    if (kind === "needle") spread = Math.sin(t * Math.PI) ** .23 * width;
    if (kind === "lobed") spread *= row % 2 ? .58 : 1.25;
    if (kind === "broad") spread *= 1 + .12 * Math.sin(row * Math.PI * .9);
    for (let side = -1; side <= 1; side++) {
      const p = middle.clone().addScaledVector(lateral, side * spread);
      p.y -= Math.abs(side) * Math.sin(t * Math.PI) * width * .42;
      surface.vertex(p, side ? .78 + .12 * Math.sin(seed + row) : 1.13, (side + 1) / 2, t);
    }
    if (!row) continue;
    const a = offset + row * 3;
    surface.indices.push(a - 3, a, a - 2, a - 2, a, a + 1, a - 2, a + 1, a - 1,
      a - 1, a + 1, a + 2);
  }
};
/** Curved radial petal, deliberately dimensional even at the cheaper detail level. */
export const shrubPetal = (surface: ShrubSurface, center: Vector3, normal: Vector3,
  yaw: number, length: number, width: number, cup: number, detailed: boolean) => {
  const right = new Vector3(0, 0, 1).cross(normal).normalize();
  const up = normal.clone().cross(right);
  const radial = right.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(up, Math.sin(yaw));
  const lateral = normal.clone().cross(radial), offset = surface.positions.length / 3;
  const rows = detailed ? 4 : 3;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows, reach = length * t;
    for (let side = -1; side <= 1; side++) {
      const spread = Math.sin(t * Math.PI * .86) * width;
      const roundedReach = reach * (1 - Math.abs(side) * .13 * t ** 3);
      const point = center.clone().addScaledVector(radial, roundedReach).addScaledVector(lateral, side * spread)
        .addScaledVector(normal, cup * t * t + Math.abs(side) * spread * .22);
      surface.vertex(point, .65 + t * .43 - Math.abs(side) * .04, (side + 1) / 2, t);
    }
    if (!row) continue;
    const a = offset + row * 3;
    surface.indices.push(a - 3, a, a - 2, a - 2, a, a + 1, a - 2, a + 1, a - 1,
      a - 1, a + 1, a + 2);
  }
};
