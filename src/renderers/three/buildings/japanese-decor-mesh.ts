import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

export type Rgb = readonly [number, number, number];

/** Vertex-coloured triangle soup builder shared by the Japanese decoration geometries. */
export interface DecorMesh { colors: number[]; indices: number[]; positions: number[]; uvs: number[] }

export const createDecorMesh = (): DecorMesh => ({ colors: [], indices: [], positions: [], uvs: [] });

export const addVertex = (mesh: DecorMesh, point: Vector3, color: Rgb, u = 0, v = 0) => {
  mesh.positions.push(point.x, point.y, point.z);
  mesh.colors.push(...color);
  mesh.uvs.push(u, v);
  return mesh.positions.length / 3 - 1;
};

/** Triangle facing the side from which a → b → c runs counter-clockwise. */
export const addTriangle = (mesh: DecorMesh, a: number, b: number, c: number) => { mesh.indices.push(a, b, c); };

/**
 * Closed tube through rings of `sides` vertices (ring-major order, as written by addRing): each
 * consecutive pair of rings becomes a band of outward-facing quads.
 */
export const bridgeRings = (mesh: DecorMesh, first: number, rings: number, sides: number) => {
  for (let ring = 0; ring < rings - 1; ring++) for (let side = 0; side < sides; side++) {
    const a = first + ring * sides + side, b = first + ring * sides + (side + 1) % sides;
    const c = a + sides, d = b + sides;
    mesh.indices.push(a, b, c, b, d, c);
  }
};

/**
 * One ring round `centre`: vertex k at angle 2πk/sides from `normal` towards `binormal`. With the
 * tube running along normal × binormal, bridgeRings' quads face outward.
 */
export const addRing = (
  mesh: DecorMesh, centre: Vector3, normal: Vector3, binormal: Vector3, radius: number, sides: number,
  color: (side: number) => Rgb, v = 0
) => {
  const first = mesh.positions.length / 3, point = new Vector3();
  for (let side = 0; side < sides; side++) {
    const angle = side / sides * Math.PI * 2;
    point.copy(centre).addScaledVector(normal, Math.cos(angle) * radius).addScaledVector(binormal, Math.sin(angle) * radius);
    addVertex(mesh, point, color(side), side / sides, v);
  }
  return first;
};


/** Mesh → indexed geometry with vertex colours, optionally divided by the part size it will be scaled by. */
export const toDecorGeometry = (mesh: DecorMesh, size?: readonly number[]) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(mesh.colors, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(mesh.indices);
  geometry.computeVertexNormals();
  // Authored in recipe units; the part transform scales by `size` again.
  if (size) geometry.scale(1 / size[0]!, 1 / size[1]!, 1 / size[2]!);
  return geometry;
};
