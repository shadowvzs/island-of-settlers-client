import { BufferGeometry, Float32BufferAttribute } from "three";

/** Chamfered corners and edges; normalized dimensions are scaled by the shared recipe. */
export const createRomanBevelledBox = (detailed: boolean) => {
  const geometry = new BufferGeometry();
  const positions: number[] = [],
    indices: number[] = [],
    uvs: number[] = [];
  const outline = [
    [-0.42, -0.5],
    [0.42, -0.5],
    [0.5, -0.42],
    [0.5, 0.42],
    [0.42, 0.5],
    [-0.42, 0.5],
    [-0.5, 0.42],
    [-0.5, -0.42]
  ];
  const rings = detailed
    ? [
        [-0.5, 0.88],
        [-0.4, 1],
        [0.4, 1],
        [0.5, 0.88]
      ]
    : [
        [-0.5, 1],
        [0.5, 1]
      ];
  for (const [y, scale] of rings)
    for (const [x, z] of outline) {
      positions.push(x! * scale!, y!, z! * scale!);
      uvs.push(x! + 0.5, z! + 0.5);
    }
  for (let ring = 0; ring < rings.length - 1; ring++)
    for (let side = 0; side < 8; side++) {
      const a = ring * 8 + side,
        b = ring * 8 + ((side + 1) % 8);
      indices.push(a, a + 8, b, b, a + 8, b + 8);
    }
  const last = (rings.length - 1) * 8;
  for (let i = 1; i < 7; i++) {
    indices.push(0, i, i + 1);
    indices.push(last, last + i + 1, last + i);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  // Flat normals keep chamfers visible rather than inflating the silhouette.
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  const normal = flat.getAttribute("normal"),
    position = flat.getAttribute("position");
  const uv = flat.getAttribute("uv");
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(normal.getY(i)) > 0.5) uv.setXY(i, position.getX(i) + 0.5, position.getZ(i) + 0.5);
    else if (Math.abs(normal.getX(i)) > 0.5)
      uv.setXY(i, position.getZ(i) + 0.5, position.getY(i) + 0.5);
    else uv.setXY(i, position.getX(i) + 0.5, position.getY(i) + 0.5);
  }
  return flat;
};
