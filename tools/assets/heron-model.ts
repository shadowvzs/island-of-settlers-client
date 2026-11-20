import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Vector3 } from "three";

import type { Vec3 } from "../../src/render-common/props/mesh-builder";
import type { BoneOffsets, BoneScales } from "./gltf-skin-sampler";
import { mergeOffsets, pitch, roll } from "./quadruped-rig";
import {
  buildSkinnedCritter,
  type CritterFrameSpec,
  getRegionWeights,
  getScaleForLength,
  writeReview
} from "./skinned-critter";
import {
  createRiggedSource,
  duplicateTriangles,
  placeMesh,
  readGlbBytes,
  readStaticMesh,
  type RigBone,
  type StaticMesh,
  turn,
  weighBySegments,
  type WeightBone} from "./static-rig";
import { bakeVertexColors } from "./texture-bake";

/**
 * Builds the grey heron critter (assets/models/critters/heron/heron.glb) from the owner's
 * download ("Great blue heron" by faerbogdan99, CC BY 4.0; resources/models/animals/critters,
 * never shipped raw), recoloured to a grey heron: white neck and face with the black crown
 * stripe and plumes, grey back and wings, black flight feathers. The static source stands with
 * its wings folded; it is rigged here (neck chain, legs, tail) and its folded wings are copied
 * into spreadable wings, hidden in the shoulder except in flight. Frames (wader-models.ts
 * order): stand, alert, a four frame walk, aim and strike, wings up and down.
 * Usage: npx tsx tools/assets/heron-model.ts [review.json]
 */

const SOURCE = process.env.HERON_SOURCE ?? "../resources/models/animals/critters/great-blue-heron.glb";
/** Tail to bill tip in island units: the earlier heron critter's length. */
const LENGTH = 0.44;
const STEPS = [0, 0.25, 0.5, 0.75];

/** Rig of the standing source (scene metres, facing +z, left side +x). */
const BONES: RigBone[] = [
  { at: [0, 1.05, -0.12], name: "body" },
  { at: [0, 1.36, 0.28], name: "neck0", parent: "body" },
  { at: [0, 1.6, 0.17], name: "neck1", parent: "neck0" },
  { at: [0, 1.76, 0.11], name: "neck2", parent: "neck1" },
  { at: [0, 1.84, 0.22], name: "head", parent: "neck2" },
  { at: [0, 0.95, -0.45], name: "tail", parent: "body" },
  ...[1, -1].flatMap((side): RigBone[] => {
    const name = side > 0 ? "L" : "R";
    return [
      { at: [0.09 * side, 0.92, -0.14], name: `leg${name}0`, parent: "body" },
      { at: [0.105 * side, 0.6, -0.21], name: `leg${name}1`, parent: `leg${name}0` },
      { at: [0.105 * side, 0.04, -0.17], name: `leg${name}2`, parent: `leg${name}1` },
      { at: [0.19 * side, 1.3, 0.06], name: `wing${name}`, parent: "body" }
    ];
  })
];
const BEAK: Vec3 = [0, 1.74, 0.77];
const TAIL_TIP: Vec3 = [0, 0.74, -0.74];
const TOE: Vec3 = [0.105, 0.005, 0.05];
const TRUNK_RADIUS = 0.17;

const smooth = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** The folded wing's outer surface on one side (copied into the spreadable wing). */
const isFoldedWing = (mesh: StaticMesh, vertex: number, side: number) => {
  const [x, y, z] = mesh.positions.subarray(vertex * 3, vertex * 3 + 3);
  const outward = mesh.normals[vertex * 3]! * side;
  return x! * side > 0.11 && y! > 0.72 && y! < 1.42 && z! > -0.8 && z! < 0.2 && outward > 0.3;
};

const createWeightBones = (bone: (name: string) => number): WeightBone[] => {
  const at = (name: string) => BONES[bone(name)]!.at;
  const segment = (name: string, to: Vec3, extra: Partial<WeightBone> = {}): WeightBone =>
    ({ bone: bone(name), from: at(name), to, ...extra });
  const legs = [1, -1].flatMap((side) => {
    const name = side > 0 ? "L" : "R";
    const allow = (point: Vec3) => smooth(0, 0.04, point[0] * side) * smooth(0.9, 0.82, point[1]);
    return [
      segment(`leg${name}0`, at(`leg${name}1`), { allow }),
      segment(`leg${name}1`, at(`leg${name}2`), { allow }),
      segment(`leg${name}2`, [TOE[0] * side, TOE[1], TOE[2]], { allow })
    ];
  });
  return [
    segment("body", at("neck0"), { radius: TRUNK_RADIUS }),
    segment("neck0", at("neck1")),
    segment("neck1", at("neck2")),
    segment("neck2", at("head")),
    segment("head", BEAK),
    segment("tail", TAIL_TIP, { allow: (point) => smooth(-0.4, -0.5, point[2]) }),
    ...legs
  ];
};

/** Copies the folded wings (the copies move with their wing bone only) and rigs the heron. */
const rigHeron = (source: StaticMesh) => {
  let mesh = source;
  const sourceVertices = source.positions.length / 3;
  const wings: { first: number; side: number }[] = [];
  for (const side of [1, -1]) {
    const copy = duplicateTriangles(mesh, (corners) =>
      corners.every((vertex) => vertex < sourceVertices && isFoldedWing(source, vertex, side)));
    wings.push({ first: mesh.positions.length / 3, side });
    mesh = copy;
  }
  const bone = (name: string) => BONES.findIndex((entry) => entry.name === name);
  const rig = weighBySegments(mesh.positions, createWeightBones(bone));
  const count = mesh.positions.length / 3;
  wings.forEach(({ first, side }, index) => {
    const last = wings[index + 1]?.first ?? count;
    for (let vertex = first; vertex < last; vertex += 1) {
      rig.joints.set([bone(side > 0 ? "wingL" : "wingR"), 0, 0, 0], vertex * 4);
      rig.weights.set([1, 0, 0, 0], vertex * 4);
    }
  });
  return { mesh, source: createRiggedSource(mesh, BONES, rig) };
};

/** Grey heron coat (sRGB): the bill and legs kept, the rest neutral greys and white. */
const NECK_WHITE = 0.9;
const BACK_TINT = [0.96, 0.99, 1.04] as const;
/** The back and wings a medium grey (the source is pale blue-grey). */
const BACK_SHADE = 0.78;

const paintGreyHeron = (colors: Float32Array, neck: Float32Array) => {
  const out = colors.slice();
  for (let vertex = 0; vertex < neck.length; vertex += 1) {
    const [r, g, b] = colors.subarray(vertex * 3, vertex * 3 + 3) as unknown as number[];
    const high = Math.max(r!, g!, b!);
    const saturation = high > 0 ? (high - Math.min(r!, g!, b!)) / high : 0;
    const yellow = r! > b! * 1.6 && g! > b! * 1.2 && saturation > 0.45;
    if (yellow) continue;
    const light = 0.3 * r! + 0.55 * g! + 0.15 * b!;
    const whiten = neck[vertex]! * smooth(0.22, 0.4, light);
    const grey = light * (BACK_SHADE + (1 - BACK_SHADE) * neck[vertex]!) * (1 - whiten) + NECK_WHITE * whiten;
    out.set(BACK_TINT.map((tint) => Math.min(1, grey * (1 + (tint - 1) * (1 - whiten)))), vertex * 3);
  }
  return out;
};

/** The outer half of the spread wings: the black primaries of a grey heron. */
const PRIMARIES = [0.13, 0.13, 0.15] as const;
const WING_LENGTH = 0.95;

const darkenPrimaries = (colors: Float32Array, mesh: StaticMesh, wing: Float32Array) => {
  const out = colors.slice();
  for (let vertex = 0; vertex < wing.length; vertex += 1) {
    if (wing[vertex]! < 0.5) continue;
    const side = mesh.positions[vertex * 3]! > 0 ? "wingL" : "wingR";
    const shoulder = BONES.find((bone) => bone.name === side)!.at;
    const reach = Math.hypot(...[0, 1, 2].map((axis) => mesh.positions[vertex * 3 + axis]! - shoulder[axis]!));
    const dark = smooth(0.3, 0.7, reach / WING_LENGTH) * 0.9;
    for (let channel = 0; channel < 3; channel += 1) {
      out[vertex * 3 + channel] = out[vertex * 3 + channel]! + (PRIMARIES[channel]! - out[vertex * 3 + channel]!) * dark;
    }
  }
  return out;
};

const HIDDEN = new Vector3(0.001, 0.001, 0.001);
const FOLDED: BoneScales = { wingL: HIDDEN, wingR: HIDDEN };
/** Spread wings: stretched (span and chord) and turned out flat, the leading edge forward. */
const SPREAD = new Vector3(1, 1.4, 1.4);
const spreadWing = (side: number, flap: number) =>
  mergeOffsets(
    { wing: roll(side * flap) },
    { wing: turn([0, 1, 0], -side) },
    { wing: roll(side * Math.PI / 2) }
  ).wing!;

const legs = (left: [number, number], right: [number, number]): BoneOffsets => ({
  legL0: pitch(left[0]), legL1: pitch(left[1]), legL2: pitch(-left[0] - left[1]),
  legR0: pitch(right[0]), legR1: pitch(right[1]), legR2: pitch(-right[0] - right[1])
});

/** One walking step: the swinging leg forward with the foot lifted, the other sweeping back. */
const walk = (phase: number): BoneOffsets => {
  const leg = (offset: number): [number, number] => {
    const angle = Math.PI * 2 * (phase + offset);
    return [-0.28 * Math.sin(angle), 0.55 * Math.max(0, Math.cos(angle))];
  };
  return mergeOffsets(legs(leg(0), leg(0.5)), { neck0: pitch(0.12) });
};

const neckPose = (base: number, middle: number, top: number, head = 0): BoneOffsets =>
  ({ head: pitch(head), neck0: pitch(base), neck1: pitch(middle), neck2: pitch(top) });

const flight = (flap: number): CritterFrameSpec => ({
  clip: 0,
  offsets: mergeOffsets(
    { body: pitch(0.45) },
    legs([1.15, 0.2], [1.15, 0.2]),
    neckPose(-0.2, 0.5, 0.3, -0.45),
    { wingL: spreadWing(1, flap), wingR: spreadWing(-1, flap) }
  ),
  scales: { wingL: SPREAD, wingR: SPREAD },
  time: 0
});

const still = (offsets: BoneOffsets): CritterFrameSpec => ({ clip: 0, offsets, scales: FOLDED, time: 0 });

const placed = readStaticMesh(readGlbBytes(readFileSync(resolve(SOURCE))));
placeMesh(placed, 0);
const { mesh, source } = rigHeron(placed);
const coat = darkenPrimaries(
  paintGreyHeron(bakeVertexColors(mesh), getRegionWeights(source, { head: 1, neck: 1 })),
  mesh,
  getRegionWeights(source, { wing: 1 })
);
const packed = await buildSkinnedCritter({
  coats: { summer: coat, winter: coat },
  copyright: "Derived from \"Great blue heron\" by faerbogdan99 (CC BY 4.0), see LICENSE.txt",
  highShare: 0.065,
  look: { pivot: "neck2", weights: getRegionWeights(source, { head: 1 }) },
  minimalShare: 0.5,
  name: "heron",
  scale: getScaleForLength(source, { clip: 0 }, LENGTH),
  simplifyPose: flight(0),
  source,
  specs: [
    still({}),
    still(neckPose(-0.35, -0.3, -0.1, 0.15)),
    ...STEPS.map((phase) => still(walk(phase))),
    still(mergeOffsets({ body: pitch(0.2) }, neckPose(0.3, 0.15, 0.05, 0.45))),
    still(mergeOffsets({ body: pitch(0.6) }, legs([-0.6, 0], [-0.6, 0]), neckPose(0.85, -0.45, -0.3, 0.6))),
    flight(0.55),
    flight(-0.45)
  ],
  standClip: 0,
  target: "assets/models/critters/heron/heron.glb"
});
writeReview(process.argv[2], packed);
