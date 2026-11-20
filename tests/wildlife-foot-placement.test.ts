import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MODEL_LOD, parseAnimalAsset } from "../src/render-common/wildlife/model/animal-asset";
import {
  computeAnimalPose,
  createRestMotion
} from "../src/render-common/wildlife/model/animal-pose";
import { PART, POSE_CHANNELS,poseAnimalMesh } from "../src/render-common/wildlife/model/animal-rig";
import { LEGS } from "../src/render-common/wildlife/model/leg-geometry";
import {
  type FootPlacementBody,
  getStanceWeight,
  measureFoot,
  placeFeet,
  toWorld} from "../src/render-common/wildlife/sim/animal-foot-placement";
import { getSpecies, SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { sampleSmooth } from "../src/shared/world/grid-geometry";

const NAMES = { [SPECIES.rabbit]: "rabbit", [SPECIES.deer]: "deer", [SPECIES.elk]: "elk" };
const CELLS = 32;
const LEG_PARTS = [
  PART.frontLeftLower,
  PART.frontRightLower,
  PART.hindLeftLower,
  PART.hindRightLower
];

/** A 0.3 slope along x with a 0.15 wave along z (bumps under the feet). */
const createSlope = () => {
  const heights = new Float32Array((CELLS + 1) ** 2);
  for (let z = 0; z <= CELLS; z += 1) {
    for (let x = 0; x <= CELLS; x += 1) {
      heights[z * (CELLS + 1) + x] = 0.3 * x + 0.15 * Math.sin(z * 1.3);
    }
  }
  return { cellsX: CELLS, cellsZ: CELLS, heights };
};
const GROUND = createSlope();
const groundAt = (x: number, z: number) => sampleSmooth(GROUND, GROUND.heights, x, z);

const loadModel = (species: number) => {
  const name = NAMES[species as keyof typeof NAMES];
  const bytes = readFileSync(`assets/models/animals/${name}/${name}.glb`);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return parseAnimalAsset(species, buffer).lods[MODEL_LOD.close]!;
};

/** The body as the simulation settles it: mean ground height, tilted to the slope. */
const settleBody = (heading: number, lift: number): FootPlacementBody => {
  const [x, z, half, side] = [16, 16, 0.5, 0.2];
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const front = groundAt(x + cos * half, z + sin * half);
  const back = groundAt(x - cos * half, z - sin * half);
  const left = groundAt(x - sin * side, z + cos * side);
  const right = groundAt(x + sin * side, z - cos * side);
  const pitch = Math.max(-0.35, Math.min(0.35, Math.atan2(front - back, half * 2)));
  const roll = Math.max(-0.25, Math.min(0.25, Math.atan2(left - right, side * 2)));
  return { heading, pitch, roll, scale: 1, x, y: (front + back) / 2 + lift, z };
};

const placeOnSlope = (species: number, heading: number, phase: number | null) => {
  const motion = createRestMotion();
  if (phase !== null) {
    motion.move = 1;
    motion.gaitPhase = phase;
  }
  const pose = new Float32Array(POSE_CHANNELS);
  const lift = computeAnimalPose(species, motion, pose, 0);
  const body = settleBody(heading, lift);
  const stance = LEGS.map(
    (_, index) => getStanceWeight(measureFoot(species, index, pose, 0, lift, body, GROUND).raised)
  );
  body.y += placeFeet(species, pose, 0, lift, body, GROUND, 1);
  return { body, lift, pose, stance };
};

const CASES = [SPECIES.rabbit, SPECIES.deer, SPECIES.elk].flatMap((species) =>
  [0, Math.PI / 2, 2.4].flatMap((heading) =>
    [null, 0, 0.25, 0.5, 0.75].map((phase) => ({ heading, phase, species }))
  )
);
const MODELS = Object.fromEntries([0, 1, 2].map((species) => [species, loadModel(species)]));

describe("foot placement", () => {
  it.each(CASES)("plants the standing feet on the slope (%o)", ({ heading, phase, species }) => {
    const { body, lift, pose, stance } = placeOnSlope(species, heading, phase);
    const tolerance = Math.max(0.012 * getSpecies(species).body.height, 0.007);
    for (let index = 0; index < LEGS.length; index += 1) {
      const { error } = measureFoot(species, index, pose, 0, lift, body, GROUND);
      expect(error).toBeLessThan(tolerance);
      if (stance[index]! > 0.99) expect(error).toBeGreaterThan(-tolerance);
    }
  });

  it.each(CASES)("keeps every hoof and paw above the slope (%o)", ({ heading, phase, species }) => {
    const model = MODELS[species]!;
    const { body, pose } = placeOnSlope(species, heading, phase);
    const positions = poseAnimalMesh(model, pose, 1).positions;
    const point = [0, 0, 0];
    let lowest = Infinity;
    for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
      if (!LEG_PARTS.includes(model.parts[vertex] as (typeof LEG_PARTS)[number])) continue;
      point[0] = positions[vertex * 3]!;
      point[1] = positions[vertex * 3 + 1]!;
      point[2] = positions[vertex * 3 + 2]!;
      toWorld(body, point);
      lowest = Math.min(lowest, point[1]! - groundAt(point[0]!, point[2]!));
    }
    expect(lowest).toBeGreaterThan(-0.045 * getSpecies(species).body.height);
  });

  it("leaves the pose alone with the blend at 0 (rests, the fall, far animals)", () => {
    const motion = createRestMotion();
    const pose = new Float32Array(POSE_CHANNELS);
    const lift = computeAnimalPose(SPECIES.deer, motion, pose, 0);
    const before = pose.slice();
    const drop = placeFeet(SPECIES.deer, pose, 0, lift, settleBody(1, lift), GROUND, 0);
    expect(drop).toBe(0);
    expect(Array.from(pose)).toEqual(Array.from(before));
  });
});
