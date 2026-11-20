import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MODEL_LOD, parseAnimalAsset } from "../src/render-common/wildlife/model/animal-asset";
import {
  type AnimalMotion,
  computeAnimalPose,
  createRestMotion
} from "../src/render-common/wildlife/model/animal-pose";
import {
  PART,
  POSE,
  POSE_CHANNELS,
  poseAnimalMesh
} from "../src/render-common/wildlife/model/animal-rig";
import {
  getBodySway,
  getTailFlick
} from "../src/render-common/wildlife/model/secondary-motion";
import { SPECIES } from "../src/render-common/wildlife/wildlife-species";

const motionOf = (values: Partial<AnimalMotion>) => Object.assign(createRestMotion(), values);

const pose = (species: number, values: Partial<AnimalMotion>) => {
  const out = new Float32Array(POSE_CHANNELS);
  const lift = computeAnimalPose(species, motionOf(values), out, 0);
  return { lift, out };
};

describe("cervid walk character", () => {
  it("nods the neck lowest just after each foreleg lands (twice per stride)", () => {
    const neck = (gaitPhase: number) => pose(SPECIES.deer, { gaitPhase, move: 1 }).out[POSE.neckPitch]!;
    expect(neck(0.3)).toBeLessThan(neck(0.05) - 0.1);
    expect(neck(0.8)).toBeLessThan(neck(0.55) - 0.1);
    expect(neck(0.3)).toBeCloseTo(neck(0.8), 5);
  });

  it("leaves a standing animal's neck still and keeps the gallop free of the walk nod", () => {
    const still = (gaitPhase: number) => pose(SPECIES.elk, { gaitPhase }).out[POSE.neckPitch]!;
    expect(still(0.3)).toBeCloseTo(still(0.05), 6);
  });

  it("shifts the weight over the hind leg in stance and leans into turns", () => {
    const sway = (gaitPhase: number) => getBodySway(SPECIES.deer, motionOf({ gaitPhase, move: 1 }));
    expect(sway(0.25)).toBeLessThan(0);
    expect(sway(0.75)).toBeGreaterThan(0);
    expect(Math.abs(sway(0.25))).toBeLessThan(0.05);
    expect(getBodySway(SPECIES.rabbit, motionOf({ lean: -0.1 }))).toBeCloseTo(-0.1, 6);
    expect(getBodySway(SPECIES.deer, motionOf({ death: 1, lean: -0.1 }))).toBeCloseTo(0, 6);
  });
});

describe("tail flicks", () => {
  const flicks = (values: Partial<AnimalMotion>) => {
    const samples: number[] = [];
    for (let breath = 0; breath < 700; breath += 0.05) {
      samples.push(getTailFlick(motionOf({ ...values, breath })));
    }
    return samples;
  };

  it("flicks now and then while relaxed, within the tail's range", () => {
    const samples = flicks({ seed: 0.3 });
    const active = samples.filter((value) => value > 0.01).length / samples.length;
    expect(active).toBeGreaterThan(0.01);
    expect(active).toBeLessThan(0.15);
    expect(Math.max(...samples)).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it("differs between individuals and stops when alert or fleeing", () => {
    expect(flicks({ seed: 0.3 })).not.toEqual(flicks({ seed: 0.7 }));
    expect(Math.max(...flicks({ alert: 1, seed: 0.3 }))).toBe(0);
    expect(Math.max(...flicks({ flee: 1, seed: 0.3 }))).toBe(0);
  });
});

describe("rabbit stance", () => {
  const bytes = readFileSync("assets/models/animals/rabbit/rabbit.glb");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const model = parseAnimalAsset(SPECIES.rabbit, buffer).lods[MODEL_LOD.close]!;

  /** Lowest and highest posed coordinate (height with the lift applied) of the given parts. */
  const extent = (values: Partial<AnimalMotion>, parts: number[], axis = 1) => {
    const { lift, out } = pose(SPECIES.rabbit, values);
    const { positions } = poseAnimalMesh(model, out, 0);
    let low = Infinity;
    let high = -Infinity;
    for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
      if (!parts.includes(model.parts[vertex]!)) continue;
      const value = positions[vertex * 3 + axis]! + (axis === 1 ? lift : 0);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    return { high, low };
  };
  const ALL = Object.values(PART);

  it("crouches with the long hind feet flat on the ground while standing still", () => {
    const foot = (values: Partial<AnimalMotion>) => {
      const along = extent(values, [PART.hindLeftLower], 0);
      const up = extent(values, [PART.hindLeftLower], 1);
      return { length: along.high - along.low, rise: up.high - up.low };
    };
    expect(foot({}).length).toBeGreaterThan(foot({}).rise);
    expect(foot({ gaitPhase: 0.9, move: 1 }).length).toBeLessThan(foot({}).length);
  });

  it("keeps every paw on the ground, standing, alert and grazing", () => {
    for (const values of [{}, { alert: 1 }, { graze: 1 }]) {
      const { low } = extent(values, ALL);
      expect(low).toBeGreaterThan(-0.008);
      expect(low).toBeLessThan(0.02);
    }
  });

  it("freezes alert with the head and ears up on the same crouch", () => {
    const parts = [PART.head, PART.earLeft];
    expect(extent({ alert: 1 }, parts).high).toBeGreaterThan(extent({}, parts).high + 0.01);
    expect(extent({ alert: 1 }, [PART.rear]).high).toBeCloseTo(extent({}, [PART.rear]).high, 2);
  });
});
