import { PROP } from "../../shared/world/world-data";
import type { PropMesh } from "../props/mesh-builder";

/** Distinct native timber appearances reuse mature structural assets and all growth stages. */
export const tierTreeProfile = (kind: number, form = 0) => {
  if (kind === PROP.cedarTree)
    return { x: 1.12, y: .93, leaf: [.78, .91, .91], bark: [.92, .72, .58] };
  if (kind === PROP.walnutTree) {
    const shapes = [[1.14, .94], [1.03, 1.04], [1.24, .86], [1.08, .98]] as const;
    const [x, y] = shapes[form & 3]!;
    return { x, y, leaf: [.72, .86, .66], bark: [.72, .67, .58] };
  }
  return { x: .9, y: 1.12, leaf: [.72, .86, .77], bark: [1.03, .73, .61] };
};

export const styleTierTreeMesh = (mesh: PropMesh, kind: number, form = 0): PropMesh => {
  const profile = tierTreeProfile(kind, form);
  for (let id = 0; id < mesh.positions.length / 3; id++) {
    mesh.positions[id * 3] = mesh.positions[id * 3]! * profile.x; mesh.positions[id * 3 + 1] = mesh.positions[id * 3 + 1]! * profile.y; mesh.positions[id * 3 + 2] = mesh.positions[id * 3 + 2]! * profile.x;
    const nx = mesh.normals[id * 3]! / profile.x, ny = mesh.normals[id * 3 + 1]! / profile.y, nz = mesh.normals[id * 3 + 2]! / profile.x;
    const length = Math.hypot(nx, ny, nz) || 1;
    mesh.normals[id * 3] = nx / length; mesh.normals[id * 3 + 1] = ny / length; mesh.normals[id * 3 + 2] = nz / length;
    const tint = mesh.wind[id * 2 + 1]! > 0 ? profile.leaf : profile.bark;
    for (let axis = 0; axis < 3; axis++) mesh.colors[id * 3 + axis] = Math.min(1, mesh.colors[id * 3 + axis]! * tint[axis]!);
  }
  mesh.height *= profile.y; mesh.radius *= profile.x;
  if (mesh.contactRadius !== undefined) mesh.contactRadius *= profile.x;
  return mesh;
};
