import type { PropMesh } from "../mesh-builder";

/** Static mesh dressing. Existing vertices, LOD index lists, wind weights and conservative
 * gameplay/culling bounds are retained; only the cached render asset changes. */
export const shapePlantMesh = (mesh: PropMesh, kind: "grass" | "shrub", variant: number) => {
  const phase = variant * 2.39996;
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
    const offset = vertex * 3;
    const x = mesh.positions[offset]!, y = mesh.positions[offset + 1]!, z = mesh.positions[offset + 2]!;
    const height = Math.max(0, Math.min(1, y / mesh.height));
    const bend = height * height * (3 - 2 * height);
    let scaleX = 1, scaleZ = 1, turn = 0;
    if (kind === "shrub") {
      // Broad irregular lobes leave small sky gaps between the existing branch clusters.
      scaleX = 1 - bend * (.06 + .11 * (.5 + .5 * Math.sin(y * 11 + z * 6 + phase)));
      scaleZ = 1 - bend * (.04 + .12 * (.5 + .5 * Math.cos(y * 9 + x * 7 - phase)));
    } else {
      // Root clumping and unequal blade widths; taller blades gain a gentle helical bend.
      const patch = .5 + .5 * Math.sin(x * 23 + z * 17 + phase);
      scaleX = 1 - .12 * patch;
      scaleZ = 1 - .09 * (1 - patch);
      turn = bend * .18 * Math.sin(x * 19 - z * 13 + phase);
    }
    const cosine = Math.cos(turn), sine = Math.sin(turn);
    mesh.positions[offset] = x * scaleX * cosine - z * scaleZ * sine;
    mesh.positions[offset + 2] = x * scaleX * sine + z * scaleZ * cosine;
    const nx = mesh.normals[offset]! / scaleX, ny = mesh.normals[offset + 1]!;
    const nz = mesh.normals[offset + 2]! / scaleZ;
    const length = Math.hypot(nx, ny, nz) || 1;
    mesh.normals[offset] = (nx * cosine - nz * sine) / length;
    mesh.normals[offset + 1] = ny / length;
    mesh.normals[offset + 2] = (nx * sine + nz * cosine) / length;
    const patchTone = .96 + .04 * Math.sin(x * 12 + z * 15 + phase);
    const light = patchTone * (.9 + height * .16);
    mesh.colors[offset] = Math.min(1, mesh.colors[offset]! * light * (1.02 - height * .02));
    mesh.colors[offset + 1] = Math.min(1, mesh.colors[offset + 1]! * light);
    mesh.colors[offset + 2] = Math.min(1, mesh.colors[offset + 2]! * light * (.98 + height * .02));
  }
  return mesh;
};
