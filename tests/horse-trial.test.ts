import { MOUNT_CLIPS, MOUNT_RIDERS } from "@workers/mount-clips";
import { HORSE_COATS } from "@workers/mount-coats";
import { describe, expect, it } from "vitest";

import { readAppParams } from "../src/app/app-params";
import { readDevParams } from "../src/app/dev-params";
import {
  createHorseTrial,
  groundSpeed,
  TRIAL_PLAN,
  type TrialWorld
} from "../src/render-common/mounts/horse-trial";
import { WORKER_SCALE } from "../src/render-common/workers/worker-dimensions";

/** The `?horse=1` dev trial: off by default, riders at their clips' ground speed on the ground. */

const SIZE = 32;
const GROUND = 2.5;
const createFlatWorld = (seed = 7): TrialWorld => ({
  cellsX: SIZE,
  cellsZ: SIZE,
  heights: new Float32Array((SIZE + 1) * (SIZE + 1)).fill(GROUND),
  seed,
  start: { x: 16, z: 16 }
});

describe("horse trial", () => {
  it("is off unless ?horse=1 (a player launch never reads the dev switch)", () => {
    expect(readAppParams("").horse).toBe(false);
    expect(readAppParams("?horse=1").horse).toBe(false);
    expect(readDevParams("?horse=0").horse).toBe(false);
    expect(readDevParams("?horse=1").horse).toBe(true);
  });

  it("seats every rider body on its own horse with a known coat", () => {
    const trial = createHorseTrial(createFlatWorld());
    expect(trial.appearances.map((appearance) => appearance.rider)).toEqual([...MOUNT_RIDERS]);
    for (const { coat } of trial.appearances) {
      expect(HORSE_COATS.some((candidate) => candidate.id === coat)).toBe(true);
    }
    expect(createHorseTrial(createFlatWorld()).appearances).toEqual(trial.appearances);
  });

  it("moves each horse at its clip's ground speed and heading, on the ground, through the plan", () => {
    const trial = createHorseTrial(createFlatWorld());
    const step = 1 / 60;
    let previous = trial.update(0).map((frame) => ({ ...frame }));
    const seen = new Set<string>();
    const lap = TRIAL_PLAN.reduce((sum, entry) => sum + entry.seconds, 0);
    for (let time = step; time < lap; time += step) {
      const frames = trial.update(step);
      frames.forEach((frame, index) => {
        const moved = Math.hypot(frame.x - previous[index]!.x, frame.z - previous[index]!.z);
        expect(moved / step).toBeCloseTo(groundSpeed(frame.clip), 1);
        if (moved > 0) {
          const direction = Math.atan2(frame.x - previous[index]!.x, frame.z - previous[index]!.z);
          expect(Math.cos(direction - frame.heading)).toBeGreaterThan(0.99);
        }
        expect(frame.y).toBeCloseTo(GROUND, 5);
        expect(frame.clipTime).toBeLessThan(MOUNT_CLIPS[frame.clip].duration);
        seen.add(frame.clip);
      });
      previous = frames.map((frame) => ({ ...frame }));
    }
    expect([...seen].sort()).toEqual(["gallop", "idle", "trot", "walk"]);
    expect(groundSpeed("walk")).toBeCloseTo(MOUNT_CLIPS.walk.speed * WORKER_SCALE);
  });
});
