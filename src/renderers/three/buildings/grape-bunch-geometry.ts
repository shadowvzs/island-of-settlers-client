import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import { createRandom } from "../../../shared/world/rng";

/** One berry ring: count, ring radius and height in the unit box (tip at -y), ring twist. */
type BerryRing = readonly [count: number, radius: number, height: number, twist: number];
/** Berry lathe: sides and the (height, radius) profile on the unit sphere, top to bottom. */
type BerryProfile = { rings: readonly (readonly [number, number])[]; sides: number };
type BunchLayout = { berryRadius: number; profile: BerryProfile; rings: readonly BerryRing[] };

/** 24 triangles: two latitude rings keep the berry round from every side. */
const ROUND_BERRY: BerryProfile = { rings: [[1, 0], [.5, .87], [-.5, .87], [-1, 0]], sides: 6 };
/** 8 triangles for Minimal and the many half-buried bunches of stock piles. */
const BEAD_BERRY: BerryProfile = { rings: [[1, 0], [0, 1], [-1, 0]], sides: 4 };

/** Building vines on High: a shouldered, tapered 10-berry cluster. */
const FULL_BUNCH: BunchLayout = {
  berryRadius: .19, profile: ROUND_BERRY, rings: [[4, .24, .25, 0], [3, .19, .015, Math.PI / 3], [2, .105, -.2, .6], [1, 0, -.36, 0]]
};
/** Minimal vines: six beads still taper to a tip. */
const LEAN_BUNCH: BunchLayout = {
  berryRadius: .23, profile: BEAD_BERRY, rings: [[3, .22, .24, 0], [2, .14, 0, 1], [1, 0, -.27, 0]]
};
/** Stock piles: a three-bead cluster. */
const TINY_BUNCH: BunchLayout = {
  berryRadius: .27, profile: BEAD_BERRY, rings: [[2, .19, .14, 0], [1, 0, -.22, 0]]
};

/** Berries are a little taller than wide; the part box is about 1.5 times taller than wide. */
const BERRY_STRETCH = .72;

const pickLayout = (detailed: boolean, lean: boolean) => {
  if (lean) return TINY_BUNCH;
  return detailed ? FULL_BUNCH : LEAN_BUNCH;
};

/** Lit shoulder to dark underside (vertex colour, multiplied by the part tint). */
const berryShade = (height: number) => .55 + (height + 1) * .4;

/**
 * A hanging grape bunch in the unit box (stalk end at +y): smooth-shaded low-poly berries in
 * tapered rings, each with a lit top and a shaded underside. `lean` serves the many stock bunches
 * of ware piles; Minimal uses fewer, cheaper berries.
 */
export const createGrapeBunchGeometry = (detailed: boolean, lean: boolean) => {
  const { berryRadius, profile, rings } = pickLayout(detailed, lean);
  const random = createRandom(23);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const addStalk = (from: Vector3, to: Vector3, radius: number) => {
    const axis = to.clone().sub(from).normalize();
    const across = new Vector3().crossVectors(axis, new Vector3(0, 0, 1)).normalize();
    const up = new Vector3().crossVectors(axis, across).normalize();
    const corner = (end: Vector3, index: number) => {
      const angle = index / 4 * Math.PI * 2;
      const normal = across.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle));
      const point = end.clone().addScaledVector(normal, radius);
      positions.push(point.x, point.y, point.z); normals.push(normal.x, normal.y, normal.z);
      colors.push(.45, .95, .24);
    };
    for (let index = 0; index < 4; index++) {
      corner(from, index); corner(to, index); corner(from, index + 1);
      corner(from, index + 1); corner(to, index); corner(to, index + 1);
    }
  };
  if (!lean) addStalk(new Vector3(0, .5, 0), new Vector3(.025, -.3, .015), detailed ? .025 : .022);
  const addBerry = (centre: readonly number[], tone: number, spin: number) => {
    const corner = (level: number, side: number) => {
      const [height, radius] = profile.rings[level]!, angle = spin + side / profile.sides * Math.PI * 2;
      const nx = Math.cos(angle) * radius, nz = Math.sin(angle) * radius;
      positions.push(centre[0]! + nx * berryRadius, centre[1]! + height * berryRadius * BERRY_STRETCH,
        centre[2]! + nz * berryRadius);
      normals.push(nx, height, nz);
      const shade = tone * berryShade(height);
      colors.push(shade, shade, shade);
    };
    for (let level = 0; level < profile.rings.length - 1; level += 1)
      for (let side = 0; side < profile.sides; side += 1) {
        const next = side + 1;
        // Counter-clockwise from outside; a pole ring (radius 0) needs only one triangle per side.
        if (level > 0) { corner(level, side); corner(level, next); corner(level + 1, side); }
        if (level < profile.rings.length - 2) { corner(level, next); corner(level + 1, next); corner(level + 1, side); }
      }
  };
  for (const [count, radius, height, twist] of rings) for (let berry = 0; berry < count; berry += 1) {
    const angle = twist + berry / count * Math.PI * 2;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    if (detailed && !lean && radius > .1) addStalk(new Vector3(0, height + .11, 0),
      new Vector3(x, height + berryRadius * .55, z), .012);
    addBerry([x, height, z], .82 + random() * .3, random() * Math.PI / 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  return geometry;
};
