import { BufferGeometry, Float32BufferAttribute } from "three";

import type { RoadProfilePart } from "../../render-common/road-decoration-recipe";

/** Closed continuous profiles keep timber/stone members from reading as a stack of floating primitives. */
export const createRoadDecorationProfile = (part: RoadProfilePart, detailed: boolean) => {
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [], colors: number[] = [];
  const vertex = (x: number, y: number, z: number, u: number, v: number) => {
    const index = positions.length / 3;
    positions.push(x + part.position[0], y + part.position[1], z + part.position[2]);
    uvs.push(u, v); colors.push(...part.tint);
    return index;
  };
  const quad = (a: number, b: number, c: number, e: number, reverse = false) => {
    if (reverse) indices.push(a, c, b, c, e, b);
    else indices.push(a, b, c, c, b, e);
  };
  if (part.kind === "swept-beam") {
    const [width, height, depth] = part.size, bevel = Math.min(height, depth) * .16;
    const h = height / 2, z = depth / 2, sweep = part.sweep ?? 0;
    const outline = [[-h, -z + bevel], [-h, z - bevel], [-h + bevel, z], [h - bevel, z],
      [h, z - bevel], [h, -z + bevel], [h - bevel, -z], [-h + bevel, -z]];
    const count = Math.max(2, Math.min(32, Math.floor(part.profileSegments ?? (detailed ? 20 : 8))));
    for (let index = 0; index <= count; index++) {
      const t = index / count, x = (t - .5) * width, y = sweep * Math.abs(t * 2 - 1) ** 3;
      for (let edge = 0; edge < outline.length; edge++)
        vertex(x, y + outline[edge]![0]!, outline[edge]![1]!, t * width, edge / outline.length);
    }
    for (let index = 0; index < count; index++) for (let edge = 0; edge < 8; edge++) {
      const a = index * 8 + edge, b = (index + 1) * 8 + edge;
      quad(a, b, index * 8 + (edge + 1) % 8, (index + 1) * 8 + (edge + 1) % 8);
    }
    const first = vertex(-width / 2, sweep, 0, 0, .5), last = vertex(width / 2, sweep, 0, 1, .5);
    for (let edge = 0; edge < 8; edge++) {
      indices.push(first, edge, (edge + 1) % 8);
      indices.push(last, count * 8 + (edge + 1) % 8, count * 8 + edge);
    }
  } else {
    const [width, height, depth] = part.size, around = detailed ? 16 : 8, rows = detailed ? 6 : 3;
    const profile = (t: number) => height * (1 - t) ** 1.4 + .018 * t ** 10;
    const ringSets: number[][][] = [];
    for (const bottom of [false, true]) {
      const rings: number[][] = [], center = vertex(0, height - (bottom ? .028 : 0), 0, .5, .5);
      for (let row = 1; row <= rows; row++) {
        const t = row / rows, ring: number[] = [];
        for (let index = 0; index < around; index++) {
          const angle = index / around * Math.PI * 2, cosine = Math.cos(angle), sine = Math.sin(angle);
          const distance = Math.max(Math.abs(cosine), Math.abs(sine));
          ring.push(vertex(cosine / distance * width / 2 * t, profile(t) - (bottom ? .028 : 0),
            sine / distance * depth / 2 * t, .5 + cosine / distance * t / 2, .5 + sine / distance * t / 2));
        }
        rings.push(ring);
      }
      for (let index = 0; index < around; index++) {
        const next = (index + 1) % around;
        if (bottom) indices.push(center, rings[0]![index]!, rings[0]![next]!);
        else indices.push(center, rings[0]![next]!, rings[0]![index]!);
      }
      for (let row = 1; row < rows; row++) for (let index = 0; index < around; index++) {
        const next = (index + 1) % around;
        quad(rings[row - 1]![index]!, rings[row - 1]![next]!, rings[row]![index]!, rings[row]![next]!, bottom);
      }
      ringSets.push(rings);
    }
    const upper = ringSets[0]!.at(-1)!, lower = ringSets[1]!.at(-1)!;
    for (let index = 0; index < around; index++) {
      const next = (index + 1) % around;
      quad(upper[index]!, upper[next]!, lower[index]!, lower[next]!);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};
