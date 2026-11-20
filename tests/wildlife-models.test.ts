import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MODEL_LOD, parseAnimalAsset } from "../src/render-common/wildlife/model/animal-asset";
import { CERVID_LEGS } from "../src/render-common/wildlife/model/animal-pose";
import {
  type AnimalModel,
  JOINT,
  PART,
  POSE_CHANNELS,
  poseAnimalMesh} from "../src/render-common/wildlife/model/animal-rig";
import { createAnimalVariants } from "../src/render-common/wildlife/model/animal-variants";
import { GRAZE_HEADS } from "../src/render-common/wildlife/model/graze-reach";
import {
  HIP_SPAN,
  HIP_WIDTH,
  LEG_SEGMENTS,
  TORSO
} from "../src/render-common/wildlife/model/leg-geometry";
import { getSpecies, SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { LIFE_STAGE } from "../src/render-common/wildlife/wildlife-stages";

const NAMES = { [SPECIES.rabbit]: "rabbit", [SPECIES.deer]: "deer", [SPECIES.elk]: "elk" };
/** Owner budgets: close <= 20k, gameplay <= 8k, far <= 2k triangles. */
const BUDGETS = [20000, 8000, 2000];

const load = (species: number) => {
  const name = NAMES[species as keyof typeof NAMES];
  const bytes = readFileSync(`assets/models/animals/${name}/${name}.glb`);
  return parseAnimalAsset(
    species,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
};
const ASSETS = Object.fromEntries([0, 1, 2].map((species) => [species, load(species)]));

const getBounds = (model: AnimalModel, skip = -1) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const { positions } = model.mesh;
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (model.parts[vertex] === skip) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, positions[vertex * 3 + axis]!);
      max[axis] = Math.max(max[axis]!, positions[vertex * 3 + axis]!);
    }
  }
  return { max, min };
};

describe.each([SPECIES.rabbit, SPECIES.deer, SPECIES.elk])("animal model %i", (species) => {
  const asset = ASSETS[species]!;
  const adult = asset.lods[MODEL_LOD.close]!;

  it("keeps every level of detail within its triangle budget, lighter with distance", () => {
    const triangles = asset.lods.map((model) => model.mesh.indices.length / 3);
    triangles.forEach((count, lod) => expect(count).toBeLessThanOrEqual(BUDGETS[lod]!));
    expect(triangles[1]).toBeLessThan(triangles[0]!);
    expect(triangles[2]).toBeLessThan(triangles[1]!);
  });

  it("stands on the ground, faces +x and has its rig left side at +z", () => {
    const { max, min } = getBounds(adult);
    expect(Math.abs(min[1]!)).toBeLessThan(0.03);
    expect(adult.joints[JOINT.head]![0]).toBeGreaterThan(adult.joints[JOINT.tail]![0]);
    expect(adult.joints[JOINT.frontLeftHip]![2]).toBeGreaterThan(0);
    expect(adult.joints[JOINT.hindRightHip]![2]).toBeLessThan(0);
    expect(max[0]! - min[0]!).toBeGreaterThan(0.2);
  });

  it("fits its collision capsule (nose, rump and top within a few centimetres)", () => {
    const { max, min } = getBounds(adult);
    const body = getSpecies(species).body;
    expect(Math.abs(max[0]! - body.front)).toBeLessThan(0.03);
    expect(Math.abs(-min[0]! - body.back)).toBeLessThan(0.03);
    expect(Math.abs(max[1]! - body.height)).toBeLessThan(0.03);
  });

  it("skins every vertex onto the rig with blend weights in 0..1", () => {
    const parts = new Set(adult.parts);
    for (const part of [PART.head, PART.neck, PART.frontLeftLower, PART.hindRightUpper]) {
      expect(parts.has(part)).toBe(true);
    }
    expect(adult.blendWeights.every((weight) => weight >= 0 && weight <= 0.5)).toBe(true);
    expect(adult.mesh.uvs.length).toBe(adult.parts.length * 2);
  });

  it("is unchanged by the zero pose", () => {
    const posed = poseAnimalMesh(adult, new Float32Array(POSE_CHANNELS), 1);
    const drift = posed.positions.reduce(
      (largest, value, index) => Math.max(largest, Math.abs(value - adult.mesh.positions[index]!)),
      0
    );
    expect(drift).toBeLessThan(1e-5);
  });

  it("builds every life stage structurally from the adult skeleton", () => {
    const variants = createAnimalVariants(species, asset, MODEL_LOD.low);
    const newborn = getBounds(variants[LIFE_STAGE.newborn]!, PART.antler);
    const grown = getBounds(variants[LIFE_STAGE.adult]!, PART.antler);
    expect(Math.abs(newborn.min[1]!)).toBeLessThan(0.05);
    expect(newborn.max[0]! - newborn.min[0]!).not.toBeCloseTo(grown.max[0]! - grown.min[0]!, 3);
  });
});

describe("model measurements used by the shared pose", () => {
  it.each([SPECIES.deer, SPECIES.elk])(
    "matches the graze reach and leg lengths of %i",
    (species) => {
      const joints = ASSETS[species]!.lods[0]!.joints;
      const head = GRAZE_HEADS[species]!;
      for (const axis of [0, 1]) {
        expect(head.neck[axis]).toBeCloseTo(joints[JOINT.neck]![axis]!, 2);
        expect(head.head[axis]).toBeCloseTo(joints[JOINT.head]![axis]!, 2);
      }
      expect(CERVID_LEGS[species]!.front).toBeCloseTo(joints[JOINT.frontLeftHip]![1], 2);
      expect(CERVID_LEGS[species]!.hind).toBeCloseTo(joints[JOINT.hindLeftHip]![1], 2);
    }
  );

  it.each([SPECIES.rabbit, SPECIES.deer, SPECIES.elk])(
    "matches the rest pose hip span and leg segments of %i",
    (species) => {
      const joints = ASSETS[species]!.lods[0]!.joints;
      const span = joints[JOINT.frontLeftHip]![0] - joints[JOINT.hindLeftHip]![0];
      expect(HIP_SPAN[species]).toBeCloseTo(span, 2);
      const legs = LEG_SEGMENTS[species]!;
      for (const [leg, hip, knee] of [
        [legs.front, JOINT.frontLeftHip, JOINT.frontLeftKnee],
        [legs.hind, JOINT.hindLeftHip, JOINT.hindLeftKnee]
      ] as const) {
        expect(leg[0][0]).toBeCloseTo(joints[knee]![0] - joints[hip]![0], 2);
        expect(leg[0][1]).toBeCloseTo(joints[knee]![1] - joints[hip]![1], 2);
        expect(leg[1][1]).toBeCloseTo(-joints[knee]![1], 2);
      }
    }
  );

  it.each([SPECIES.rabbit, SPECIES.deer, SPECIES.elk])(
    "matches the hip widths and the torso box of %i (foot placement, the fall)",
    (species) => {
      const model = ASSETS[species]!.lods[0]!;
      const { joints } = model;
      expect(HIP_WIDTH[species]!.front).toBeCloseTo(joints[JOINT.frontLeftHip]![2], 2);
      expect(HIP_WIDTH[species]!.hind).toBeCloseTo(joints[JOINT.hindLeftHip]![2], 2);
      const torso = TORSO[species]!;
      const onlyBody = model.parts.map((part) => (part === PART.body ? PART.body : -1));
      const body = getBounds({ ...model, parts: onlyBody }, -1);
      expect(torso.bottom).toBeCloseTo(body.min[1]!, 2);
      expect(torso.halfWidth).toBeGreaterThanOrEqual(body.max[2]! - 0.001);
    }
  );

  it("gives bucks and bulls a rack and rabbits none", () => {
    expect(ASSETS[SPECIES.deer]!.lods[0]!.parts.includes(PART.antler)).toBe(true);
    expect(ASSETS[SPECIES.elk]!.lods[0]!.parts.includes(PART.antler)).toBe(true);
    expect(ASSETS[SPECIES.rabbit]!.lods[0]!.parts.includes(PART.antler)).toBe(false);
  });
});
