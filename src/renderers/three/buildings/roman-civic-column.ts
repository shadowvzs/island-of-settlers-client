import { BufferGeometry, Float32BufferAttribute } from "three";

/** Restrained six flutes and an entasis ring: 72 shaft triangles, within the old support box. */
export const createRomanCivicColumn = () => {
  const segments = 12;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring < 3; ring += 1) {
    const radius = [0.49, 0.5, 0.465][ring]!;
    for (let side = 0; side <= segments; side += 1) {
      const angle = side / segments * Math.PI * 2;
      const flute = side % 2 === 0 ? 1 : 0.94;
      positions.push(Math.sin(angle) * radius * flute, ring * 0.5 - 0.5,
        Math.cos(angle) * radius * flute);
      uvs.push(side / segments, ring / 2);
    }
  }
  for (let ring = 0; ring < 2; ring += 1) for (let side = 0; side < segments; side += 1) {
    const a = ring * (segments + 1) + side;
    const b = a + segments + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // Separate cap vertices keep their normals flat against the plinth and capital.
  for (const ring of [0, 2]) {
    const centre = positions.length / 3;
    positions.push(0, ring * 0.5 - 0.5, 0);
    uvs.push(0.5, 0.5);
    for (let side = 0; side <= segments; side += 1) {
      const source = (ring * (segments + 1) + side) * 3;
      positions.push(positions[source]!, positions[source + 1]!, positions[source + 2]!);
      uvs.push(positions[source]! + 0.5, positions[source + 2]! + 0.5);
    }
    for (let side = 0; side < segments; side += 1) {
      const first = centre + side + 1;
      if (ring === 0) indices.push(centre, first + 1, first);
      else indices.push(centre, first, first + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};
