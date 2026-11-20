import { Box3, Mesh, type Object3D,Vector3 } from "three";

type SurfaceTriangle = { vertices: Vector3[]; bounds: Box3; edges: Vector3[]; normal: Vector3 };
export interface MeshSurface {
  mesh: Mesh;
  bounds: Box3;
  triangles: SurfaceTriangle[];
}

/** Audits actual transformed mesh triangles, preserving hollow openings and gaps between parts. */
export const meshSurface = (mesh: Mesh): MeshSurface => {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute("position"), index = mesh.geometry.index;
  const triangles: SurfaceTriangle[] = [];
  for (let face = 0; face < (index?.count ?? position.count); face += 3) {
    const vertices = [0, 1, 2].map(corner => new Vector3()
      .fromBufferAttribute(position, index ? index.getX(face + corner) : face + corner)
      .applyMatrix4(mesh.matrixWorld));
    const edges = vertices.map((vertex, corner) => vertices[(corner + 1) % 3]!.clone().sub(vertex));
    const normal = edges[0]!.clone().cross(edges[1]!).normalize();
    triangles.push({ vertices, edges, normal, bounds: new Box3().setFromPoints(vertices) });
  }
  return { mesh, triangles, bounds: new Box3().setFromPoints(triangles.flatMap(face => face.vertices)) };
};

export const objectIsVisible = (object: Object3D) => {
  for (let current: Object3D | null = object; current; current = current.parent)
    if (!current.visible) return false;
  return true;
};

const axis = new Vector3();
const separated = (a: SurfaceTriangle, b: SurfaceTriangle, direction: Vector3) => {
  if (direction.lengthSq() < 1e-16) return false;
  direction.normalize();
  const first = a.vertices.map(vertex => vertex.dot(direction));
  const second = b.vertices.map(vertex => vertex.dot(direction));
  return Math.max(...first) < Math.min(...second) - 1e-7 ||
    Math.max(...second) < Math.min(...first) - 1e-7;
};
const trianglesTouch = (a: SurfaceTriangle, b: SurfaceTriangle) => {
  if (!a.bounds.intersectsBox(b.bounds)) return false;
  if (separated(a, b, a.normal.clone()) || separated(a, b, b.normal.clone())) return false;
  for (const first of a.edges) for (const second of b.edges)
    if (separated(a, b, axis.crossVectors(first, second))) return false;
  // Coplanar faces also need in-plane edge normals; their cross-edge axes alone are insufficient.
  for (const edge of a.edges) if (separated(a, b, axis.crossVectors(a.normal, edge))) return false;
  for (const edge of b.edges) if (separated(a, b, axis.crossVectors(b.normal, edge))) return false;
  return true;
};

/** Returns an intersecting pair of real surface triangles, or null for clear geometry. */
export const intersectMeshSurfaces = (a: MeshSurface, b: MeshSurface) => {
  if (!a.bounds.intersectsBox(b.bounds)) return null;
  for (const first of a.triangles) for (const second of b.triangles)
    if (trianglesTouch(first, second)) return {
      first: first.vertices.map(vertex => vertex.toArray()),
      second: second.vertices.map(vertex => vertex.toArray())
    };
  return null;
};
