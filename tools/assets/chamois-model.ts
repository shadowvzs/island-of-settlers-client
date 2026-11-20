import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readGlb } from "../../src/render-common/glb-reader";
import { classifyVertices, paintCoats, reshapeToChamois } from "./chamois-source";
import { readSkinSource, type SkinSource } from "./gltf-skin-sampler";
import {
  buildSkinnedCritter,
  type CritterFrameSpec,
  getRegionWeights,
  writeReview
} from "./skinned-critter";

/**
 * Builds the chamois critter (assets/models/critters/chamois/chamois.glb) from the owner's
 * antelope download ("Antelope" by planeta-elefante, CC BY 4.0; resources/models/animals/
 * critters, never shipped raw): chamois anatomy and coats (chamois-source.ts), the source's
 * clips baked into the food critter frames (quadruped-food FOOD_FRAME order), a Minimal index
 * set and the horns last (the kid drops them), by the shared skinned-critter builder.
 * Usage: npx tsx tools/assets/chamois-model.ts [review.json]
 */

const SOURCE = process.env.CHAMOIS_SOURCE ??
  "../resources/models/animals/critters/antelope-rigged.glb";
/** Source metres to island units: withers about 0.4 (the earlier chamois critter's size). */
const SCALE = 0.4;
const CLIP = { death: 4, graze: 3, idle: 0, run: 2, walk: 1 } as const;
const LOOK = 0.75;

const phases = (clip: number, duration: number): CritterFrameSpec[] =>
  [0, 0.25, 0.5, 0.75].map((share) => ({ clip, time: duration * share }));

/** FOOD_FRAME order: stand, looks, walk, trot, graze, lying, gallop, the death fall. */
const createFrameSpecs = (source: SkinSource): CritterFrameSpec[] => {
  const duration = (clip: number) => source.clips[clip]!.duration;
  return [
    { clip: CLIP.idle, time: 0 },
    { clip: CLIP.idle, look: LOOK, time: 0 },
    { clip: CLIP.idle, look: -LOOK, time: 0 },
    ...phases(CLIP.walk, duration(CLIP.walk)),
    ...phases(CLIP.run, duration(CLIP.run)),
    { clip: CLIP.graze, time: duration(CLIP.graze) * 0.4 },
    { clip: CLIP.idle, rest: true, time: 0 },
    ...phases(CLIP.run, duration(CLIP.run)),
    ...[0.25, 0.5, 0.75, 1].map((share) => ({
      clip: CLIP.death,
      ground: true,
      time: duration(CLIP.death) * share * 0.999
    }))
  ];
};

const bytes = readFileSync(resolve(SOURCE));
const source = readSkinSource(readGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
const groups = classifyVertices(source);
const { head } = reshapeToChamois(source, groups);
const packed = await buildSkinnedCritter({
  coats: paintCoats(source, groups, head),
  copyright: "Derived from \"Antelope\" by planeta-elefante (CC BY 4.0), see LICENSE.txt",
  isTrunk: (vertex) => groups[vertex] === "body",
  look: {
    pivot: "Bip01 Neck_020",
    weights: getRegionWeights(source, { HeadNub: 1, Head_025: 1, Neck1: 1, Neck_020: 0.5, Ponytail: 1 })
  },
  minimalShare: 0.5,
  name: "chamois",
  optional: (vertex) => groups[vertex] === "horn",
  scale: SCALE,
  source,
  specs: createFrameSpecs(source),
  standClip: CLIP.idle,
  target: "assets/models/critters/chamois/chamois.glb"
});
writeReview(process.argv[2], packed);
