import { Vector3 } from "three";

import {
  addRing, addTriangle, addVertex, bridgeRings, createDecorMesh, type DecorMesh, type Rgb,
toDecorGeometry} from "./japanese-decor-mesh";

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** Closes a ring with a fan round its centre: `up` faces +y (top caps), otherwise -y. */
const capRing = (mesh: DecorMesh, first: number, sides: number, centre: Vector3, color: Rgb, up: boolean) => {
  const middle = addVertex(mesh, centre, color);
  for (let side = 0; side < sides; side++) {
    const a = first + side, b = first + (side + 1) % sides;
    if (up) addTriangle(mesh, middle, b, a);
    else addTriangle(mesh, middle, a, b);
  }
};

/** Rings stacked from the top down (y, radius, colour), bridged into one closed lathe body. */
const addLathe = (mesh: DecorMesh, rows: ReadonlyArray<readonly [number, number, Rgb]>, sides: number,
  ridgeColour: (row: number, side: number) => Rgb | undefined = () => undefined) => {
  const first = mesh.positions.length / 3;
  rows.forEach(([y, radius, color], row) => addRing(mesh, new Vector3(0, y, 0), X_AXIS, Z_AXIS, radius, sides,
    side => ridgeColour(row, side) ?? color, row / (rows.length - 1)));
  bridgeRings(mesh, first, rows.length, sides);
  const [topY, , topColour] = rows[0]!, [bottomY, , bottomColour] = rows.at(-1)!;
  capRing(mesh, first, sides, new Vector3(0, topY, 0), topColour, true);
  capRing(mesh, first + (rows.length - 1) * sides, sides, new Vector3(0, bottomY, 0), bottomColour, false);
};

const LANTERN_CAP: Rgb = [.07, .06, .055];
const LANTERN_PAPER: Rgb = [.86, .17, .09];
const LANTERN_RIB: Rgb = [.6, .09, .05];

/** Barrel profile of a chochin: half width at height y (unit lantern, 1 tall and 1 wide). */
const lanternRadius = (y: number) => .5 * Math.sqrt(1 - Math.pow(y / .52, 2) * .75);

/**
 * Chochin paper lantern, 1 × 1 × 1: lacquered black top and bottom rings and a barrel of red
 * paper whose bamboo ribs stand slightly proud and darker (High). High: 7 sides, about 126
 * triangles; Minimal: 5 sides, 60.
 */
export const createPaperLanternGeometry = (detailed: boolean) => {
  const mesh = createDecorMesh(), sides = detailed ? 7 : 5;
  const body: Array<readonly [number, number, Rgb]> = detailed
    ? [.37, .19, 0, -.19, -.37].map((y, index) =>
      [y, lanternRadius(y) * (index % 2 ? 1.025 : 1), index % 2 ? LANTERN_RIB : LANTERN_PAPER] as const)
    : [.3, -.3].map(y => [y, lanternRadius(y), LANTERN_PAPER] as const);
  addLathe(mesh, [[.5, .22, LANTERN_CAP], [.42, .32, LANTERN_CAP], ...body, [-.42, .32, LANTERN_CAP],
    [-.5, .22, LANTERN_CAP]], sides);
  return toDecorGeometry(mesh);
};

const FAN_PAPER: Rgb = [.95, .85, .56];
const FAN_SUN: Rgb = [.8, .1, .06];
const FAN_RIM: Rgb = [.72, .55, .24];
const FAN_STICK: Rgb = [.24, .12, .07];
const FAN_GUARD: Rgb = [.13, .05, .04];
/** Opening of the fan, centred on straight up. */
const FAN_SPAN = Math.PI * .84;
const FAN_PAPER_ROWS = [.42, .6, .8, 1];
/** Pleat fold depth at the rim, in fan radii. */
const FAN_PLEAT = .06;

const fanAngle = (index: number, pleats: number) => Math.PI / 2 + FAN_SPAN * (index / pleats - .5);
const fanPoint = (angle: number, radius: number, depth = 0) =>
  new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, depth);

/** Paper: gold leaf with a red rising sun over the middle pleats and a darker rim. */
const fanPaperColour = (angle: number, row: number) => {
  if (row === FAN_PAPER_ROWS.length - 1) return FAN_RIM;
  return (row === 1 || row === 2) && Math.abs(angle - Math.PI / 2) < .5 ? FAN_SUN : FAN_PAPER;
};

/** A straight stick from the rivet outward, a thin quad just behind the paper. */
const addFanStick = (mesh: DecorMesh, angle: number, from: number, to: number, width: number, depth: number,
  color: Rgb) => {
  const across = new Vector3(-Math.sin(angle), Math.cos(angle), 0).multiplyScalar(width / 2);
  const inner = fanPoint(angle, from, depth), outer = fanPoint(angle, to, depth);
  const a = addVertex(mesh, inner.clone().sub(across), color), b = addVertex(mesh, inner.clone().add(across), color);
  const c = addVertex(mesh, outer.clone().sub(across), color), d = addVertex(mesh, outer.clone().add(across), color);
  mesh.indices.push(a, b, c, b, d, c);
};

/**
 * Folding war fan (gunsen) facing +z, radius 1 with its rivet at the origin, opening upward:
 * accordion-pleated paper (real folds that catch the light), a red sun, bamboo sticks and two
 * lacquered guard sticks. Minimal keeps 6 pleats and a solid stick fan.
 */
export const createFoldingFanGeometry = (detailed: boolean) => {
  const mesh = createDecorMesh(), pleats = detailed ? 14 : 6, rows = FAN_PAPER_ROWS.length;
  const first = mesh.positions.length / 3;
  for (let index = 0; index <= pleats; index++) {
    const angle = fanAngle(index, pleats), fold = index % 2 ? FAN_PLEAT : 0;
    FAN_PAPER_ROWS.forEach((radius, row) =>
      addVertex(mesh, fanPoint(angle, radius, fold * radius), fanPaperColour(angle, row), index / pleats, radius));
  }
  for (let index = 0; index < pleats; index++) for (let row = 0; row < rows - 1; row++) {
    const a = first + index * rows + row, b = a + rows, c = a + 1, d = b + 1;
    mesh.indices.push(a, c, b, b, c, d);
  }
  if (detailed) for (let index = 0; index <= pleats; index++)
    addFanStick(mesh, fanAngle(index, pleats), .05, FAN_PAPER_ROWS[0]! + .03, .035, -.004, FAN_STICK);
  else for (let index = 0; index < pleats; index++) {
    const from = fanAngle(index, pleats), to = fanAngle(index + 1, pleats);
    const hub = addVertex(mesh, fanPoint(Math.PI / 2, .05, -.004), FAN_STICK);
    const a = addVertex(mesh, fanPoint(from, FAN_PAPER_ROWS[0]! + .02, -.004), FAN_STICK);
    const b = addVertex(mesh, fanPoint(to, FAN_PAPER_ROWS[0]! + .02, -.004), FAN_STICK);
    addTriangle(mesh, hub, a, b);
  }
  for (const index of [0, pleats]) addFanStick(mesh, fanAngle(index, pleats), 0, 1.03, .07, .012, FAN_GUARD);
  return toDecorGeometry(mesh);
};

const CULM_GREEN: Rgb = [.34, .49, .16];
const CULM_TOP_GREEN: Rgb = [.49, .61, .24];
const CULM_NODE: Rgb = [.59, .65, .35];
const CULM_SHADE: Rgb = [.26, .36, .12];
const CULM_CUT: Rgb = [.82, .76, .52];
/** Nodes about every 0.35 recipe units (High): up to three on grove culms, one on thin poles. */
const NODE_SPACING = .35;
const THICK_RADIUS = .02;

const culmColour = (fraction: number): Rgb =>
  CULM_GREEN.map((value, channel) => value + (CULM_TOP_GREEN[channel]! - value) * fraction) as unknown as Rgb;

/**
 * Bamboo culm (size: diameter, height, diameter), base at the bottom of the unit box: a slightly
 * tapering green tube with pale swollen nodes over a shaded band (High) and a pale cut top. Built
 * to scale so the nodes stay round whatever the culm's length. High: 4-5 sides and up to four
 * nodes (about 30-100 triangles); Minimal: 3 sides, no nodes (9).
 */
const getCulmSides = (detailed: boolean, thick: boolean) => {
  if (!detailed) return 3;
  return thick ? 5 : 4;
};

export const createBambooCulmGeometry = (size: readonly number[], detailed: boolean) => {
  const radius = size[0]! / 2, height = size[1]!, thick = radius > THICK_RADIUS;
  const sides = getCulmSides(detailed, thick);
  const most = thick ? 3 : 1, nodes = detailed ? Math.min(most, Math.max(1, Math.round(height / NODE_SPACING))) : 0;
  const mesh = createDecorMesh();
  // The cut top shows pale fibre: a thin first band keeps the rind green just below it.
  const rows: Array<readonly [number, number, Rgb]> = [[1, .74, CULM_CUT], [.995, .74, culmColour(1)]];
  // Internodes lengthen up the culm, as on real bamboo; each node is a pale swollen ring over a shaded band.
  for (let node = nodes; node >= 1; node--) {
    const at = Math.pow(node / (nodes + 1), .85), taper = 1 - at * .26, green = culmColour(at);
    rows.push([at + .03, taper, green], [at, taper * 1.12, CULM_NODE], [at - .03, taper, CULM_SHADE]);
  }
  rows.push([0, 1, culmColour(0)]);
  addLathe(mesh, rows.map(([fraction, scale, color]) => [(fraction - .5) * height, radius * scale,
    color] as const), sides);
  return toDecorGeometry(mesh, size);
};

const LEAF_BASE: Rgb = [.87, .97, .88];
const LEAF_TIP: Rgb = [.94, 1, .91];
const LEAF_UNDER: Rgb = [.91, .98, .94];
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** One lanceolate blade with a raised midrib, drawn on both faces (front and pale underside). */
const addLeafBlade = (mesh: DecorMesh, base: Vector3, direction: Vector3, length: number, detailed: boolean) => {
  const side = new Vector3().crossVectors(direction, UP).normalize().multiplyScalar(length * .11);
  const tip = base.clone().addScaledVector(direction, length);
  const middle = base.clone().addScaledVector(direction, length * .42).addScaledVector(UP, length * .05);
  for (const front of [true, false]) {
    const shade = front ? LEAF_BASE : LEAF_UNDER, offset = front ? .002 : -.002;
    const lift = (point: Vector3) => point.clone().addScaledVector(UP, offset);
    const a = addVertex(mesh, lift(base), shade, .5, .01);
    const t = addVertex(mesh, lift(tip), front ? LEAF_TIP : LEAF_UNDER, .5, .99);
    const l = addVertex(mesh, lift(middle.clone().add(side)), shade, .02, .42);
    const r = addVertex(mesh, lift(middle.clone().sub(side)), shade, .98, .42);
    if (detailed) {
      const ridge = middle.clone().addScaledVector(UP, front ? length * .025 : 0);
      const m = addVertex(mesh, lift(ridge), front ? LEAF_TIP : LEAF_UNDER, .5, .42);
      if (front) mesh.indices.push(a, r, m, r, t, m, t, l, m, l, a, m);
      else mesh.indices.push(a, m, r, r, m, t, t, m, l, l, m, a);
    } else if (front) mesh.indices.push(a, r, t, a, t, l);
    else mesh.indices.push(a, t, r, a, l, t);
  }
};

/**
 * A spray of narrow bamboo leaves fanning out and drooping from one twig point at the top centre
 * (size: spread, droop height, spread). High: 9 blades, Minimal: 5.
 */
export const createBambooLeavesGeometry = (size: readonly number[], detailed: boolean) => {
  const mesh = createDecorMesh(), blades = detailed ? 9 : 5, spread = size[0]! / 2, droop = size[1]!;
  for (let blade = 0; blade < blades; blade++) {
    const angle = blade * GOLDEN_ANGLE, reach = spread * (.72 + .28 * ((blade * 7) % 5) / 4);
    const direction = new Vector3(Math.cos(angle) * reach, -droop * (.4 + .6 * (blade % 3) / 2), Math.sin(angle) * reach);
    const length = direction.length();
    addLeafBlade(mesh, new Vector3(0, droop / 2, 0), direction.normalize(), length, detailed);
  }
  return toDecorGeometry(mesh, size);
};
