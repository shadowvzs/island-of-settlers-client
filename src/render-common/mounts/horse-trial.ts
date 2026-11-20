import { MOUNT_CLIPS, MOUNT_RIDERS, type MountClipName } from "@workers/mount-clips";
import { pickHorseCoat } from "@workers/mount-coats";

import { sampleSmooth } from "../../shared/world/grid-geometry";
import { createRandom, type Random } from "../../shared/world/rng";
import type { WorldData } from "../../shared/world/world-data";
import { WORKER_SCALE } from "../workers/worker-dimensions";
import type { MountAppearance, MountFrame } from "./mount-frame";

/**
 * The horse + rider trial (`?horse=1`): one horse per rider body rides a circle around the
 * island's start, half a lap apart, through idle, walk, trot, gallop and back. Each moves at
 * its clip's ground speed (the hooves do not slide) and the coat is drawn by herd share.
 */

/** Gait plan of one lap of the trial (seconds per gait). */
export const TRIAL_PLAN: readonly { clip: MountClipName; seconds: number }[] = [
  { clip: "idle", seconds: 3 },
  { clip: "walk", seconds: 6 },
  { clip: "trot", seconds: 6 },
  { clip: "gallop", seconds: 6 },
  { clip: "trot", seconds: 4 },
  { clip: "walk", seconds: 4 }
];
const TRIAL_RADIUS = 5;
const HORSE_SEED = 0x4f7a11;

/** World units per second of a clip (model units scaled like the workers). */
export const groundSpeed = (clip: MountClipName) => MOUNT_CLIPS[clip].speed * WORKER_SCALE;

interface Rider {
  appearance: MountAppearance;
  /** Angle on the circle (radians). */
  angle: number;
  step: number;
  stepTime: number;
  clipTime: number;
}

const advance = (rider: Rider, delta: number) => {
  rider.stepTime += delta;
  const step = TRIAL_PLAN[rider.step]!;
  if (rider.stepTime >= step.seconds) {
    rider.step = (rider.step + 1) % TRIAL_PLAN.length;
    rider.stepTime = 0;
    rider.clipTime = 0;
  }
  const { clip } = TRIAL_PLAN[rider.step]!;
  rider.clipTime = (rider.clipTime + delta) % MOUNT_CLIPS[clip].duration;
  rider.angle += (groundSpeed(clip) * delta) / TRIAL_RADIUS;
};

/** Where the first horse starts on the circle: side-on to the iso camera in its first trot. */
const START_ANGLE = -1.2;

/** `random`: the coat draw (default: the island's seed, so a map always shows the same coats). */
/** The world data the trial reads: the start and the ground heights. */
export type TrialWorld = Pick<WorldData, "cellsX" | "cellsZ" | "heights" | "seed" | "start">;

export const createHorseTrial = (
  world: TrialWorld,
  random: Random = createRandom(world.seed ^ HORSE_SEED)
) => {
  const riders: Rider[] = MOUNT_RIDERS.map((rider, index) => ({
    angle: START_ANGLE + (index / MOUNT_RIDERS.length) * Math.PI * 2,
    appearance: { coat: pickHorseCoat(random()).id, rider },
    clipTime: 0,
    step: 0,
    stepTime: 0
  }));
  const frames: MountFrame[] = riders.map((rider) => ({
    ...rider.appearance,
    clip: "idle",
    clipTime: 0,
    heading: 0,
    turnRate: 0,
    x: 0,
    y: 0,
    z: 0
  }));
  const update = (delta: number): readonly MountFrame[] => {
    riders.forEach((rider, index) => {
      advance(rider, delta);
      const frame = frames[index]!;
      frame.x = world.start.x + Math.cos(rider.angle) * TRIAL_RADIUS;
      frame.z = world.start.z + Math.sin(rider.angle) * TRIAL_RADIUS;
      frame.y = sampleSmooth(world, world.heights, frame.x, frame.z);
      // Counter-clockwise on the circle: the tangent (-sin, cos) as a heading from +z.
      frame.heading = Math.atan2(-Math.sin(rider.angle), Math.cos(rider.angle));
      frame.clip = TRIAL_PLAN[rider.step]!.clip;
      frame.clipTime = rider.clipTime;
      frame.turnRate = groundSpeed(frame.clip) / TRIAL_RADIUS;
    });
    return frames;
  };
  return { appearances: riders.map((rider) => rider.appearance), update };
};
