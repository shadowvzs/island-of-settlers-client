import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MODEL_LOD, parseAnimalAsset } from "../src/render-common/wildlife/model/animal-asset";
import { computeAnimalPose, createRestMotion } from "../src/render-common/wildlife/model/animal-pose";
import {
  type AnimalModel,
  JOINT,
  PART,
  POSE_CHANNELS,
  poseAnimalMesh
} from "../src/render-common/wildlife/model/animal-rig";
import { createAnimalVariants } from "../src/render-common/wildlife/model/animal-variants";
import { SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { LIFE_STAGE } from "../src/render-common/wildlife/wildlife-stages";

const NAMES = ["rabbit", "deer", "elk"];

const load = (species: number) => {
  const bytes = readFileSync(`assets/models/animals/${NAMES[species]}/${NAMES[species]}.glb`);
  return parseAnimalAsset(species, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
const ASSETS = [0, 1, 2].map(load);

const adultOf = (species: number, lod: number = MODEL_LOD.close) =>
  createAnimalVariants(species, ASSETS[species]!, lod as 0)[LIFE_STAGE.adult]!;

const extent = (model: AnimalModel, positions: ArrayLike<number>, parts: number[], axis: number) => {
  let min = Infinity;
  let max = -Infinity;
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    if (!parts.includes(model.parts[vertex]!)) continue;
    min = Math.min(min, positions[vertex * 3 + axis]!);
    max = Math.max(max, positions[vertex * 3 + axis]!);
  }
  return { max, min };
};

const neckLength = (model: AnimalModel) => {
  const [neck, head] = [model.joints[JOINT.neck]!, model.joints[JOINT.head]!];
  return Math.hypot(head[0] - neck[0], head[1] - neck[1]);
};

describe("species anatomy over the source models", () => {
  it("gives the red deer a longer trunk and a shorter neck than the source doe", () => {
    const source = ASSETS[SPECIES.deer]!.lods[MODEL_LOD.close]!;
    const deer = adultOf(SPECIES.deer);
    const trunk = (model: AnimalModel) => {
      const { max, min } = extent(model, model.mesh.positions, [PART.body, PART.rear], 0);
      return max - min;
    };
    expect(trunk(deer)).toBeGreaterThan(trunk(source) * 1.05);
    expect(neckLength(deer)).toBeLessThan(neckLength(source) * 0.9);
  });

  it.each([SPECIES.rabbit, SPECIES.deer, SPECIES.elk])(
    "keeps species %i standing on the ground in every level of detail",
    (species) => {
      for (const lod of [MODEL_LOD.close, MODEL_LOD.high, MODEL_LOD.low]) {
        const model = adultOf(species, lod);
        const all = Object.values(PART);
        expect(extent(model, model.mesh.positions, all, 1).min).toBeCloseTo(0, 2);
      }
    }
  );

  it.each([SPECIES.deer, SPECIES.elk])("reaches the grass when grazing (%i)", (species) => {
    const motion = Object.assign(createRestMotion(), { graze: 1 });
    const pose = new Float32Array(POSE_CHANNELS);
    const lift = computeAnimalPose(species, motion, pose, 0);
    const lowestHead = (model: AnimalModel) =>
      extent(model, poseAnimalMesh(model, pose, 0).positions, [PART.head], 1).min + lift;
    const reshaped = lowestHead(adultOf(species));
    // The muzzle may dip into the grass by a few millimetres, never into the soil.
    expect(reshaped).toBeGreaterThan(-0.01);
    // The source neck reached 0.083 with the plain pose; the stance keeps within a centimetre.
    expect(reshaped).toBeLessThan(0.095);
  });

  it("gives every species a winter coat grade and the elk its rump patch", () => {
    for (const species of [SPECIES.rabbit, SPECIES.deer, SPECIES.elk]) {
      const lod = MODEL_LOD.low as 0;
      const summer = createAnimalVariants(species, ASSETS[species]!, lod)[LIFE_STAGE.adult]!;
      const winter = createAnimalVariants(species, ASSETS[species]!, lod, true)[LIFE_STAGE.adult]!;
      expect(summer.winterGrade).toBeUndefined();
      expect(winter.winterGrade![0]).toBeLessThan(1);
      expect(winter.mesh.positions).toEqual(summer.mesh.positions);
      expect(Boolean(winter.rumpPatch)).toBe(species === SPECIES.elk);
    }
  });
});
