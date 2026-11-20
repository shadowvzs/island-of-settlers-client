import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MODEL_LOD, parseAnimalAsset } from "../src/render-common/wildlife/model/animal-asset";
import {
  computeAnimalPose,
  createRestMotion
} from "../src/render-common/wildlife/model/animal-pose";
import {
  type AnimalModel,
  PART,
  POSE,
  POSE_CHANNELS,
  poseAnimalMesh} from "../src/render-common/wildlife/model/animal-rig";
import { MAX_REST_NOSE_DOWN, REST_KIND } from "../src/render-common/wildlife/model/rest-pose";
import { SPECIES } from "../src/render-common/wildlife/wildlife-species";

const NAMES = { [SPECIES.rabbit]: "rabbit", [SPECIES.deer]: "deer", [SPECIES.elk]: "elk" };
/** Allowed sink into the ground (model units): fur tips, not limbs. */
const GROUND_TOLERANCE = 0.008;

const loadModel = (species: number) => {
  const name = NAMES[species as keyof typeof NAMES];
  const bytes = readFileSync(`assets/models/animals/${name}/${name}.glb`);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return parseAnimalAsset(species, buffer).lods[MODEL_LOD.close]!;
};
const MODELS = Object.fromEntries([0, 1, 2].map((species) => [species, loadModel(species)]));

const poseRest = (species: number, rest: number, restKind = 0, restHead = 0) => {
  const motion = createRestMotion();
  motion.rest = rest;
  motion.restKind = restKind;
  motion.restHead = restHead;
  motion.chew = 1.2;
  const pose = new Float32Array(POSE_CHANNELS);
  const lift = computeAnimalPose(species, motion, pose, 0);
  return { lift, pose, posed: poseAnimalMesh(MODELS[species]!, pose, 1) };
};

/** Lowest height (lift applied) of the vertices of the given parts (all when empty). */
const getLowest = (model: AnimalModel, positions: Float32Array, lift: number, parts: number[]) => {
  let lowest = Infinity;
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (parts.length > 0 && !parts.includes(model.parts[vertex]!)) continue;
    lowest = Math.min(lowest, positions[vertex * 3 + 1]! + lift);
  }
  return lowest;
};

/** Extent (min, max) of a part's vertices along one axis (0 x, 1 y, 2 z). */
const getExtent = (model: AnimalModel, positions: Float32Array, part: number, axis: number) => {
  let min = Infinity;
  let max = -Infinity;
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (model.parts[vertex] !== part) continue;
    min = Math.min(min, positions[vertex * 3 + axis]!);
    max = Math.max(max, positions[vertex * 3 + axis]!);
  }
  return { max, min };
};

/** Mean z (+ left) of a part's vertices. */
const getMeanSide = (model: AnimalModel, positions: Float32Array, part: number) => {
  let sum = 0;
  let count = 0;
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (model.parts[vertex] !== part) continue;
    sum += positions[vertex * 3 + 2]!;
    count += 1;
  }
  return sum / count;
};

const REST_STEPS = Array.from({ length: 11 }, (_, step) => step / 10);
const CASES = [
  ...[SPECIES.deer, SPECIES.elk].flatMap((species) =>
    [0, 1].map((restHead) => ({ restHead, restKind: 0, species }))
  ),
  ...Object.values(REST_KIND).map((restKind) => ({
    restHead: 0,
    restKind,
    species: SPECIES.rabbit
  }))
];

describe("resting poses", () => {
  it.each(CASES)("keeps every limb above the ground lying down and rising (%o)", (shape) => {
    const model = MODELS[shape.species]!;
    for (const rest of REST_STEPS) {
      const { lift, posed } = poseRest(shape.species, rest, shape.restKind, shape.restHead);
      const lowest = getLowest(model, posed.positions as Float32Array, lift, []);
      expect(lowest, `rest ${rest}`).toBeGreaterThan(-GROUND_TOLERANCE);
    }
  });

  it.each([SPECIES.deer, SPECIES.elk])("beds %i with the chest and belly on the ground", (species) => {
    const model = MODELS[species]!;
    const { lift, posed } = poseRest(species, 1);
    const positions = posed.positions as Float32Array;
    expect(getLowest(model, positions, lift, [PART.body])).toBeLessThan(0.05);
    const standing = getLowest(model, model.mesh.positions, 0, [PART.body]);
    expect(standing).toBeGreaterThan(0.25);
  });

  it("folds the deer hind legs to one side (the right cannon out, the left one under)", () => {
    const model = MODELS[SPECIES.deer]!;
    const { posed } = poseRest(SPECIES.deer, 1);
    const bedded = posed.positions as Float32Array;
    const standing = model.mesh.positions;
    const right = PART.hindRightLower;
    const left = PART.hindLeftLower;
    expect(getMeanSide(model, bedded, right)).toBeLessThan(getMeanSide(model, standing, right) - 0.02);
    expect(getMeanSide(model, bedded, left)).toBeLessThan(getMeanSide(model, standing, left));
  });

  it.each([SPECIES.deer, SPECIES.elk])(
    "keeps %i's body pitch moderate while lying down and rising (no headstand)",
    (species) => {
      for (let step = 0; step <= 40; step += 1) {
        const pitch = poseRest(species, step / 40).pose[POSE.bodyPitch]!;
        expect(pitch).toBeGreaterThanOrEqual(-MAX_REST_NOSE_DOWN - 1e-3);
        expect(pitch).toBeLessThan(0.2);
      }
    }
  );

  it.each([SPECIES.deer, SPECIES.elk])("keeps %i's leg paths apart (no crossing)", (species) => {
    const model = MODELS[species]!;
    for (let step = 0; step <= 40; step += 1) {
      const positions = poseRest(species, step / 40).posed.positions as Float32Array;
      const hindLeft = getExtent(model, positions, PART.hindLeftLower, 2);
      const hindRight = getExtent(model, positions, PART.hindRightLower, 2);
      expect(hindLeft.min).toBeGreaterThan(hindRight.max);
      const front = getExtent(model, positions, PART.frontLeftLower, 0);
      const hind = getExtent(model, positions, PART.hindLeftLower, 0);
      expect(front.min).toBeGreaterThan(hind.max);
    }
  });

  it("raises the head in REST_01 and lowers it in REST_02", () => {
    const model = MODELS[SPECIES.deer]!;
    const upright = poseRest(SPECIES.deer, 1, 0, 0);
    const lowered = poseRest(SPECIES.deer, 1, 0, 1);
    const head = (result: ReturnType<typeof poseRest>) =>
      getLowest(model, result.posed.positions as Float32Array, result.lift, [PART.head]);
    expect(head(upright)).toBeGreaterThan(head(lowered) + 0.15);
  });

  it("makes the rabbit rests distinct: sit upright, loaf and crouch low, groom paws up", () => {
    const rabbit = MODELS[SPECIES.rabbit]!;
    const bodyLowest = (kind: number) => {
      const { lift, posed } = poseRest(SPECIES.rabbit, 1, kind);
      return getLowest(rabbit, posed.positions as Float32Array, lift, [PART.body]);
    };
    const pitch = (kind: number) => poseRest(SPECIES.rabbit, 1, kind).pose[POSE.bodyPitch]!;
    const ears = (kind: number) => poseRest(SPECIES.rabbit, 1, kind).pose[POSE.earLeft]!;
    expect(pitch(REST_KIND.sit)).toBeGreaterThan(0.15);
    expect(bodyLowest(REST_KIND.loaf)).toBeLessThan(bodyLowest(REST_KIND.sit) - 0.025);
    expect(bodyLowest(REST_KIND.crouch)).toBeLessThan(bodyLowest(REST_KIND.sit) - 0.025);
    expect(ears(REST_KIND.crouch)).toBeGreaterThan(ears(REST_KIND.loaf) + 0.5);
    const { lift, posed } = poseRest(SPECIES.rabbit, 1, REST_KIND.groom);
    const paws = getLowest(rabbit, posed.positions as Float32Array, lift, [PART.frontLeftLower]);
    expect(paws).toBeGreaterThan(0.08);
  });
});
