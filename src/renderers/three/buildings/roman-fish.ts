import { BufferGeometry, Float32BufferAttribute } from "three";

/** Tapered fish body, forked caudal fin and raised dorsal fin, shared across LODs. */
export const createRomanFish = (detailed: boolean) => {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const rings = detailed ? 9 : 4,
    sides = detailed ? 10 : 4;
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings;
    const width = Math.max(0.025, Math.sin(Math.PI * t) * (0.52 - t * 0.31));
    for (let side = 0; side <= sides; side++) {
      const angle = (side * Math.PI * 2) / sides;
      positions.push(Math.sin(angle) * width, Math.cos(angle) * width * 0.68, -0.5 + t * 0.83);
      uvs.push(side / sides, t);
      if (ring === rings || side === sides) continue;
      const a = ring * (sides + 1) + side,
        b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const fin = (points: number[][], axis = 1) => {
    const first = positions.length / 3;
    const count = points.length;
    for (const layer of [-1, 1])
      for (const point of points) {
        const vertex = [...point];
        vertex[axis] = (vertex[axis] ?? 0) + layer * 0.006;
        positions.push(...vertex);
        uvs.push(0.1, 0.8);
      }
    for (let i = 1; i < count - 1; i++) {
      indices.push(first, first + i, first + i + 1);
      indices.push(first + count, first + count + i + 1, first + count + i);
    }
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      indices.push(
        first + i,
        first + count + i,
        first + next,
        first + next,
        first + count + i,
        first + count + next
      );
    }
  };
  fin([
    [0, 0, 0.28],
    [-0.35, 0.01, 0.5],
    [0, 0, 0.43],
    [0.35, 0.01, 0.5]
  ]);
  if (detailed) {
    fin(
      [
        [0, 0.2, -0.23],
        [0, 0.43, -0.03],
        [0, 0.12, 0.13]
      ],
      0
    );
    for (const side of [-1, 1])
      fin([
        [side * 0.25, 0, -0.22],
        [side * 0.43, -0.08, -0.03],
        [side * 0.2, 0, -0.04]
      ]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};
