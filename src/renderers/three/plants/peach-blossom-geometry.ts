import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Vector3 } from "three";

import type { OrnamentalBlossom } from "../../../render-common/plants/ornamental-tree-graph";

type Point = readonly [number, number, number];
interface FlowerSurface { positions: number[]; colours: number[]; uvs: number[]; indices: number[] }
const surface = (): FlowerSurface => ({ positions: [], colours: [], uvs: [], indices: [] });
const vertex = (mesh: FlowerSurface, p: Point, colour: Point = [1, 1, 1], uv = [.5, .5]) => {
  const index = mesh.positions.length / 3;
  mesh.positions.push(...p); mesh.colours.push(...colour); mesh.uvs.push(...uv);
  return index;
};

const finish = (mesh: FlowerSurface, flower: OrnamentalBlossom) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(mesh.colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(mesh.indices); geometry.computeVertexNormals();
  geometry.scale(flower.radius, flower.radius, flower.radius);
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(flower.pitch, flower.yaw, 0, "YXZ"));
  matrix.setPosition(...flower.position); geometry.applyMatrix4(matrix);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

/** Thin tapered filament/short pedicel. All local stems originate on the shared receptacle. */
const taperedStem = (mesh: FlowerSurface, from: Point, to: Point, radius: number, sides: number,
  colour: Point, endRadius = radius * .4) => {
  const start = new Vector3(...from), end = new Vector3(...to), axis = end.clone().sub(start).normalize();
  const guide = Math.abs(axis.y) > .9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const first = axis.clone().cross(guide).normalize(), second = axis.clone().cross(first).normalize();
  const offset = mesh.positions.length / 3;
  for (const [centre, width] of [[start, radius], [end, endRadius]] as const) {
    for (let side = 0; side < sides; side++) {
      const angle = side * Math.PI * 2 / sides;
      const point = centre.clone().addScaledVector(first, Math.cos(angle) * width)
        .addScaledVector(second, Math.sin(angle) * width);
      vertex(mesh, point.toArray() as [number, number, number], colour);
    }
  }
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    mesh.indices.push(offset + side, offset + next, offset + sides + side,
      offset + next, offset + sides + next, offset + sides + side);
  }
};

const addPetals = (mesh: FlowerSurface, detailed: boolean, seed: number, canopy: boolean) => {
  let rows = [.32, .72];
  if (detailed) rows = [.12, .28, .46, .64, .81, .94];
  if (canopy) rows = [.56];
  const sides = detailed ? [-1, -.5, 0, .5, 1] : [-1, 0, 1];
  for (let petal = 0; petal < 5; petal++) {
    const angle = petal * Math.PI * 2 / 5, variation = Math.sin(seed * .73 + petal * 2.11);
    const rotate = (x: number, y: number, z: number): Point =>
      [x * Math.cos(angle) + z * Math.sin(angle), y, z * Math.cos(angle) - x * Math.sin(angle)];
    const base = vertex(mesh, rotate(0, .15, .05), [.38, .38, .38], [.5, 0]);
    for (const [row, t] of rows.entries()) {
      const width = Math.sin(Math.PI * t) ** .6 * (.47 + variation * .02);
      for (const side of sides) {
        const cup = .14 + .20 * t + .09 * t * t + side * side * .10 * Math.sin(Math.PI * t);
        const y = cup + variation * .035 * t + side * .025 * Math.sin(petal + t * 4);
        const shade = .38 + .60 * t;
        vertex(mesh, rotate(side * width, y, .05 + t), [shade, shade, shade], [(side + 1) / 2, t]);
      }
      const current = base + 1 + row * sides.length;
      for (let column = 0; column < sides.length - 1; column++) {
        if (row === 0) mesh.indices.push(base, current + column, current + column + 1);
        else {
          const previous = current - sides.length;
          mesh.indices.push(previous + column, current + column, previous + column + 1,
            previous + column + 1, current + column, current + column + 1);
        }
      }
    }
    // A short, softly pointed peach tip; the silhouette has no cherry-style cleft.
    const tip = vertex(mesh, rotate(0, .34 + variation * .035, 1.065), [1, 1, 1], [.5, 1]);
    const last = tip - sides.length;
    for (let column = 0; column < sides.length - 1; column++)
      mesh.indices.push(last + column, tip, last + column + 1);
  }
};

const addCalyx = (mesh: FlowerSurface, detailed: boolean, canopy = false) => {
  taperedStem(mesh, [0, 0, 0], [0, .15, 0], .043, detailed ? 5 : 3, [.62, .62, .62], .12);
  for (let sepal = 0; sepal < 5; sepal++) {
    const angle = (sepal + .5) * Math.PI * 2 / 5;
    const base = vertex(mesh, [0, .10, 0], [.55, .55, .55]);
    const a = vertex(mesh, [Math.sin(angle - .38) * .20, .12, Math.cos(angle - .38) * .20]);
    const tip = vertex(mesh, [Math.sin(angle) * .43, .07, Math.cos(angle) * .43]);
    const b = vertex(mesh, [Math.sin(angle + .38) * .20, .12, Math.cos(angle + .38) * .20]);
    if (canopy) mesh.indices.push(a, tip, b);
    else mesh.indices.push(base, a, tip, base, tip, b);
  }
};

const addCentre = (mesh: FlowerSurface, detailed: boolean, canopy = false) => {
  const centre = vertex(mesh, [0, .215, 0], [.43, .025, .095]);
  const segments = detailed ? 12 : 5;
  for (let side = 0; side < segments; side++) {
    const angle = side * Math.PI * 2 / segments, next = (side + 1) * Math.PI * 2 / segments;
    const a = vertex(mesh, [Math.sin(angle) * .18, .235, Math.cos(angle) * .18], [.66, .09, .18]);
    const b = vertex(mesh, [Math.sin(next) * .18, .235, Math.cos(next) * .18], [.66, .09, .18]);
    mesh.indices.push(centre, a, b);
    if (detailed) {
      const lowerA = vertex(mesh, [Math.sin(angle) * .09, .14, Math.cos(angle) * .09], [.48, .04, .12]);
      const lowerB = vertex(mesh, [Math.sin(next) * .09, .14, Math.cos(next) * .09], [.48, .04, .12]);
      mesh.indices.push(a, lowerA, b, b, lowerA, lowerB);
    }
  }
  if (canopy) return;
  const count = detailed ? 8 : 3;
  for (let stamen = 0; stamen < count; stamen++) {
    const angle = stamen * Math.PI * 2 / count + .2 + Math.sin(stamen * 1.7) * .13;
    const reach = .16 + .035 * Math.cos(stamen * 2.31);
    const tip: Point = [Math.sin(angle) * reach, .39 + (stamen % 3) * .027, Math.cos(angle) * reach];
    taperedStem(mesh, [Math.sin(angle) * .07, .20, Math.cos(angle) * .07], tip,
      detailed ? .006 : .010, 3, [.92, .55, .53], .004);
    const [x, y, z] = tip, r = detailed ? .020 : .030;
    const a = vertex(mesh, [x - r, y, z], [1, .72, .24]);
    const b = vertex(mesh, [x + r, y, z], [1, .72, .24]);
    const c = vertex(mesh, [x, y + r, z + r], [1, .82, .39]);
    const d = vertex(mesh, [x, y - r * .55, z - r], [1, .68, .18]);
    mesh.indices.push(a, c, b, a, d, c, a, b, d, b, c, d);
  }
  taperedStem(mesh, [0, .15, 0], [0, .48, 0], .012, 3, [.86, .63, .52], .009);
};

/** Separate reusable true-3D flower surfaces. Attachment is local origin, normal is local +Y. */
export const createPeachBlossomGeometries = (flower: OrnamentalBlossom, detailed: boolean,
  canopy = false) => {
  if (!(flower.radius > 0) || !Number.isFinite(flower.radius)) throw new Error("Invalid peach flower radius");
  const petals = surface(), calyx = surface(), centre = surface();
  addPetals(petals, detailed && !canopy, flower.seed, canopy);
  addCalyx(calyx, detailed && !canopy, canopy); addCentre(centre, detailed && !canopy, canopy);
  return { petals: finish(petals, flower), calyx: finish(calyx, flower), centre: finish(centre, flower) };
};

/** Subpixel reproductive details are omitted, but five real cupped petals and their bearing remain. */
export const createPeachBlossomFarGeometries = (flower: OrnamentalBlossom) => {
  if (!(flower.radius > 0) || !Number.isFinite(flower.radius)) throw new Error("Invalid peach flower radius");
  const petals = surface(), calyx = surface(), centre = surface();
  addPetals(petals, false, flower.seed, true);
  const anchor = vertex(calyx, [0, 0, 0], [.62, .62, .62]);
  for (let side = 0; side < 3; side++) {
    const angle = side * Math.PI * 2 / 3;
    vertex(calyx, [Math.sin(angle) * .12, .15, Math.cos(angle) * .12], [.8, .8, .8]);
  }
  calyx.indices.push(anchor, 2, 1, anchor, 3, 2, anchor, 1, 3);
  for (let side = 0; side < 3; side++) {
    const angle = side * Math.PI * 2 / 3;
    vertex(centre, [Math.sin(angle) * .15, .235, Math.cos(angle) * .15], [.76, .15, .24]);
  }
  centre.indices.push(0, 1, 2);
  return { petals: finish(petals, flower), calyx: finish(calyx, flower), centre: finish(centre, flower) };
};
