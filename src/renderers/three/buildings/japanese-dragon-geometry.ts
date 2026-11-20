import { Vector3 } from "three";

import { SCALE_REPEAT } from "./japanese-dragon-atlas";
import { addDragonHead, BODY_BELLY_ANGLE, createHeadFrame, type Head, skullRings } from "./japanese-dragon-head";
import {
  addBlade, addLoft, addOrb, addTaperedTube, createDragonMesh, type DragonMesh, type LoftRing, pathRings,
  toDragonGeometry, UP
} from "./japanese-dragon-mesh";

/** Coils round the column, from the tail at the foot to the neck under the head. */
const TURNS = 1.75;
/** Height above the last body ring left for the raised head. */
const HEAD_ROOM = 3.2;
/** The head is carved larger than the body is thick, as on temple dragons. */
const HEAD_SCALE = 1.4;
/** Relative heights of the dorsal flame tongues, repeating along the back. */
const FLAME_TONGUES = [1, .5, .8, .35, .9, .6] as const;
/** Where the hind and front legs grip the column along the coil (0 tail … 1 neck), and which way they reach. */
const LEGS = [{ reach: -1, t: .34 }, { reach: -1, t: .44 }, { reach: 1, t: .74 }, { reach: 1, t: .83 }] as const;

interface CoilShape { body: number; column: number; height: number }

/** Coil frame: centre, outward normal, (mostly) up binormal, tangent towards the head, body radius. */
export interface CoilFrame { binormal: Vector3; centre: Vector3; normal: Vector3; radius: number; tangent: Vector3 }

/** Body thickness along the coil (0 tail … 1 neck): a smooth whip tail, a full body, a slimmer neck. */
const bodyScale = (t: number) => {
  if (t < .32) return .18 + .82 * Math.sin(t / .32 * Math.PI / 2);
  if (t < .86) return 1;
  return 1 - .14 * (t - .86) / .14;
};

const coilAngle = (t: number) => Math.PI / 2 - (1 - t) * TURNS * Math.PI * 2;

/** Frame on the helix; the slimmer tail stays against the column instead of floating off it. */
const coilFrame = (t: number, { body, column, height }: CoilShape): CoilFrame => {
  const radius = body * bodyScale(t), coil = column + radius * .85;
  const theta = coilAngle(t), rise = height - body * HEAD_ROOM, turn = coil * TURNS * Math.PI * 2;
  const centre = new Vector3(Math.cos(theta) * coil, -height / 2 + body + t * (rise - body), Math.sin(theta) * coil);
  const tangent = new Vector3(-Math.sin(theta) * turn, rise - body, Math.cos(theta) * turn).normalize();
  const outward = new Vector3(Math.cos(theta), 0, Math.sin(theta));
  const normal = outward.addScaledVector(tangent, -outward.dot(tangent)).normalize();
  const binormal = new Vector3().crossVectors(tangent, normal);
  return { binormal, centre, normal, radius, tangent };
};

/**
 * One smooth tube from the tail through the neck into the skull (the head grows out of the neck:
 * same rings, radius and scale flow, no seam), the scale texture running along it; the snout tip
 * closes it and a short point closes the slim tail.
 */
const addBodyAndSkull = (mesh: DragonMesh, shape: CoilShape, head: Head, detailed: boolean) => {
  const samples = detailed ? 72 : 12, rings: LoftRing[] = [];
  let v = 0, previous: Vector3 | undefined;
  for (let index = 0; index <= samples; index++) {
    const frame = coilFrame(index / samples, shape);
    v += previous ? frame.centre.distanceTo(previous) / SCALE_REPEAT : 0;
    previous = frame.centre;
    rings.push({ centre: frame.centre, height: frame.radius, side: frame.normal, up: frame.binormal, v,
      width: frame.radius });
  }
  const skull = skullRings(head, coilFrame(1, shape), v, detailed);
  addLoft(mesh, [...rings, ...skull.rings], { bellyAngle: BODY_BELLY_ANGLE, sides: detailed ? 16 : 8,
    strip: "wrap", tip: skull.tip });
  const tail = coilFrame(0, shape);
  addTaperedTube(mesh, [tail.centre.clone().addScaledVector(tail.tangent, shape.body * .3),
    tail.centre.clone().addScaledVector(tail.tangent, -shape.body * 1.1)], [tail.radius, 0], detailed ? 8 : 4,
    "scales");
};

/** Ridge point on the body's upper outer side, just under the surface. */
/** The back's ridge direction: up and outward, so the flames show from the street. */
const ridgeDirection = (frame: CoilFrame) => frame.normal.clone().multiplyScalar(.7).add(frame.binormal).normalize();

const ridgePoint = (frame: CoilFrame) => frame.centre.clone().addScaledVector(ridgeDirection(frame), frame.radius * .8);

/** Flame fin along the back: orange tongues of uneven height licking back towards the tail. */
const addDorsalFin = (mesh: DragonMesh, shape: CoilShape, detailed: boolean) => {
  const spines = detailed ? 64 : 10, bases: Vector3[] = [], tips: Vector3[] = [];
  for (let index = 2; index < spines - 1; index++) {
    const frame = coilFrame(index / spines, shape), base = ridgePoint(frame);
    const tongue = FLAME_TONGUES[(detailed ? index : index * 3) % FLAME_TONGUES.length]!;
    const height = shape.body * (.55 + .85 * bodyScale(index / spines)) * tongue;
    bases.push(base);
    tips.push(base.clone().addScaledVector(ridgeDirection(frame), height)
      .addScaledVector(frame.tangent, -shape.body * .9));
  }
  addBlade(mesh, bases, tips, "flame");
};

/** Flame tuft at the tail tip (High). */
const addTailFlame = (mesh: DragonMesh, shape: CoilShape) => {
  const tail = coilFrame(.03, shape), { body } = shape;
  const back = (reach: number, lift: number) =>
    tail.centre.clone().addScaledVector(tail.tangent, -body * reach).addScaledVector(tail.binormal, body * lift);
  addBlade(mesh, [back(.2, 0), back(.9, 0), back(1.5, 0)], [back(.5, .9), back(1.3, 1.1), back(2.2, .6)],
    "flame");
};

/** Point on the column surface (`inset` from the axis) at the angle and height of `point`. */
const onColumn = (point: Vector3, inset: number) =>
  new Vector3(point.x, 0, point.z).normalize().multiplyScalar(inset).setY(point.y);

/** Sharp pale claws from the wrist, curling round the column and biting into its surface. */
const addClaws = (mesh: DragonMesh, wrist: Vector3, shape: CoilShape, detailed: boolean) => {
  const radial = new Vector3(wrist.x, 0, wrist.z).normalize(), around = new Vector3().crossVectors(UP, radial);
  const down = UP.clone().negate();
  const toes = detailed ? [around, around.clone().negate(), down] : [around, around.clone().negate()];
  for (const toe of toes) {
    const reach = wrist.clone().addScaledVector(toe, shape.body * .8);
    const knuckle = onColumn(wrist.clone().lerp(reach, .45), shape.column + shape.body * .16);
    const tip = onColumn(reach, shape.column - shape.body * .05);
    addTaperedTube(mesh, detailed ? [wrist, knuckle, tip] : [wrist, tip],
      detailed ? [shape.body * .11, shape.body * .08, 0] : [shape.body * .1, 0], detailed ? 5 : 3, "ivory",
      detailed ? 4 : 2);
  }
};

/** A smooth bent leg (thigh, elbow, forearm) from the body's underside to a foot gripping the column. */
const addLeg = (mesh: DragonMesh, shape: CoilShape, leg: typeof LEGS[number], detailed: boolean) => {
  const frame = coilFrame(leg.t, shape), { body } = shape;
  const hip = frame.centre.clone().addScaledVector(frame.binormal, -body * .3);
  const elbow = frame.centre.clone().addScaledVector(frame.normal, body * .8).addScaledVector(frame.binormal, -body)
    .addScaledVector(frame.tangent, leg.reach * body * .55);
  const footAngle = coilAngle(leg.t) + leg.reach * .35;
  const foot = new Vector3(Math.cos(footAngle), 0, Math.sin(footAngle)).multiplyScalar(shape.column)
    .setY(frame.centre.y - body * 1.7);
  const wrist = foot.clone().add(new Vector3(foot.x, 0, foot.z).normalize().multiplyScalar(body * .25));
  const outward = new Vector3(elbow.x, 0, elbow.z).normalize();
  const radii = [body * .46, body * .36, body * .24];
  const rings = pathRings([hip, elbow, wrist], radii, radii, outward, detailed ? 10 : 3, SCALE_REPEAT / 2);
  addLoft(mesh, rings, { sides: detailed ? 10 : 4, strip: "wrap",
    tip: wrist.clone().addScaledVector(rings.at(-1)!.side.clone().cross(rings.at(-1)!.up), body * .2) });
  addClaws(mesh, wrist, shape, detailed);
  // The last (upper front) foot holds the pearl against the column, resting in its claws.
  const pearl = wrist.clone().addScaledVector(outward, body * .32).addScaledVector(UP, body * .1);
  if (leg === LEGS.at(-1)) addOrb(mesh, pearl, body * .3, detailed ? 12 : 6, detailed ? 8 : 3, "pearl");
  if (!detailed) return;
  const tuft = (reach: number, lift: number) => elbow.clone().addScaledVector(frame.tangent, -leg.reach * body * reach)
    .addScaledVector(frame.binormal, -body * lift);
  addBlade(mesh, [tuft(0, .1), tuft(.35, .2)], [tuft(.7, .55), tuft(1, .45)], "flame");
};

/**
 * Dragon (ryu) coiled round a column, as lacquered carved wood with gold leaf (one atlas material,
 * japanese-dragon-texture.ts): size = coil diameter (column plus body), height, body thickness.
 * A smooth scaled body winds 1¾ turns up from a flame-tipped tail, with a carved dorsal fin (High),
 * four bent legs whose gilt claws grip the column and a horned head holding a pearl in its jaws,
 * looking out (+z) at the top. High stays under 8,000 triangles (owner: quality first); Minimal stays
 * under 1,150.
 */
export const createDragonCoilGeometry = (size: readonly number[], detailed: boolean) => {
  const body = size[2]! / 2, shape: CoilShape = { body, column: size[0]! / 2 - body * .85, height: size[1]! };
  const mesh = createDragonMesh();
  const head = createHeadFrame(coilFrame(1, shape), body * HEAD_SCALE);
  addBodyAndSkull(mesh, shape, head, detailed);
  for (const leg of LEGS) addLeg(mesh, shape, leg, detailed);
  addDorsalFin(mesh, shape, detailed);
  if (detailed) addTailFlame(mesh, shape);
  addDragonHead(mesh, head, detailed);
  return toDragonGeometry(mesh, size);
};
