import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Quaternion, Vector3 } from "three";

import type { GlbFile } from "../../src/render-common/glb-reader";
import { readSkinSource, type SkinSource } from "./gltf-skin-sampler";
import {
  buildSkinnedCritter,
  type CritterFrameSpec,
  getRegionWeights,
  getScaleForLength,
  writeReview
} from "./skinned-critter";
import { readGlbBytes } from "./static-rig";
import { bakeVertexColors } from "./texture-bake";

/**
 * Builds the golden eagle critter (assets/models/critters/eagle/eagle.glb) from the owner's
 * download ("Animated Eagle" by Clement Abai, CC BY 4.0; resources/models/animals/critters,
 * never shipped raw), recoloured from the bald eagle to a golden eagle: dark brown with the
 * golden nape and crown, a dark banded tail, a dark-tipped bill. Its flight clip gives the
 * frames (eagle.ts order): four phases of one wing beat, the glide (wings spread with a slight
 * dihedral) and the glide banked left and right. The body stays at the origin.
 * Usage: npx tsx tools/assets/eagle-model.ts [review.json]
 */

const SOURCE = process.env.EAGLE_SOURCE ?? "../resources/models/animals/critters/eagle-animated.glb";
/** Bill to tail in island units: the earlier eagle critter's length. */
const LENGTH = 0.86;
const CLIP = 0;
/** One wing beat of the clip (seconds): up, going down, down, coming up. */
const BEAT = [0.1, 0.25, 0.38, 0.55];
const GLIDE = 0.62;
/** Bank of a soaring circle (radians; the frames bank right then left, as in eagle.ts). */
const BANK = 0.42;
const PELVIS = "Bip01 Pelvis_023_10";
/** The added root that turns the source (flying along -y, back +z) to face +z with y up. */
const ORIENT = "orient";

/** Wraps the scene in a node turning it upright and facing +z; banks are offsets of it. */
const orient = (file: GlbFile) => {
  const json = file.json as any;
  const scene = json.scenes[json.scene ?? 0];
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  json.nodes.push({ children: scene.nodes, name: ORIENT, rotation: rotation.toArray() });
  scene.nodes = [json.nodes.length - 1];
  return json.nodes.length - 1;
};

const smooth = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const mix = (from: ArrayLike<number>, to: ArrayLike<number>, amount: number) =>
  [0, 1, 2].map((channel) => from[channel]! + (to[channel]! - from[channel]!) * amount);

/** Golden eagle palette (sRGB). */
const NAPE = [0.66, 0.48, 0.25] as const;
const BROWN = [0.3, 0.2, 0.12] as const;
const TAIL = [0.36, 0.31, 0.26] as const;
const BILL = [0.24, 0.23, 0.22] as const;

/**
 * The bald eagle's white head becomes the golden nape and crown, its white tail dark and grey
 * banded, its yellow bill dark (the feet stay yellow); the dark body warms to brown.
 */
const paintGoldenEagle = (source: SkinSource, colors: Float32Array) => {
  const head = getRegionWeights(source, { Head: 1, Bone01: 1, Bone02: 1, Neck: 0.6 });
  const tail = getRegionWeights(source, { Tail: 1, Bone03: 1, Bone04: 1 });
  const out = new Float32Array(colors.length);
  for (let vertex = 0; vertex < head.length; vertex += 1) {
    const color = colors.subarray(vertex * 3, vertex * 3 + 3);
    const light = (color[0]! + color[1]! + color[2]!) / 3;
    const yellow = color[0]! > color[2]! * 1.8 && color[1]! > color[2]! * 1.3;
    const white = smooth(0.45, 0.7, light) * (yellow ? 0 : 1);
    let painted = mix(color, BROWN, 0.35 * (1 - white));
    if (head[vertex]! > 0.5 && yellow) painted = BILL.slice();
    painted = mix(painted, NAPE, white * Math.min(0.9, head[vertex]! * 1.6));
    painted = mix(painted, TAIL, white * tail[vertex]! * 0.9);
    out.set(painted, vertex * 3);
  }
  return out;
};

const file = readGlbBytes(readFileSync(resolve(SOURCE)));
const root = orient(file);
const source = readSkinSource(file);
source.boneByName.set(ORIENT, root);
const coat = paintGoldenEagle(source, bakeVertexColors(source));
const bank = (angle: number): CritterFrameSpec => ({
  clip: CLIP,
  offsets: { [ORIENT]: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle) },
  time: GLIDE
});

const packed = await buildSkinnedCritter({
  coats: { summer: coat, winter: coat },
  copyright: "Derived from \"Animated Eagle\" by Clement Abai (CC BY 4.0), see LICENSE.txt",
  highShare: 0.78,
  look: { pivot: "Bip01 Neck_022_56", weights: getRegionWeights(source, { Head: 1, Bone01: 1, Bone02: 1 }) },
  minimalShare: 0.5,
  name: "eagle",
  originBone: PELVIS,
  scale: getScaleForLength(source, { clip: CLIP, time: GLIDE }, LENGTH),
  source,
  specs: [
    ...BEAT.map((time) => ({ clip: CLIP, time })),
    { clip: CLIP, time: GLIDE },
    bank(BANK),
    bank(-BANK)
  ],
  standClip: CLIP,
  standTime: GLIDE,
  target: "assets/models/critters/eagle/eagle.glb"
});
writeReview(process.argv[2], packed);
