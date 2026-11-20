import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Vec3 } from "../../src/render-common/props/mesh-builder";
import type { BoneOffsets } from "./gltf-skin-sampler";
import { mergeOffsets, pitch } from "./quadruped-rig";
import {
  buildSkinnedCritter,
  type CritterFrameSpec,
  getRegionWeights,
  getScaleForLength,
  writeReview
} from "./skinned-critter";
import {
  createRiggedSource,
  placeMesh,
  readGlbBytes,
  readStaticMesh,
  type RigBone,
  turn,
  weighBySegments,
  type WeightBone} from "./static-rig";
import { bakeVertexColors } from "./texture-bake";

/**
 * Builds the harbour seal critter (assets/models/critters/seal/seal.glb) from the owner's
 * download ("Dotted White Seal - Free Giveaway" by Kugatsu Tsukai 3D Models Hub, CC BY 4.0;
 * resources/models/animals/critters, never shipped raw), recoloured from the white, brown
 * dotted pup to a harbour seal: grey with dark spots and a paler belly. The static source (lying
 * with the head raised) is rigged here (front: chest, neck, head and the fore flippers; rear:
 * hips and hind flippers) and posed into the seal frames (seal.ts SEAL_FRAME order): lying,
 * head up, looks, the banana, the two crawl humps and swimming.
 * Usage: npx tsx tools/assets/seal-model.ts [review.json]
 */

const SOURCE = process.env.SEAL_SOURCE ?? "../resources/models/animals/critters/seal-dotted-white.glb";
/** Nose to hind flippers in island units: the earlier seal critter's length. */
const LENGTH = 0.92;
const LOOK = 0.6;
/** Swimming: how far the body sinks under the surface (island units). */
const SWIM_DEPTH = 0.075;

/** Rig of the source lying facing +z (scene metres, left side +x, fore flippers at x ±0.25 .. 0.5). */
const BONES: RigBone[] = [
  { at: [0, 0.22, 0], name: "body" },
  { at: [0, 0.3, 0.3], name: "chest", parent: "body" },
  { at: [0, 0.45, 0.62], name: "neck", parent: "chest" },
  { at: [0, 0.6, 0.8], name: "head", parent: "neck" },
  { at: [0, 0.15, -0.45], name: "hips", parent: "body" },
  { at: [0, 0.08, -0.72], name: "flippers", parent: "hips" },
  { at: [0.22, 0.12, 0.15], name: "foreL", parent: "chest" },
  { at: [-0.22, 0.12, 0.15], name: "foreR", parent: "chest" }
];
const NOSE: Vec3 = [0, 0.66, 0.98];
const TAIL: Vec3 = [0, 0.05, -0.98];
const TRUNK_RADIUS = 0.16;

const smooth = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Fore flippers: out at the side of the belly, from the chest backwards. */
const isForeFlipper = (point: Vec3, side: number) =>
  smooth(0.2, 0.26, point[0] * side) * smooth(0.2, 0.12, point[1]) * smooth(-0.35, -0.25, point[2]);

const createWeightBones = (): WeightBone[] => {
  const at = (name: string) => BONES.find((bone) => bone.name === name)!.at;
  const bone = (name: string) => BONES.findIndex((entry) => entry.name === name);
  const notFlipper = (point: Vec3) => 1 - Math.max(isForeFlipper(point, 1), isForeFlipper(point, -1));
  const segment = (name: string, to: Vec3, radius = 0, allow = notFlipper): WeightBone =>
    ({ allow, bone: bone(name), from: at(name), radius, to });
  return [
    segment("body", at("chest"), TRUNK_RADIUS),
    segment("chest", at("neck"), TRUNK_RADIUS * 0.7),
    segment("neck", at("head")),
    segment("head", NOSE),
    segment("hips", at("body"), TRUNK_RADIUS * 0.7),
    segment("flippers", TAIL),
    { allow: (point) => isForeFlipper(point, 1), bone: bone("foreL"), from: at("foreL"), to: [0.5, 0.03, -0.05] },
    { allow: (point) => isForeFlipper(point, -1), bone: bone("foreR"), from: at("foreR"), to: [-0.5, 0.03, -0.05] }
  ];
};

/** Harbour seal coat: the dots darken a silver-grey back, the belly paler, the eyes kept. */
const GREY = [0.5, 0.5, 0.48] as const;
const SPOT = [0.2, 0.2, 0.2] as const;
const BELLY = [0.74, 0.72, 0.66] as const;

const paintHarbourSeal = (colors: Float32Array, normals: Float32Array, eyes: (vertex: number) => boolean) => {
  const out = colors.slice();
  for (let vertex = 0; vertex < colors.length / 3; vertex += 1) {
    if (eyes(vertex)) continue;
    const [r, g, b] = colors.subarray(vertex * 3, vertex * 3 + 3);
    const spot = smooth(0.85, 0.55, (r! + g! + b!) / 3);
    const belly = smooth(-0.1, -0.6, normals[vertex * 3 + 1]!);
    for (let channel = 0; channel < 3; channel += 1) {
      const back = GREY[channel]! + (SPOT[channel]! - GREY[channel]!) * spot;
      out[vertex * 3 + channel] = back + (BELLY[channel]! - back) * belly * (1 - spot * 0.5);
    }
  }
  return out;
};

const YAW_AXIS: Vec3 = [0, 1, 0];
/**
 * A pose from lying flat (the raised front of the source lowered, the chin near the ground):
 * the front lifted (+), the rear lifted (+), the head turned (+ left).
 */
const posed = (front: number, rear: number, look = 0): BoneOffsets =>
  mergeOffsets(
    { chest: pitch(0.22 - front), neck: pitch(0.3 - front * 0.6) },
    { flippers: pitch(rear * 0.6), hips: pitch(rear) },
    look ? { neck: turn(YAW_AXIS, look) } : {}
  );

const mesh = readStaticMesh(readGlbBytes(readFileSync(resolve(SOURCE))));
placeMesh(mesh, 0);
const source = createRiggedSource(mesh, BONES, weighBySegments(mesh.positions, createWeightBones()));
const eyeMaterial = 0;
const coat = paintHarbourSeal(bakeVertexColors(mesh), mesh.normals, (vertex) => mesh.materials[vertex] === eyeMaterial);
const scale = getScaleForLength(source, { clip: 0 }, LENGTH);
const frame = (offsets: BoneOffsets): CritterFrameSpec => ({ clip: 0, ground: true, offsets, time: 0 });

const packed = await buildSkinnedCritter({
  coats: { summer: coat, winter: coat },
  copyright: "Derived from \"Dotted White Seal - Free Giveaway\" by Kugatsu Tsukai 3D Models Hub (CC BY 4.0), " +
    "see LICENSE.txt",
  highShare: 0.57,
  look: { pivot: "neck", weights: getRegionWeights(source, { head: 1, neck: 0.6 }) },
  minimalShare: 0.5,
  name: "seal",
  scale,
  source,
  specs: [
    frame(posed(0, 0)),
    frame(posed(0.5, 0)),
    frame(posed(0.5, 0, LOOK)),
    frame(posed(0.5, 0, -LOOK)),
    frame(posed(0.4, 0.45)),
    frame(posed(0.16, -0.05)),
    frame(posed(-0.03, 0.16)),
    { ...frame(posed(0.35, 0)), waterline: SWIM_DEPTH }
  ],
  standClip: 0,
  target: "assets/models/critters/seal/seal.glb"
});
writeReview(process.argv[2], packed);
