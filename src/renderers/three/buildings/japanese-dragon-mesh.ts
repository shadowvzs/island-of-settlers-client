import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from "three";

import { DRAGON_ATLAS, type DragonStrip, stripCentre } from "./japanese-dragon-atlas";

/** Smooth-shaded dragon mesh with explicit normals and atlas UVs (no vertex colours). */
export interface DragonMesh { indices: number[]; normals: number[]; positions: number[]; uvs: number[] }

export const createDragonMesh = (): DragonMesh => ({ indices: [], normals: [], positions: [], uvs: [] });

export const UP = new Vector3(0, 1, 0);

const addVertex = (mesh: DragonMesh, point: Vector3, normal: Vector3, u: number, v: number) => {
  mesh.positions.push(point.x, point.y, point.z);
  mesh.normals.push(normal.x, normal.y, normal.z);
  mesh.uvs.push(u, v);
  return mesh.positions.length / 3 - 1;
};

/** Elliptic cross-section of a loft: centre, side and up axes, half width / height, texture v. */
export interface LoftRing { centre: Vector3; height: number; side: Vector3; up: Vector3; v: number; width: number }

/**
 * Loft surface: `sides` round each ring (a duplicated seam vertex closes the texture wrap), the
 * atlas strip spread round it. The strip's belly band (for the wrap strip) is centred on
 * `bellyAngle`, measured from `side` towards `up` (default: straight down). `tip` closes the end.
 */
export interface LoftOptions { bellyAngle?: number; sides: number; strip: DragonStrip; tip?: Vector3 }

/** Fraction of the wrap strip at the middle of the belly band. */
const BELLY_CENTRE = ((DRAGON_ATLAS.belly.u0 + DRAGON_ATLAS.belly.u1) / 2 - DRAGON_ATLAS.wrap.u0) /
  (DRAGON_ATLAS.wrap.u1 - DRAGON_ATLAS.wrap.u0);

export const addLoft = (mesh: DragonMesh, rings: readonly LoftRing[], options: LoftOptions) => {
  const { sides, strip, tip } = options, { u0, u1 } = DRAGON_ATLAS[strip];
  const start = (options.bellyAngle ?? -Math.PI / 2) - BELLY_CENTRE * Math.PI * 2, first = mesh.positions.length / 3;
  const point = new Vector3(), normal = new Vector3();
  for (const ring of rings) for (let side = 0; side <= sides; side++) {
    const angle = start + side / sides * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
    point.copy(ring.centre).addScaledVector(ring.side, cos * ring.width).addScaledVector(ring.up, sin * ring.height);
    normal.copy(ring.side).multiplyScalar(cos / ring.width).addScaledVector(ring.up, sin / ring.height).normalize();
    addVertex(mesh, point, normal, u0 + (u1 - u0) * side / sides, ring.v);
  }
  const stride = sides + 1;
  for (let ring = 0; ring < rings.length - 1; ring++) for (let side = 0; side < sides; side++) {
    const a = first + ring * stride + side, b = a + 1, c = a + stride, d = b + stride;
    mesh.indices.push(a, b, c, b, d, c);
  }
  if (!tip) return;
  const last = rings.at(-1)!, axis = tip.clone().sub(last.centre).normalize();
  const apex = addVertex(mesh, tip, axis, (u0 + u1) / 2, last.v + tip.distanceTo(last.centre) / .16);
  const lastFirst = first + (rings.length - 1) * stride;
  for (let side = 0; side < sides; side++) mesh.indices.push(lastFirst + side, lastFirst + side + 1, apex);
};

/**
 * Rings along a smooth path through `points` (centripetal Catmull-Rom, `samples` rings), widths
 * and heights interpolated between the control points. `upHint` orients the cross-section without
 * twisting; v advances by arc length / `repeat`.
 */
export const pathRings = (
  points: readonly Vector3[], widths: readonly number[], heights: readonly number[], upHint: Vector3,
  samples: number, repeat: number
): LoftRing[] => {
  const curve = new CatmullRomCurve3(points.map(point => point.clone()), false, "centripetal");
  const at = (values: readonly number[], t: number) => {
    const position = t * (values.length - 1), index = Math.min(values.length - 2, Math.floor(position));
    return values[index]! + (values[index + 1]! - values[index]!) * (position - index);
  };
  let v = 0, previous: Vector3 | undefined;
  return Array.from({ length: samples }, (_, index) => {
    const t = index / (samples - 1), centre = curve.getPoint(t), tangent = curve.getTangent(t);
    v += previous ? centre.distanceTo(previous) / repeat : 0;
    previous = centre;
    const up = upHint.clone().addScaledVector(tangent, -upHint.dot(tangent)).normalize();
    const side = new Vector3().crossVectors(up, tangent);
    return { centre, height: at(heights, t), side, up, v, width: at(widths, t) };
  });
};

/** A tapering round tube along a path ending in a point (claws, horns, teeth, whiskers). */
export const addTaperedTube = (
  mesh: DragonMesh, points: readonly Vector3[], radii: readonly number[], sides: number, strip: DragonStrip,
  samples = points.length
) => {
  const along = points.at(-1)!.clone().sub(points[0]!).normalize();
  const hint = Math.abs(along.y) < .9 ? UP : new Vector3(1, 0, 0);
  const rings = pathRings(points, radii, radii, hint, Math.max(2, samples), .16);
  addLoft(mesh, rings.slice(0, -1), { sides, strip, tip: points.at(-1)! });
};

/** Ball (eyes, pupils, the pearl): `rows` from pole to pole, v runs up for the pearl's sheen. */
export const addOrb = (
  mesh: DragonMesh, centre: Vector3, radius: number, sides: number, rows: number, strip: DragonStrip
) => {
  const u = stripCentre(strip), first = mesh.positions.length / 3, normal = new Vector3();
  addVertex(mesh, centre.clone().addScaledVector(UP, -radius), new Vector3(0, -1, 0), u, 0);
  for (let row = 1; row < rows; row++) for (let side = 0; side < sides; side++) {
    const polar = Math.PI * row / rows, around = side / sides * Math.PI * 2;
    normal.set(Math.sin(polar) * Math.cos(around), -Math.cos(polar), -Math.sin(polar) * Math.sin(around));
    addVertex(mesh, centre.clone().addScaledVector(normal, radius), normal, u, row / rows);
  }
  const top = addVertex(mesh, centre.clone().addScaledVector(UP, radius), UP, u, 1);
  const ring = (row: number, side: number) => first + 1 + (row - 1) * sides + side % sides;
  for (let side = 0; side < sides; side++) {
    mesh.indices.push(ring(1, side + 1), ring(1, side), first);
    mesh.indices.push(ring(rows - 1, side), ring(rows - 1, side + 1), top);
    for (let row = 1; row < rows - 1; row++) {
      const a = ring(row, side), b = ring(row, side + 1), c = ring(row + 1, side), d = ring(row + 1, side + 1);
      mesh.indices.push(a, b, c, b, d, c);
    }
  }
};

/**
 * Double-faced carved blade (fin, mane flame, tuft): a strip from a base line to a tip line, u along
 * the blade inside `strip`, v from `vBase` on the base line to `vTip` on the tip line (a narrow v range
 * keeps small blades off the coarse mip levels that blend neighbouring strips).
 */
export const addBlade = (
  mesh: DragonMesh, bases: readonly Vector3[], tips: readonly Vector3[], strip: DragonStrip,
  [vBase, vTip]: readonly [number, number] = [0, .97]
) => {
  const { u0, u1 } = DRAGON_ATLAS[strip], last = bases.length - 1;
  for (const face of [1, -1]) {
    const first = mesh.positions.length / 3, normal = new Vector3();
    bases.forEach((base, index) => {
      const along = bases[Math.min(last, index + 1)]!.clone().sub(bases[Math.max(0, index - 1)]!);
      const facing = new Vector3().crossVectors(along, tips[index]!.clone().sub(base));
      // A pointed end (base and tip meet) keeps the previous normal instead of a NaN.
      if (facing.lengthSq() > 1e-14) normal.copy(facing).normalize().multiplyScalar(face);
      // Each face sits a hair off the midplane, so the blade does not shadow its own twin.
      const lift = normal.clone().multiplyScalar(along.length() * .01);
      const u = u0 + (u1 - u0) * (.1 + .8 * index / Math.max(1, last));
      addVertex(mesh, base.clone().add(lift), normal, u, vBase);
      addVertex(mesh, tips[index]!.clone().add(lift), normal, u, vTip);
    });
    for (let index = 0; index < last; index++) {
      const a = first + index * 2, b = a + 1, c = a + 2, d = a + 3;
      if (face > 0) mesh.indices.push(a, c, b, b, c, d);
      else mesh.indices.push(a, b, c, b, d, c);
    }
  }
};

/** Mesh → indexed geometry, divided by the part size it will be scaled by again. */
export const toDragonGeometry = (mesh: DragonMesh, size: readonly number[]) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(mesh.indices);
  geometry.scale(1 / size[0]!, 1 / size[1]!, 1 / size[2]!);
  return geometry;
};
