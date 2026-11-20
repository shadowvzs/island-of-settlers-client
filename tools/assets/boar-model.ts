import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Vec3 } from "../../src/render-common/props/mesh-builder";
import type { BoneOffsets, SkinSource } from "./gltf-skin-sampler";
import {
  getGaitOffsets,
  LYING_LEGS,
  mergeOffsets,
  pitch,
  poseLegs,
  QUAD_GAITS,
  type QuadLandmarks,
  rigQuadruped,
  roll,
  scaleGait,
  solveHeadDown
} from "./quadruped-rig";
import {
  buildSkinnedCritter,
  type CritterFrameSpec,
  getRegionWeights,
  getScaleForLength,
  writeReview
} from "./skinned-critter";
import {
  filterTriangles,
  placeMesh,
  readGlbBytes,
  readStaticMesh,
  type StaticMesh,
  turnSoftly
} from "./static-rig";
import { bakeVertexColorsAndAlpha } from "./texture-bake";

/**
 * Builds the wild boar and the boar piglet critters (assets/models/critters/boar/*.glb) from
 * the owner's download ("Wild Boar Family" by Dakta.Grower.Nzl, CC BY 4.0; resources/models/
 * animals/critters, never shipped raw): the tusked boar and the piglet of the family, each stood
 * facing +z (the piglet's turned head straightened), its cut-out hair cards dropped, its
 * texture baked into vertex colours (the boar lifted to a grizzled grey-brown, the piglet given
 * the pale "humbug" stripes). The static sources are rigged (quadruped-rig.ts) and posed into
 * the food critter frames (FOOD_FRAME order): stand, looks, walk, trot, rooting, lying, gallop
 * and the death fall. Winter: the boar's coat is darker, denser and bulkier; piglets are born in
 * spring and keep theirs. Usage: npx tsx tools/assets/boar-model.ts [boar-review.json]
 */

const SOURCE = process.env.BOAR_SOURCE ?? "../resources/models/animals/critters/wild-boar-family.glb";
/** Nose to tail in island units: the earlier boar critter's length (the piglet is drawn smaller). */
const LENGTH = 0.84;
const LOOK = 0.7;
const STEPS = [0, 0.25, 0.5, 0.75];
/** Short legs: a shorter sweep and a smaller swing fold than the dog-like default. */
const GAIT_SCALE = { amplitude: 0.85, fold: 0.6 } as const;
/** Texture alpha under which a triangle is a cut-out hair card (dropped). */
const ALPHA_CUT = 0.5;

interface BoarVariant {
  /** Share of the source vertices High keeps. */
  highShare: number;
  /** Source mesh of the family file. */
  mesh: number;
  landmarks: QuadLandmarks;
  name: string;
  /** Turn of the source about y that faces it +z, and the sideways shift centring its legs. */
  yaw: number;
  shiftX?: number;
  /** A head turned in the source, straightened before rigging. */
  straighten?: { angle: number; from: number; pivot: Vec3; to: number };
  paint: (mesh: StaticMesh, source: SkinSource, colors: Float32Array) => { summer: Float32Array; winter: Float32Array };
  /** Winter coat thickness by bone (island units). */
  winterCoat?: Record<string, number>;
}

const smooth = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const mix = (from: ArrayLike<number>, to: ArrayLike<number>, amount: number) =>
  [0, 1, 2].map((channel) => from[channel]! + (to[channel]! - from[channel]!) * amount);

/** Boar: the near-black source lifted to a grizzled dark grey-brown, the snout a little paler. */
const BOAR_GRIZZLE = [0.36, 0.3, 0.25] as const;
const BOAR_LIFT = 0.6;
/** Winter: long dense bristles, darker and greyer. */
const BOAR_WINTER_TINT = [0.66, 0.64, 0.63] as const;

const paintBoar: BoarVariant["paint"] = (_mesh, _source, colors) => {
  const summer = new Float32Array(colors.length);
  const winter = new Float32Array(colors.length);
  for (let index = 0; index < colors.length; index += 3) {
    const color = colors.subarray(index, index + 3);
    const light = (color[0]! + color[1]! + color[2]!) / 3;
    const lifted = mix(color, BOAR_GRIZZLE.map((channel) => channel * (0.6 + light * 2.2)), BOAR_LIFT);
    summer.set(lifted, index);
    winter.set(lifted.map((channel, axis) => channel * BOAR_WINTER_TINT[axis]!), index);
  }
  return { summer, winter };
};

/**
 * Piglet "humbug" stripes: pale buff bands along the back and flanks, shoulder to rump, about
 * the trunk's axis (source metres): a band every 1 / STRIPES radians around it.
 */
const STRIPE_AXIS = 0.35;
const STRIPE_BUFF = [0.86, 0.72, 0.5] as const;
const STRIPE_DARK = [0.3, 0.18, 0.1] as const;
const STRIPES = 10;

const paintPiglet: BoarVariant["paint"] = (mesh, source, colors) => {
  const body = getRegionWeights(source, { chest: 0.8, pelvis: 1, spine: 1 });
  const summer = colors.slice();
  for (let vertex = 0; vertex < body.length; vertex += 1) {
    const [x, y, z] = mesh.positions.subarray(vertex * 3, vertex * 3 + 3) as unknown as Vec3;
    const angle = Math.atan2(x, y - STRIPE_AXIS);
    const along = smooth(-0.26, -0.18, z) * smooth(0.16, 0.08, z);
    const share = body[vertex]! * along * smooth(2.0, 1.5, Math.abs(angle));
    if (share <= 0) continue;
    const band = Math.cos(angle * STRIPES) > 0.3 ? STRIPE_BUFF : STRIPE_DARK;
    summer.set(mix(colors.subarray(vertex * 3, vertex * 3 + 3), band, share * 0.95), vertex * 3);
  }
  return { summer, winter: summer };
};

const VARIANTS: BoarVariant[] = [
  {
    landmarks: {
      chest: [0, 0.8, 0.27],
      fore: { joints: [[0.12, 0.78, 0.28], [0.13, 0.43, 0.2], [0.12, 0.22, 0.22], [0.12, 0.06, 0.24], [0.12, 0.01, 0.31]] },
      head: [0, 0.78, 0.6],
      hind: { joints: [[0.12, 0.75, -0.39], [0.13, 0.43, -0.43], [0.12, 0.24, -0.59], [0.12, 0.06, -0.52], [0.12, 0.01, -0.43]] },
      neck: [0, 0.8, 0.44],
      nose: [0, 0.7, 0.88],
      pelvis: [0, 0.75, -0.39],
      spine: [0, 0.85, -0.05],
      tail: [[0, 0.8, -0.68], [0, 0.66, -0.76], [0, 0.57, -0.83]],
      trunkRadius: 0.25
    },
    highShare: 0.22,
    mesh: 2,
    name: "boar",
    paint: paintBoar,
    shiftX: 0.03,
    winterCoat: { chest: 0.004, neck: 0.005, pelvis: 0.003, spine: 0.004 },
    yaw: -0.391
  },
  {
    landmarks: {
      chest: [0, 0.34, 0.12],
      fore: { joints: [[0.06, 0.31, 0.13], [0.06, 0.2, 0.105], [0.06, 0.09, 0.115], [0.06, 0.03, 0.13], [0.06, 0.005, 0.16]] },
      head: [0, 0.36, 0.28],
      hind: { joints: [[0.06, 0.32, -0.18], [0.06, 0.19, -0.19], [0.06, 0.1, -0.23], [0.06, 0.03, -0.19], [0.06, 0.005, -0.16]] },
      neck: [0, 0.35, 0.2],
      nose: [0, 0.33, 0.39],
      pelvis: [0, 0.33, -0.17],
      spine: [0, 0.36, -0.02],
      tail: [[0, 0.38, -0.27], [0, 0.37, -0.33], [0, 0.41, -0.39]],
      trunkRadius: 0.1
    },
    highShare: 0.2,
    mesh: 0,
    name: "piglet",
    paint: paintPiglet,
    straighten: { angle: 0.75, from: 0, pivot: [0, 0.35, 0.1], to: 0.18 },
    yaw: 0
  }
];

/** Simplified with the legs held apart from the trunk: reaching forward, folded and splayed. */
const SIMPLIFY_POSE = poseLegs({
  fore: { angles: [-0.5, -0.3, 1.0, 0], splay: 0.4 },
  hind: { angles: [-0.6, 0.6, -1.0, 0], splay: 0.4 }
});

/** The death fall: stumbling, down on the knees, rolling over, lying on the side. */
const createDeathOffsets = (): BoneOffsets[] => {
  const knees = { angles: [0.3, -0.6, 1.9, 0.4] as const };
  return [
    mergeOffsets(poseLegs({ fore: { angles: [0.2, -0.3, 0.9, 0.2] } }), { neck: pitch(0.25) }),
    mergeOffsets({ pelvis: pitch(0.22) }, poseLegs({ fore: knees }), { neck: pitch(0.35) }),
    mergeOffsets({ pelvis: roll(0.85) }, poseLegs({ fore: knees, hind: { angles: [-0.3, 0.5, -0.4, 0.2] } })),
    mergeOffsets({ pelvis: roll(1.45) }, poseLegs({
      fore: { angles: [-0.25, 0.1, 0.2, 0], splay: -0.2 },
      hind: { angles: [0.3, -0.1, -0.1, 0], splay: -0.2 }
    }), { neck: pitch(-0.15) })
  ];
};

const readVariantMesh = (variant: BoarVariant) => {
  const file = readGlbBytes(readFileSync(resolve(SOURCE)));
  const whole = readStaticMesh(file, (mesh) => mesh === variant.mesh);
  const { alpha, colors } = bakeVertexColorsAndAlpha(whole);
  const mesh = filterTriangles(whole, (corners) =>
    corners.reduce((sum, vertex) => sum + alpha[vertex]!, 0) / 3 >= ALPHA_CUT);
  placeMesh(mesh, variant.yaw, variant.shiftX);
  const { straighten } = variant;
  if (straighten) {
    turnSoftly(mesh, straighten.pivot, [0, 1, 0], straighten.angle, (point) =>
      smooth(straighten.from, straighten.to, point[2]));
  }
  return { colors, mesh };
};

const buildVariant = async (variant: BoarVariant) => {
  const { colors, mesh } = readVariantMesh(variant);
  const source = rigQuadruped(mesh, variant.landmarks);
  const scale = getScaleForLength(source, { clip: 0 }, LENGTH);
  const gait = (name: keyof typeof QUAD_GAITS): CritterFrameSpec[] =>
    STEPS.map((phase) => {
      const scaled = scaleGait(QUAD_GAITS[name], GAIT_SCALE.amplitude, GAIT_SCALE.fold);
      return { clip: 0, offsets: getGaitOffsets(scaled, phase), time: 0 };
    });
  const head = getRegionWeights(source, { head: 1 });
  return buildSkinnedCritter({
    coats: variant.paint(mesh, source, colors),
    copyright: "Derived from \"Wild Boar Family\" by Dakta.Grower.Nzl (CC BY 4.0), see LICENSE.txt",
    highShare: variant.highShare,
    look: { pivot: "neck", weights: getRegionWeights(source, { head: 1, neck: 0.6 }) },
    minimalShare: 0.5,
    name: variant.name,
    scale,
    source,
    specs: [
      { clip: 0, time: 0 },
      { clip: 0, look: LOOK, time: 0 },
      { clip: 0, look: -LOOK, time: 0 },
      ...gait("walk"),
      ...gait("trot"),
      { clip: 0, offsets: solveHeadDown(source, head, 0.01 / scale), time: 0 },
      { clip: 0, ground: true, offsets: poseLegs(LYING_LEGS), time: 0 },
      ...gait("gallop"),
      ...createDeathOffsets().map((offsets) => ({ clip: 0, ground: true, offsets, time: 0 }))
    ],
    simplifyPose: { clip: 0, offsets: SIMPLIFY_POSE, time: 0 },
    standClip: 0,
    target: `assets/models/critters/boar/${variant.name}.glb`,
    winterThickness: variant.winterCoat ? getRegionWeights(source, variant.winterCoat) : undefined
  });
};

for (const [index, variant] of VARIANTS.entries()) {
  const packed = await buildVariant(variant);
  writeReview(process.argv[2 + index], packed);
}
