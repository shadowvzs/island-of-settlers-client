import type { Random } from "../../shared/world/rng";
import {
  MeshBuilder,
  normalize,
  type PropMesh,
  type Vec3,
  type VertexStyle
} from "../props/mesh-builder";
import { add, addCurvedTube, scale, subtract } from "../props/tree-parts";
import { getLimbAlong, toBarkUv } from "./bark-uv";
import { PALM_RECTS } from "./foliage-atlas";
import { PALM_CELL } from "./palm-atlas";
import { tintDry } from "./palm-frond";
import { createFrondSurface, getBladeRows, getPetioleEnd } from "./palm-frond-surface";
import type { Frond, TreeLook, TreeModel } from "./tree-model";

const TRUNK_SIDES = 7;
const PETIOLE_SIDES = 3;
const PETIOLE_GREEN: Vec3 = [0.42, 0.42, 0.24];
const PETIOLE_OLD: Vec3 = [0.46, 0.38, 0.24];
const LEAF_BASE_TONE: Vec3 = [0.5, 0.4, 0.28];
/** Close-up leaflet group cards per mature frond (LOD detail). */
const LEAFLET_CARDS = [0.38, 0.62];

type Transform = (point: Vec3) => Vec3;

/** Builder plus the explicit wind bend weight of every vertex (hierarchical palm wind). */
interface PalmBuilder {
  bend: number[];
  builder: MeshBuilder;
  look: TreeLook;
  model: TreeModel;
  random: Random;
  toIsland: Transform;
  units: number;
}

const flat = (color: Vec3, flutter = 0): VertexStyle => ({ color: () => color, flutter });

/** Trunk sway: almost stable, the crown head moves a little (rel = height / tree height). */
const getTrunkBend = (palm: PalmBuilder, y: number) => {
  const relative = Math.max(0, y / Math.max(palm.model.bounds.height, 0.01));
  return palm.look.wind.trunk * relative * relative;
};

/** Records the bend weight of the vertices added since `first`. */
const recordBend = (palm: PalmBuilder, first: number, bendAt: (vertex: number) => number) => {
  for (let vertex = first; vertex < palm.builder.vertexCount; vertex += 1)
    palm.bend[vertex] = bendAt(vertex);
};

const shadeColor = (color: Vec3, factor: number): Vec3 => [
  color[0] * factor,
  color[1] * factor,
  color[2] * factor
];

/** Ringed / leaf-base / fibrous trunk: the Three shader draws the family from the bark uv. */
const addTrunk = (palm: PalmBuilder) => {
  const trunk = palm.model.wood[0];
  if (!trunk) return;
  const { look, random } = palm;
  const along = getLimbAlong(trunk.points, trunk.radii);
  const top = trunk.points[trunk.points.length - 1]![1];
  const style: VertexStyle = {
    color: (position) => {
      const t = Math.min(1, Math.max(0, position[1] / (Math.max(top, 0.01) * palm.units)));
      const tone = add(look.bark, scale(subtract(look.barkTop, look.bark), t));
      return shadeColor(tone, (0.8 + 0.2 * Math.min(1, t * 4)) * (0.95 + random() * 0.1));
    },
    flutter: 0
  };
  const first = palm.builder.vertexCount;
  addCurvedTube(
    palm.builder,
    trunk.points.map(palm.toIsland),
    trunk.radii.map((radius) => radius * palm.units),
    TRUNK_SIDES,
    style,
    undefined,
    (index, around) => toBarkUv(around, along[index]!, look.barkFamily)
  );
  recordBend(palm, first, (vertex) => {
    const point = trunk.points[Math.floor((vertex - first) / (TRUNK_SIDES + 1))]!;
    return getTrunkBend(palm, point[1]);
  });
};

/** Old cut leaf bases: short open cones (cheap), sharing the trunk's sway at their height. */
const addLeafBases = (palm: PalmBuilder) => {
  const style = flat(shadeColor(LEAF_BASE_TONE, 0.9 + palm.random() * 0.15));
  for (const stub of palm.model.wood.slice(1)) {
    const first = palm.builder.vertexCount;
    const radii = stub.radii.map((radius) => radius * palm.units);
    addCurvedTube(palm.builder, stub.points.map(palm.toIsland), radii, PETIOLE_SIDES, style);
    const bend = getTrunkBend(palm, stub.points[0]![1]);
    recordBend(palm, first, () => bend);
  }
};

/** Frond bend: the petiole moves a little, the rachis more, outer (old) fronds most. */
const getFrondBend = (palm: PalmBuilder, frond: Frond, along: number) => {
  const head = getTrunkBend(palm, frond.points[0]![1]);
  return head + palm.look.wind.branch * Math.pow(along, 1.5) * (0.7 + frond.age * 0.5);
};

/** Petiole and rachis: green, straw coloured on old and dead fronds. */
const getStalkTone = (frond: Frond) =>
  frond.age > 0.75 || frond.dry > 0 ? PETIOLE_OLD : PETIOLE_GREEN;

/** Petiole: a tapering stalk from the crown shaft to the first leaflets (fan: the fan centre). */
const addPetiole = (palm: PalmBuilder, frond: Frond, trunkRadius: number) => {
  const points = frond.points
    .slice(0, getPetioleEnd(frond) + 1)
    .filter((_, index, list) => index % 2 === 0 || index === list.length - 1);
  if (points.length < 2) return;
  const base = Math.max(trunkRadius * 0.32, 0.02);
  const radii = points.map(
    (_, index) => base * (1 - (index / (points.length - 1)) * 0.6) * palm.units
  );
  const color = shadeColor(getStalkTone(frond), frond.shade + 0.2);
  const first = palm.builder.vertexCount;
  addCurvedTube(palm.builder, points.map(palm.toIsland), radii, PETIOLE_SIDES, flat(color));
  const bend = getFrondBend(palm, frond, 0.05);
  recordBend(palm, first, () => bend);
};

/** Blade colour: frond shade, the tree's tint, a light base-to-tip gradient, dead leaves dry. */
const getBladeColor = (palm: PalmBuilder, frond: Frond, along: number): Vec3 => {
  const shade = frond.shade * (0.9 + along * 0.14);
  const tint = palm.look.foliage;
  return tintDry([shade * tint[0], shade * tint[1], shade * tint[2]], frond.dry);
};

/** The leaf blade on its atlas cell; leaflet edges flutter, the rachis less. */
const addBlade = (palm: PalmBuilder, frond: Frond) => {
  const surface = createFrondSurface(frond);
  const first = palm.builder.vertexCount;
  for (const vertex of surface.vertices) {
    const flutter = (0.2 + Math.abs(vertex.across) * 0.8) * vertex.along * (0.6 + frond.age * 0.6);
    palm.builder.addVertex(
      palm.toIsland(vertex.position),
      vertex.normal,
      flat(getBladeColor(palm, frond, vertex.along), flutter),
      vertex.uv
    );
  }
  for (let index = 0; index < surface.triangles.length; index += 3) {
    palm.builder.addTriangle(
      first + surface.triangles[index]!,
      first + surface.triangles[index + 1]!,
      first + surface.triangles[index + 2]!
    );
  }
  recordBend(palm, first, (vertex) =>
    getFrondBend(palm, frond, surface.vertices[vertex - first]!.along)
  );
};

/** Close-up only: the rachis as real geometry along the blade. */
const addRachis = (palm: PalmBuilder, frond: Frond, trunkRadius: number) => {
  const rows = getBladeRows(frond);
  const points = rows.map((index) => frond.points[index]!);
  const base = Math.max(trunkRadius * 0.14, 0.012) * palm.units;
  const radii = points.map((_, index) => base * (1 - (index / (points.length - 1)) * 0.8));
  const color = shadeColor(getStalkTone(frond), frond.shade + 0.15);
  const first = palm.builder.vertexCount;
  addCurvedTube(palm.builder, points.map(palm.toIsland), radii, PETIOLE_SIDES, flat(color));
  const span = rows[rows.length - 1]! - frond.leafletStart;
  recordBend(palm, first, (vertex) => {
    const row = Math.floor((vertex - first) / (PETIOLE_SIDES + 1));
    return getFrondBend(palm, frond, (rows[row]! - frond.leafletStart) / Math.max(1, span));
  });
};

/** Close-up only: leaflet group cards hanging off the blade plane (breaks the flat strip). */
const addLeafletCards = (palm: PalmBuilder, frond: Frond) => {
  const { random } = palm;
  const last = frond.points.length - 1;
  for (const along of LEAFLET_CARDS) {
    const index = Math.round(frond.leafletStart + (last - frond.leafletStart) * along);
    const point = frond.points[index]!;
    const tangent = normalize(subtract(frond.points[Math.min(last, index + 1)]!, point));
    const outward = normalize(add(normalize([tangent[2], 0, -tangent[0]]), [0, 0, 0]));
    const sideSign = random() < 0.5 ? -1 : 1;
    const direction = normalize(
      add(add(scale(outward, sideSign), scale(tangent, 0.5)), [0, -0.9, 0])
    );
    const length = frond.widths[index]! * 1.15;
    const half = scale(tangent, length * 0.09);
    const tip = add(point, scale(direction, length));
    const cell = PALM_RECTS[random() < frond.age ? PALM_CELL.leaflet02 : PALM_CELL.leaflet01]!;
    const normal = normalize([-direction[0], 0.4, -direction[2]]);
    const color = getBladeColor(palm, frond, along);
    const first = palm.builder.vertexCount;
    const corners: [Vec3, number, number][] = [
      [subtract(point, half), cell.u0, cell.v0],
      [add(point, half), cell.u0, cell.v1],
      [add(tip, half), cell.u1, cell.v1],
      [subtract(tip, half), cell.u1, cell.v0]
    ];
    corners.forEach(([position, u, v], corner) =>
      palm.builder.addVertex(
        palm.toIsland(position),
        normal,
        flat(color, corner >= 2 ? 0.8 : 0.2),
        [u, v]
      )
    );
    palm.builder.addTriangle(first, first + 1, first + 2);
    palm.builder.addTriangle(first, first + 2, first + 3);
    recordBend(palm, first, () => getFrondBend(palm, frond, along));
  }
};

/** Fruit: tiny dates as tetrahedra (4 triangles), coconuts as closed octahedra (8 triangles). */
const addFruit = (palm: PalmBuilder) => {
  for (const fruit of palm.model.fruit) {
    const centre = palm.toIsland(fruit.position);
    const radius = fruit.radius * palm.units;
    const first = palm.builder.vertexCount;
    if (radius < .05) {
      const axes: Vec3[] = [
        normalize([1, 1, 1]), normalize([-1, -1, 1]),
        normalize([-1, 1, -1]), normalize([1, -1, -1])
      ];
      const style = flat(shadeColor(fruit.color, 0.9 + palm.random() * 0.2));
      for (const axis of axes) palm.builder.addVertex(add(centre, scale(axis, radius)), axis, style);
      for (const [a, b, c] of [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]]) {
        palm.builder.addTriangle(first + a!, first + b!, first + c!);
      }
      const bend = getTrunkBend(palm, fruit.position[1]);
      recordBend(palm, first, () => bend);
      continue;
    }
    const axes: Vec3[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1.15, 0],
      [0, -1.15, 0],
      [0, 0, 1],
      [0, 0, -1]
    ];
    const style = flat(shadeColor(fruit.color, 0.9 + palm.random() * 0.2));
    for (const axis of axes)
      palm.builder.addVertex(add(centre, scale(axis, radius)), normalize(axis), style);
    for (const [a, b, c] of [
      [0, 2, 4],
      [4, 2, 1],
      [1, 2, 5],
      [5, 2, 0],
      [4, 3, 0],
      [1, 3, 4],
      [5, 3, 1],
      [0, 3, 5]
    ]) {
      palm.builder.addTriangle(first + a!, first + b!, first + c!);
    }
    const bend = getTrunkBend(palm, fruit.position[1]);
    recordBend(palm, first, () => bend);
  }
};

const isMatureBlade = (frond: Frond) =>
  frond.blade === "pinnate" && frond.cell !== PALM_CELL.young01;

/**
 * Island palm: trunk with its bark family, leaf bases, petioles, fronds as curved blades on
 * their atlas cells, fruit; close-up detail (Three only, coreIndexCount): real rachis tubes and
 * leaflet group cards. Wind is hierarchical: trunk almost stable, petioles a little, the rachis
 * more, leaflet edges flutter, old outer fronds move most.
 */
export const createPalmIslandMesh = (model: TreeModel, units: number, random: Random): PropMesh => {
  const builder = new MeshBuilder();
  const palm: PalmBuilder = {
    bend: [],
    builder,
    look: model.look!,
    model,
    random,
    toIsland: (point) => scale(point, units),
    units
  };
  const trunkRadius = model.wood[0]?.radii[1] ?? 0.1;
  addTrunk(palm);
  addLeafBases(palm);
  for (const frond of model.fronds) {
    addPetiole(palm, frond, trunkRadius);
    addBlade(palm, frond);
  }
  addFruit(palm);
  builder.detail = true;
  for (const frond of model.fronds.filter(isMatureBlade)) {
    addRachis(palm, frond, trunkRadius);
    addLeafletCards(palm, frond);
  }
  builder.detail = false;
  const mesh = builder.finish();
  palm.bend.forEach((bend, vertex) => {
    mesh.wind[vertex * 2] = bend;
  });
  return mesh;
};
