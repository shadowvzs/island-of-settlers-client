import { BufferAttribute, BufferGeometry } from "three";

/** A shallow raised meniscus meets the inside of the staves; no cylindrical wooden-looking cap. */
export const createTanningLiquidGeometry = (detailed: boolean) => {
  const segments = detailed ? 32 : 12, rings = detailed ? 5 : 2;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) for (let segment = 0; segment <= segments; segment++) {
    const r = ring / rings, angle = segment / segments * Math.PI * 2;
    const x = Math.sin(angle) * r * .5, z = Math.cos(angle) * r * .5;
    positions.push(x, Math.pow(r, 12) * .46 + Math.sin(angle * 3 + r * 12) * .018 * r, z);
    uvs.push(x + .5, z + .5);
  }
  for (let ring = 0; ring < rings; ring++) for (let segment = 0; segment < segments; segment++) {
    const a = ring * (segments + 1) + segment, b = a + segments + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};
