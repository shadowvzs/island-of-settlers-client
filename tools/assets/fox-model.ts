import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readGlb } from "../../src/render-common/glb-reader";
import { readSkinSource } from "./gltf-skin-sampler";
import {
  buildSkinnedCritter,
  type CritterFrameSpec,
  getRegionWeights,
  getScaleForLength,
  writeReview
} from "./skinned-critter";
import { bakeVertexColors } from "./texture-bake";

/**
 * Builds the red fox critter (assets/models/critters/fox/fox.glb) from the owner's download
 * ("Fox-rigged" by freddy1231, CC BY 4.0; resources/models/animals/critters, never shipped
 * raw): its texture baked into vertex colours, simplified to the critter budgets (High and
 * Minimal). Its one long take holds a slow walk stride (0..2.3 s), a run stride (2.7..3.7 s),
 * standing, sniffing with the head down and sitting; they fill the quadruped frames (QUAD_FRAME
 * order, sitting as the rest). Winter: the deeper, richer rust of the winter coat.
 * Usage: npx tsx tools/assets/fox-model.ts [review.json]
 */

const SOURCE = process.env.FOX_SOURCE ?? "../resources/models/animals/critters/fox-rigged.glb";
/** Nose to tail tip in island units: the earlier fox critter's length. */
const LENGTH = 0.8;
const TAKE = 1;
const STAND = 15.5;
const LOOK = 0.75;
/** Winter coat: the rust deepens, white and black parts stay. */
const WINTER_RUST = [1.04, 0.9, 0.8] as const;

const at = (...times: number[]): CritterFrameSpec[] => times.map((time) => ({ clip: TAKE, time }));

/** QUAD_FRAME order: stand, looks, walk, trot (the run stride), sniffing, sitting. */
const SPECS: CritterFrameSpec[] = [
  { clip: TAKE, time: STAND },
  { clip: TAKE, look: LOOK, time: STAND },
  { clip: TAKE, look: -LOOK, time: STAND },
  ...at(0, 0.58, 1.15, 1.73),
  ...at(2.75, 3.0, 3.25, 3.5),
  { clip: TAKE, time: 19 },
  { clip: TAKE, ground: true, time: 9 }
];

/** Winter colours: saturated (rusty) colours deepen, the neutral white and black do not. */
const toWinter = (summer: Float32Array) => {
  const winter = summer.slice();
  for (let index = 0; index < winter.length; index += 3) {
    const [r, b] = [summer[index]!, summer[index + 2]!];
    const rust = Math.min(1, Math.max(0, (r - b) / Math.max(0.05, r)) * 1.5);
    for (let channel = 0; channel < 3; channel += 1) {
      winter[index + channel] = summer[index + channel]! * (1 + (WINTER_RUST[channel]! - 1) * rust);
    }
  }
  return winter;
};

const bytes = readFileSync(resolve(SOURCE));
const source = readSkinSource(readGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const summer = bakeVertexColors(source);
const packed = await buildSkinnedCritter({
  coats: { summer, winter: toWinter(summer) },
  copyright: "Derived from \"Fox-rigged\" by freddy1231 (CC BY 4.0), see LICENSE.txt",
  forward: "x",
  highShare: 0.5,
  look: {
    pivot: "Bip01_Neck_07",
    weights: getRegionWeights(source, { BN_Ear: 1, BN_Mouth: 1, Head: 1, Neck1: 1, Neck_07: 0.5 })
  },
  minimalShare: 0.5,
  name: "fox",
  rootBone: "Bip01_Pelvis_01",
  scale: getScaleForLength(source, { clip: TAKE, time: STAND }, LENGTH, "x"),
  source,
  specs: SPECS,
  standClip: TAKE,
  standTime: STAND,
  target: "assets/models/critters/fox/fox.glb"
});
writeReview(process.argv[2], packed);
