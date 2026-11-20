import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  getGaitOffsets,
  LYING_LEGS,
  mergeOffsets,
  pitch,
  poseLegs,
  QUAD_GAITS,
  type QuadLandmarks,
  rigQuadruped,
  solveHeadDown
} from "./quadruped-rig";
import {
  buildSkinnedCritter,
  type CritterFrameSpec,
  getRegionWeights,
  getScaleForLength,
  writeReview
} from "./skinned-critter";
import { readGlbBytes, readStaticMesh } from "./static-rig";
import { bakeVertexColors } from "./texture-bake";

/**
 * Builds the grey wolf critter (assets/models/critters/wolf/wolf.glb) from the owner's download
 * ("Italian White Wolf" by SDPM Esare, CC BY 4.0; resources/models/animals/critters, never
 * shipped raw). The source is static: it is rigged here (quadruped-rig.ts) and posed into the
 * quadruped frames (QUAD_FRAME order): stand, looks, a lateral walk, a trot, sniffing with the
 * head down and lying on the brisket. Its texture is baked into vertex colours; the winter coat
 * is paler and thicker (a fuller ruff). Usage: npx tsx tools/assets/wolf-model.ts [review.json]
 */

const SOURCE = process.env.WOLF_SOURCE ?? "../resources/models/animals/critters/italian-white-wolf.glb";
/** Nose to tail tip in island units: the earlier wolf critter's length. */
const LENGTH = 1.03;
const LOOK = 0.75;
const STEPS = [0, 0.25, 0.5, 0.75];

/** Standing source landmarks (scene metres, facing +z, left side +x). */
const LANDMARKS: QuadLandmarks = {
  chest: [0, 1.0, 0.86],
  fore: { joints: [[0.1, 0.94, 0.88], [0.12, 0.56, 0.78], [0.13, 0.17, 0.81], [0.14, 0.06, 0.88], [0.15, 0.01, 1.02]] },
  head: [0, 1.24, 1.3],
  hind: { joints: [[0.11, 0.95, -0.04], [0.13, 0.56, 0.12], [0.13, 0.25, -0.16], [0.14, 0.05, -0.07], [0.14, 0.01, 0.03]] },
  neck: [0, 1.1, 1.04],
  nose: [0, 1.07, 1.69],
  pelvis: [0, 0.98, -0.04],
  spine: [0, 1.02, 0.4],
  tail: [[0, 1.02, -0.2], [0, 0.78, -0.42], [0, 0.48, -0.58], [0, 0.2, -0.7]],
  trunkRadius: 0.2
};

/** Winter: paler, a little greyer (the frost of the long guard hairs). */
const WINTER_FROST = [0.8, 0.79, 0.76] as const;
const WINTER_MIX = 0.3;
/** Winter coat thickness by bone (island units): the ruff on neck and chest, a fuller tail. */
const WINTER_RUFF = { chest: 0.008, head: 0.002, neck: 0.013, pelvis: 0.004, spine: 0.004, tail: 0.006 };

const toWinter = (summer: Float32Array) =>
  summer.map((value, index) => value + (WINTER_FROST[index % 3]! - value) * WINTER_MIX);

/** Lying on the brisket, the tail laid along the ground. */
const LYING = mergeOffsets(poseLegs(LYING_LEGS), { tail0: pitch(0.5), tail1: pitch(-0.3) });

const mesh = readStaticMesh(readGlbBytes(readFileSync(resolve(SOURCE))));
const source = rigQuadruped(mesh, LANDMARKS);
const summer = bakeVertexColors(mesh);
const head = getRegionWeights(source, { head: 1 });
const scale = getScaleForLength(source, { clip: 0 }, LENGTH);
const gait = (name: keyof typeof QUAD_GAITS): CritterFrameSpec[] =>
  STEPS.map((phase) => ({ clip: 0, offsets: getGaitOffsets(QUAD_GAITS[name], phase), time: 0 }));

const packed = await buildSkinnedCritter({
  coats: { summer, winter: toWinter(summer) },
  copyright: "Derived from \"Italian White Wolf\" by SDPM Esare (CC BY 4.0), see LICENSE.txt",
  highShare: 0.1,
  look: { pivot: "neck", weights: getRegionWeights(source, { head: 1, neck: 0.6 }) },
  minimalShare: 0.5,
  name: "wolf",
  scale,
  source,
  specs: [
    { clip: 0, time: 0 },
    { clip: 0, look: LOOK, time: 0 },
    { clip: 0, look: -LOOK, time: 0 },
    ...gait("walk"),
    ...gait("trot"),
    { clip: 0, offsets: solveHeadDown(source, head, 0.03 / scale), time: 0 },
    { clip: 0, ground: true, offsets: LYING, time: 0 }
  ],
  standClip: 0,
  target: "assets/models/critters/wolf/wolf.glb",
  winterThickness: getRegionWeights(source, WINTER_RUFF)
});
writeReview(process.argv[2], packed);
