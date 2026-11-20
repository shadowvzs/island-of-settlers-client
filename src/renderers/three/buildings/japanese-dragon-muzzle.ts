import { Vector3 } from "three";

import { stripCentre } from "./japanese-dragon-atlas";
import type { Head } from "./japanese-dragon-head";
import { addLoft, addTaperedTube, type DragonMesh, pathRings } from "./japanese-dragon-mesh";

/** A slender lower jaw: enough gape to show the palate without a detached-looking chin. */
export const jawLine = (forward: number) => -.5 - (forward - .3) * .58;

/** Flared green rim surrounding a recessed, sideways-facing nostril, rather than a black ball. */
const addNostril = (mesh: DragonMesh, { at, side }: Head, sign: number, detailed: boolean) => {
  const sides = detailed ? 10 : 4;
  const first = mesh.positions.length / 3;
  const rings = [
    { depth: .5, forward: .23, height: .17, strip: "scales" },
    { depth: .65, forward: .18, height: .12, strip: "scales" },
    { depth: .6, forward: .12, height: .075, strip: "scales" }
  ] as const;
  for (const ring of rings) for (let index = 0; index < sides; index++) {
    const angle = index / sides * Math.PI * 2;
    const point = at(2.48 + Math.cos(angle) * ring.forward,
      .36 + Math.sin(angle) * ring.height, sign * ring.depth);
    mesh.positions.push(point.x, point.y, point.z);
    const normal = side.clone().multiplyScalar(sign);
    mesh.normals.push(normal.x, normal.y, normal.z);
    mesh.uvs.push(stripCentre(ring.strip), .5);
  }
  const inward = at(2.48, .36, sign * .52), centre = mesh.positions.length / 3;
  mesh.positions.push(inward.x, inward.y, inward.z);
  const normal = side.clone().multiplyScalar(sign);
  mesh.normals.push(normal.x, normal.y, normal.z);
  mesh.uvs.push(stripCentre("dark"), .5);
  const face = (a: number, b: number, c: number) => {
    const point = (index: number) => new Vector3().fromArray(mesh.positions, index * 3);
    const facing = point(b).sub(point(a)).cross(point(c).sub(point(a)));
    if (facing.dot(normal) < 0) mesh.indices.push(a, c, b);
    else mesh.indices.push(a, b, c);
  };
  for (let ring = 0; ring < rings.length - 1; ring++) for (let index = 0; index < sides; index++) {
    const a = first + ring * sides + index, b = first + ring * sides + (index + 1) % sides;
    face(a, b, a + sides); face(b, b + sides, a + sides);
  }
  // Separate UV vertices at the rim: interpolating scales → dark would cross the belly strip.
  const inner = mesh.positions.length / 3;
  for (let index = 0; index < sides; index++) {
    const vertex = (first + 2 * sides + index) * 3;
    mesh.positions.push(...mesh.positions.slice(vertex, vertex + 3));
    mesh.normals.push(normal.x, normal.y, normal.z);
    mesh.uvs.push(stripCentre("dark"), .5);
  }
  for (let index = 0; index < sides; index++)
    face(inner + index, inner + (index + 1) % sides, centre);
};

/** Curved lip edges keep the teeth visibly rooted in the upper muzzle and lower jaw. */
const addLips = (mesh: DragonMesh, { at, size }: Head, detailed: boolean) => {
  for (const sign of [-1, 1]) {
    const upper = [at(.65, -.34, sign * .64), at(1.5, -.35, sign * .5),
      at(2.1, -.26, sign * .45), at(2.65, -.16, sign * .3)];
    addTaperedTube(mesh, upper, [.055, .065, .05, .015].map(radius => radius * size),
      detailed ? 6 : 3, "scales");
    const lower = [at(.65, jawLine(.65) + .22, sign * .48),
      at(1.5, jawLine(1.5) + .17, sign * .38), at(2.3, jawLine(2.3) + .09, sign * .23)];
    addTaperedTube(mesh, lower, [.065, .045, .01].map(radius => radius * size),
      detailed ? 5 : 3, "mouth");
  }
};

/** A dark throat behind the brighter palate gives the open mouth visible depth on both LODs. */
export const addDragonMuzzle = (mesh: DragonMesh, head: Head, detailed: boolean) => {
  for (const sign of [-1, 1]) addNostril(mesh, head, sign, detailed);
  addLips(mesh, head, detailed);
  const { at, size, up } = head;
  const throat = pathRings([at(.5, -.62), at(.9, -.76)], [.4 * size, .32 * size],
    [.3 * size, .24 * size], up, 2, .16);
  addLoft(mesh, throat, { sides: detailed ? 8 : 4, strip: "dark", tip: at(1.05, -.8) });
};
