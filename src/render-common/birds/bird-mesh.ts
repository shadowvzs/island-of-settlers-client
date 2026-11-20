import { lerp, lerp3, quadraticBezier3 } from "../../shared/world/noise";
import { FEATHER_CELL, TAIL_CELL, toCellUv } from "../flyers/flyer-atlas-layout";
import type { PropMesh, Vec3 } from "../props/mesh-builder";
import { cross, dot } from "../props/mesh-builder";
import { FEATHER_GAIN, PRIMARY_START } from "./bird-feathers";
import type { WingPose } from "./bird-flight";
import type { BirdShape, BirdSpecies, WingStation } from "./bird-species";

/**
 * Low poly bird in wingspan units (span 1 = tip to tip): forward +x, up +y, wings along z.
 * Indexed with smooth normals: a round body (shared ring vertices), a beak, eyes, a tail fan
 * and two wings (arm strips and a hand of primary feathers). `spans` is the signed distance
 * along the wing (0 body, +-1 at the tips) that drives the flap; `uvs` map the wings and tail
 * into the flyer atlas' feather cells (-1: untextured). Triangles face outwards (wings and tail
 * up), so renderers flip the normal of back faces.
 */
export interface BirdGeometry {
  colors: Float32Array;
  indices: Uint16Array;
  normals: Float32Array;
  positions: Float32Array;
  spans: Float32Array;
  uvs: Float32Array;
}

/** Outer wing parts rotate further than the arm (a curved, articulated wing beat). */
const OUTER_ANGLE_GAIN = 0.4;
/** Folding pulls the hand in and back. */
const FOLD_SPAN = 0.45;
const FOLD_SWEEP = 0.18;
const BODY_SIDES = 6;
const UP: Vec3 = [0, 1, 0];
const NO_UV: readonly [number, number] = [-1, -1];
/** Wing camber: the middle of the chord stands a little above the edges. */
const WING_CAMBER = 0.012;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];


const scaleColor = (color: Vec3, gain: number): Vec3 => [
  color[0] * gain,
  color[1] * gain,
  color[2] * gain
];

interface BirdVertex {
  color: Vec3;
  point: Vec3;
  span: number;
  uv: readonly [number, number];
}

class BirdBuilder {
  readonly colors: number[] = [];
  readonly indices: number[] = [];
  readonly positions: number[] = [];
  readonly spans: number[] = [];
  readonly uvs: number[] = [];

  vertex({ color, point, span, uv }: BirdVertex) {
    this.positions.push(...point);
    this.colors.push(...color);
    this.spans.push(span);
    this.uvs.push(...uv);
    return this.spans.length - 1;
  }

  private point(index: number): Vec3 {
    return [
      this.positions[index * 3]!,
      this.positions[index * 3 + 1]!,
      this.positions[index * 3 + 2]!
    ];
  }

  /** A triangle wound so its geometric normal points along `outward`. */
  triangle(a: number, b: number, c: number, outward: Vec3) {
    const [pa, pb, pc] = [this.point(a), this.point(b), this.point(c)];
    const normal = cross(sub(pb, pa), sub(pc, pa));
    if (dot(normal, outward) >= 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  /** Smooth normals: area weighted face normals summed per vertex. */
  private computeNormals() {
    const normals = new Float32Array(this.positions.length);
    for (let index = 0; index < this.indices.length; index += 3) {
      const corners = [this.indices[index]!, this.indices[index + 1]!, this.indices[index + 2]!];
      const [pa, pb, pc] = corners.map((corner) => this.point(corner)) as [Vec3, Vec3, Vec3];
      const normal = cross(sub(pb, pa), sub(pc, pa));
      for (const corner of corners)
        for (let axis = 0; axis < 3; axis += 1) normals[corner * 3 + axis]! += normal[axis]!;
    }
    for (let offset = 0; offset < normals.length; offset += 3) {
      const length = Math.hypot(normals[offset]!, normals[offset + 1]!, normals[offset + 2]!) || 1;
      for (let axis = 0; axis < 3; axis += 1) normals[offset + axis]! /= length;
    }
    return normals;
  }

  finish(): BirdGeometry {
    return {
      colors: Float32Array.from(this.colors),
      indices: Uint16Array.from(this.indices),
      normals: this.computeNormals(),
      positions: Float32Array.from(this.positions),
      spans: Float32Array.from(this.spans),
      uvs: Float32Array.from(this.uvs)
    };
  }
}

/** Body stations [x share of the length, radius share, height share, upper, lower colour key]. */
type ColorKey = keyof BirdShape["colors"];
const BODY_STATIONS: readonly (readonly [number, number, number, ColorKey, ColorKey])[] = [
  [0.47, 0.32, 0.16, "cap", "throat"],
  [0.4, 0.6, 0.14, "cap", "throat"],
  [0.29, 0.62, 0.11, "cap", "throat"],
  [0.18, 0.66, 0.06, "back", "breast"],
  [0.04, 1, 0, "back", "breast"],
  [-0.16, 0.86, 0.01, "back", "belly"],
  [-0.32, 0.5, 0.04, "tail", "belly"]
];
/** Ring corner colour weights: 0 upper parts on top .. 1 under parts below. */
const RING_SHADE = [0, 0.25, 0.8, 1, 0.8, 0.25];

const getRingPoint = (x: number, radius: number, lift: number, side: number): Vec3 => {
  const angle = (side / BODY_SIDES) * Math.PI * 2;
  return [x, lift + Math.cos(angle) * radius * 0.92, Math.sin(angle) * radius];
};

/** Rings of shared vertices from the face to the rump, closed by a face and a rump point. */
const addBody = (builder: BirdBuilder, shape: BirdShape) => {
  const { bodyLength: length, bodyRadius: radius, colors } = shape;
  const rings = BODY_STATIONS.map(([x, size, lift, upper, lower]) =>
    RING_SHADE.map((shade, side) =>
      builder.vertex({
        color: lerp3(colors[upper], colors[lower], shade),
        point: getRingPoint(length * x, radius * size, radius * lift * 2, side),
        span: 0,
        uv: NO_UV
      })
    )
  );
  const axisPoint = (station: number): Vec3 => [length * BODY_STATIONS[station]![0], 0, 0];
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let side = 0; side < BODY_SIDES; side += 1) {
      const next = (side + 1) % BODY_SIDES;
      const [a, b] = [rings[ring]![side]!, rings[ring]![next]!];
      const [c, d] = [rings[ring + 1]![next]!, rings[ring + 1]![side]!];
      const outward = sub(getRingPoint(0, 1, 0, side + 0.5), [0, 0, 0]);
      builder.triangle(a, b, c, outward);
      builder.triangle(a, c, d, outward);
    }
  }
  const capFace = (ring: number, tip: Vec3, color: Vec3, direction: number) => {
    const center = builder.vertex({ color, point: tip, span: 0, uv: NO_UV });
    for (let side = 0; side < BODY_SIDES; side += 1) {
      const next = (side + 1) % BODY_SIDES;
      builder.triangle(center, rings[ring]![side]!, rings[ring]![next]!, [direction, 0, 0]);
    }
  };
  const face = axisPoint(0);
  capFace(0, [face[0] + radius * 0.25, radius * 0.3, 0], colors.cap, 1);
  capFace(rings.length - 1, [-length * 0.42, radius * 0.08, 0], colors.tail, -1);
};

/** Four sided beak: upper mandible in the beak colour, the lower a little darker. */
const addBeak = (builder: BirdBuilder, shape: BirdShape) => {
  const { bodyLength: length, bodyRadius: radius, colors } = shape;
  const baseX = length * 0.47;
  const base = radius * 0.24;
  const lift = radius * 0.3;
  const tipX = baseX + length * shape.beakLength;
  const lower = scaleColor(colors.beak, 0.78);
  const corners: [Vec3, Vec3][] = [
    [[baseX, lift + base * 0.8, 0], colors.beak],
    [[baseX, lift, base], colors.beak],
    [[baseX, lift - base * 0.7, 0], lower],
    [[baseX, lift, -base], colors.beak]
  ];
  const ring = corners.map(([point, color]) =>
    builder.vertex({ color, point, span: 0, uv: NO_UV })
  );
  const tip = builder.vertex({
    color: scaleColor(colors.beak, 0.85),
    point: [tipX, lift - radius * 0.12, 0],
    span: 0,
    uv: NO_UV
  });
  for (let side = 0; side < 4; side += 1) {
    const next = (side + 1) % 4;
    const outward: Vec3 = [
      0.3,
      Math.cos((side + 0.5) * (Math.PI / 2)),
      Math.sin((side + 0.5) * (Math.PI / 2))
    ];
    builder.triangle(ring[side]!, ring[next]!, tip, outward);
  }
};

/** A small dark eye on each side of the head, just proud of its surface. */
const addEyes = (builder: BirdBuilder, shape: BirdShape) => {
  const { bodyLength: length, bodyRadius: radius } = shape;
  const size = radius * 0.13;
  const x = length * 0.4;
  for (const side of [-1, 1]) {
    const center: Vec3 = [x, radius * 0.38, side * radius * 0.5];
    const outward: Vec3 = [0.2, 0.25, side];
    const corners: Vec3[] = [
      [center[0] + size, center[1], center[2]],
      [center[0], center[1] + size, center[2]],
      [center[0] - size, center[1], center[2]],
      [center[0], center[1] - size, center[2]]
    ];
    const ring = corners.map((point) =>
      builder.vertex({ color: shape.colors.eye, point, span: 0, uv: NO_UV })
    );
    builder.triangle(ring[0]!, ring[1]!, ring[2]!, outward);
    builder.triangle(ring[0]!, ring[2]!, ring[3]!, outward);
  }
};

/** Tapered tail fan: narrow at the rump, widening to outer and inner feather tips and a notch. */
const addTail = (builder: BirdBuilder, shape: BirdShape) => {
  const root = -shape.bodyLength * 0.3;
  const end = root - shape.tailLength;
  const half = shape.tailWidth / 2;
  const notchX = end + shape.tailLength * shape.tailFork;
  const innerX = end + shape.tailLength * shape.tailFork * 0.45;
  const outline: Vec3[] = [
    [root, 0, -half * 0.3],
    [end, 0, -half],
    [innerX, 0, -half * 0.45],
    [notchX, 0, 0],
    [innerX, 0, half * 0.45],
    [end, 0, half],
    [root, 0, half * 0.3]
  ];
  const base = scaleColor(shape.colors.tail, FEATHER_GAIN);
  const tip = lerp3(base, scaleColor(shape.colors.wingTip, FEATHER_GAIN), 0.4);
  const toUv = ([x, , z]: Vec3) =>
    toCellUv(TAIL_CELL, 0.5 + (z / half) * 0.5, (root - x) / shape.tailLength);
  const center = builder.vertex({
    color: base,
    point: [root, 0, 0],
    span: 0,
    uv: toUv([root, 0, 0])
  });
  const rim = outline.map((point, index) => {
    const color = index === 0 || index === outline.length - 1 ? base : tip;
    return builder.vertex({ color, point, span: 0, uv: toUv(point) });
  });
  for (let index = 0; index < rim.length - 1; index += 1)
    builder.triangle(center, rim[index]!, rim[index + 1]!, UP);
};

/** A wing point at a span share (0 shoulder .. 1 tip) and chord share (0 lead .. 1 trail). */
interface WingFrame {
  root: number;
  side: number;
}

const getWingZ = (frame: WingFrame, span: number) =>
  frame.side * (frame.root + span * (0.5 - frame.root));

/** Arm feather UV: the arm's span maps onto the secondaries, ending where the primaries start. */
const getArmUv = (span: number, armEnd: number, chord: number) =>
  toCellUv(FEATHER_CELL, (span / armEnd) * PRIMARY_START, chord);

interface WingEdge {
  lead: number;
  mid: number;
  trail: number;
}

/** Leading (coverts), mid (greater coverts) and trailing (flight feathers) vertices. */
const addWingStation = (
  builder: BirdBuilder,
  shape: BirdShape,
  frame: WingFrame,
  station: WingStation,
  armEnd: number
): WingEdge => {
  const { covert, wing, wingTip } = shape.colors;
  const z = getWingZ(frame, station.span);
  const span = frame.side * station.span;
  const color = (from: Vec3, amount: number) =>
    scaleColor(lerp3(from, wingTip, amount), FEATHER_GAIN);
  const at = (chord: number, point: Vec3, pointColor: Vec3) =>
    builder.vertex({ color: pointColor, point, span, uv: getArmUv(station.span, armEnd, chord) });
  const midX = (station.lead + station.trail) / 2;
  return {
    lead: at(0, [station.lead, 0, z], color(covert, station.tip * 0.8)),
    mid: at(0.5, [midX, WING_CAMBER, z], color(lerp3(covert, wing, 0.6), station.tip * 0.9)),
    trail: at(1, [station.trail, 0, z], color(wing, station.tip))
  };
};

/**
 * The hand as a fan around its centre: the leading edge to the wing tip, then the primary
 * feather tips (from the tip back to the arm's trailing edge) with notches between them
 * (fingered rook wings notch deep, a swift's sickle hardly).
 */
const addHand = (
  builder: BirdBuilder,
  shape: BirdShape,
  frame: WingFrame,
  inner: WingStation,
  outer: WingStation,
  innerEdge: WingEdge
) => {
  const { wing, wingTip } = shape.colors;
  const innerZ = getWingZ(frame, inner.span);
  const outerZ = getWingZ(frame, outer.span);
  const tipLead: Vec3 = [outer.lead, 0, outerZ];
  const tipTrail: Vec3 = [outer.trail, 0, outerZ];
  const armTrail: Vec3 = [inner.trail, 0, innerZ];
  const spanAt = (z: number) => ((Math.abs(z) - frame.root) / (0.5 - frame.root)) * frame.side;
  const add = (point: Vec3, color: Vec3, u: number, v: number) =>
    builder.vertex({
      color: scaleColor(color, FEATHER_GAIN),
      point,
      span: spanAt(point[2]),
      uv: toCellUv(FEATHER_CELL, u, v)
    });
  const count = shape.primaries;
  const handU = (share: number) => 1 - share * (1 - PRIMARY_START);
  const tipColor = (share: number) => lerp3(wingTip, wing, share * 0.6 * (1 - outer.tip));
  const notchTarget: Vec3 = [lerp(inner.lead, outer.lead, 0.4), 0, lerp(innerZ, outerZ, 0.4)];
  const notchV = 1 - shape.primaryNotch * 0.6;
  const fan: number[] = [innerEdge.lead];
  for (let feather = 0; feather < count; feather += 1) {
    const share = feather / count;
    const tip = quadraticBezier3(tipLead, tipTrail, armTrail, share);
    fan.push(add(tip, tipColor(share), handU((feather + 0.5) / count), 1));
    const next = quadraticBezier3(tipLead, tipTrail, armTrail, (feather + 1) / count);
    const notch = lerp3(lerp3(tip, next, 0.5), notchTarget, shape.primaryNotch);
    fan.push(add(notch, tipColor(share + 0.5 / count), handU((feather + 1) / count), notchV));
  }
  fan.push(innerEdge.trail, innerEdge.mid);
  const centerPoint: Vec3 = [
    (inner.lead + inner.trail + outer.lead + outer.trail) / 4,
    WING_CAMBER * 0.6,
    lerp(innerZ, outerZ, 0.45)
  ];
  const hub = add(centerPoint, lerp3(wing, wingTip, 0.5), handU(0.5), 0.45);
  for (let index = 0; index < fan.length; index += 1)
    builder.triangle(hub, fan[index]!, fan[(index + 1) % fan.length]!, UP);
};

/** One wing: the arm as strips between its stations, the last segment as the feathered hand. */
const addWing = (builder: BirdBuilder, shape: BirdShape, side: number) => {
  const frame = { root: shape.bodyRadius * 0.8, side };
  const stations = shape.wing;
  const armEnd = stations[stations.length - 2]!.span;
  const edges = stations
    .slice(0, -1)
    .map((station) => addWingStation(builder, shape, frame, station, armEnd));
  for (let index = 0; index < edges.length - 1; index += 1) {
    const [inner, outer] = [edges[index]!, edges[index + 1]!];
    builder.triangle(inner.lead, outer.lead, outer.mid, UP);
    builder.triangle(inner.lead, outer.mid, inner.mid, UP);
    builder.triangle(inner.mid, outer.mid, outer.trail, UP);
    builder.triangle(inner.mid, outer.trail, inner.trail, UP);
  }
  const inner = stations[stations.length - 2]!;
  const outer = stations[stations.length - 1]!;
  addHand(builder, shape, frame, inner, outer, edges[edges.length - 1]!);
};

/** The shared mesh recipe of a species (rest pose: wings level and spread). */
export const createBirdGeometry = (shape: BirdShape): BirdGeometry => {
  const builder = new BirdBuilder();
  addBody(builder, shape);
  addBeak(builder, shape);
  addEyes(builder, shape);
  addTail(builder, shape);
  addWing(builder, shape, 1);
  addWing(builder, shape, -1);
  return builder.finish();
};

/** Wing bend angle of a vertex: the outer wing rotates further (an articulated beat). */
const getBendAngle = (along: number, angle: number) =>
  angle * (1 - OUTER_ANGLE_GAIN / 2 + OUTER_ANGLE_GAIN * along);

/**
 * Flap deformation of one rest pose point (the same maths as BIRD_WING_GLSL): the wing rotates
 * up / down about the body axis, more at the tip, and folds in and back.
 */
export const deformBirdPoint = (
  x: number,
  y: number,
  z: number,
  span: number,
  pose: WingPose,
  out: Float32Array,
  offset: number
) => {
  const along = Math.abs(span);
  const side = Math.sign(z);
  const reach = Math.abs(z) * (1 - FOLD_SPAN * pose.fold * along);
  const angle = getBendAngle(along, pose.angle);
  const wing = along > 0 ? 1 : 0;
  out[offset] = x - FOLD_SWEEP * pose.fold * along;
  out[offset + 1] = y + wing * reach * Math.sin(angle);
  out[offset + 2] = wing > 0 ? side * reach * Math.cos(angle) : z;
};

/** The normal of a deformed wing point: turned about the body axis with the wing. */
export const deformBirdNormal = (
  normal: Vec3,
  span: number,
  z: number,
  pose: WingPose,
  out: Float32Array,
  offset: number
) => {
  const along = Math.abs(span);
  const turn = along > 0 ? -Math.sign(z) * getBendAngle(along, pose.angle) : 0;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  out[offset] = normal[0];
  out[offset + 1] = normal[1] * cos - normal[2] * sin;
  out[offset + 2] = normal[1] * sin + normal[2] * cos;
};

/** GLSL twins of deformBirdPoint and deformBirdNormal (Three's vertex shader). */
export const BIRD_WING_GLSL = `
float getBirdBend(float along, float angle) {
  float gain = ${OUTER_ANGLE_GAIN.toFixed(3)};
  return angle * (1.0 - gain * 0.5 + gain * along);
}

vec3 deformBirdPoint(vec3 p, float span, float angle, float fold) {
  float along = abs(span);
  if (along <= 0.0) return p;
  float reach = abs(p.z) * (1.0 - ${FOLD_SPAN.toFixed(3)} * fold * along);
  float bend = getBirdBend(along, angle);
  return vec3(
    p.x - ${FOLD_SWEEP.toFixed(3)} * fold * along,
    p.y + reach * sin(bend),
    sign(p.z) * reach * cos(bend)
  );
}

vec3 deformBirdNormal(vec3 n, float span, float z, float angle) {
  float along = abs(span);
  if (along <= 0.0) return n;
  float turn = -sign(z) * getBirdBend(along, angle);
  float c = cos(turn);
  float s = sin(turn);
  return vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
}
`;

/** Turns a point about the up axis to a world heading (direction cos, sin in x, z). */
const rotateToHeading = (values: Float32Array, offset: number, heading: number) => {
  const x = values[offset]!;
  const z = values[offset + 2]!;
  values[offset] = x * Math.cos(heading) - z * Math.sin(heading);
  values[offset + 2] = x * Math.sin(heading) + z * Math.cos(heading);
};

const readVec3 = (values: Float32Array, vertex: number): Vec3 => [
  values[vertex * 3]!,
  values[vertex * 3 + 1]!,
  values[vertex * 3 + 2]!
];

/**
 * A posed, turned and sized species mesh as a prop mesh (the eagle critter's frames). Origin at
 * the body centre.
 */
export const createBirdPoseMesh = (
  species: BirdSpecies,
  geometry: BirdGeometry,
  pose: WingPose,
  heading: number
): PropMesh => {
  const count = geometry.spans.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const offset = vertex * 3;
    const [x, y, z] = readVec3(geometry.positions, vertex);
    const span = geometry.spans[vertex]!;
    deformBirdPoint(x, y, z, span, pose, positions, offset);
    deformBirdNormal(readVec3(geometry.normals, vertex), span, z, pose, normals, offset);
    rotateToHeading(positions, offset, heading);
    rotateToHeading(normals, offset, heading);
    for (let axis = 0; axis < 3; axis += 1) positions[offset + axis]! *= species.size;
  }
  return {
    colors: geometry.colors,
    height: species.size * 0.2,
    indices: geometry.indices,
    normals,
    positions,
    radius: species.size / 2,
    uvs: geometry.uvs,
    wind: new Float32Array(count * 2)
  };
};
