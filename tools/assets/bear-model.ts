import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readGlb } from "../../src/render-common/glb-reader";
import { readSkinSource, type SkinSource } from "./gltf-skin-sampler";
import {
  buildSkinnedCritter,
  type CritterFrameSpec,
  getRegionWeights,
  getScaleForLength,
  writeReview
} from "./skinned-critter";
import { bakeVertexColors } from "./texture-bake";

/**
 * Builds the brown bear critter (assets/models/critters/bear/bear.glb) from the owner's
 * download ("Realistic Animated Bear 3D Model" by WildMesh 3D, CC BY 4.0; resources/models/
 * animals/critters, never shipped raw): its texture baked into vertex colours, its idle, walk,
 * trot, eating and lying clips baked into the quadruped critter frames (QUAD_FRAME order), the
 * walk's root motion removed, simplified to the critter budgets (High and Minimal). Bears keep
 * the summer coat in winter (owner). Usage: npx tsx tools/assets/bear-model.ts [review.json]
 */

const SOURCE = process.env.BEAR_SOURCE ??
  "../resources/models/animals/critters/bear-realistic-animated.glb";
/** Nose to tail in island units: the earlier bear critter's length. */
const LENGTH = 1.14;
const CLIP = { eat: 0, idle: 2, lying: 38, trot: 29, walk: 35 } as const;
const LOOK = 0.75;

const phases = (source: SkinSource, clip: number): CritterFrameSpec[] =>
  [0, 0.25, 0.5, 0.75].map((share) => ({ clip, time: source.clips[clip]!.duration * share }));

/** QUAD_FRAME order: stand, looks, walk, trot, head down (eating), lying. */
const createFrameSpecs = (source: SkinSource): CritterFrameSpec[] => [
  { clip: CLIP.idle, time: 0 },
  { clip: CLIP.idle, look: LOOK, time: 0 },
  { clip: CLIP.idle, look: -LOOK, time: 0 },
  ...phases(source, CLIP.walk),
  ...phases(source, CLIP.trot),
  { clip: CLIP.eat, time: 0.5 },
  { clip: CLIP.lying, ground: true, time: 0 }
];

const bytes = readFileSync(resolve(SOURCE));
const source = readSkinSource(readGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const coat = bakeVertexColors(source);
const packed = await buildSkinnedCritter({
  coats: { summer: coat, winter: coat },
  copyright: "Derived from \"Realistic Animated Bear 3D Model\" by WildMesh 3D (CC BY 4.0), see LICENSE.txt",
  highShare: 0.42,
  look: {
    pivot: "RigNeck1_019",
    weights: getRegionWeights(source, { Ear: 1, Eyelid: 1, Jaw: 1, Neck1: 0.5, Neck2: 1, RigHead: 1, Tongue: 1 })
  },
  minimalShare: 0.5,
  name: "bear",
  rootBone: "RigPelvis_02",
  scale: getScaleForLength(source, { clip: CLIP.idle }, LENGTH),
  source,
  specs: createFrameSpecs(source),
  standClip: CLIP.idle,
  target: "assets/models/critters/bear/bear.glb"
});
writeReview(process.argv[2], packed);
