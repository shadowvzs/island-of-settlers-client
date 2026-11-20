import { lerp3 } from "../../../shared/world/noise";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import { countershade, CritterBuilder, flat, type Paint } from "./critter-builder";
import { CLIP, createClips, type CritterModel,cycle, pose } from "./critter-model";

/**
 * Shore crab: an original procedural model in world units, wider than long (it walks sideways
 * along z): a flat carapace, four walking legs a side, two claws and stalked eyes.
 */
const CRAB = {
  belly: [0.86, 0.7, 0.5] as Vec3,
  claw: [0.6, 0.2, 0.1] as Vec3,
  dark: [0.36, 0.12, 0.07] as Vec3,
  leg: [0.7, 0.33, 0.17] as Vec3,
  shell: [0.62, 0.25, 0.12] as Vec3
};

const shell: Paint = countershade(CRAB.shell, CRAB.belly, -0.3);
const LEG_X = [0.009, 0.002, -0.005, -0.012];

interface CrabPose {
  /** Which legs lift: 0 none, 1 the first set, -1 the second (alternating gait). */
  step: number;
  /** 0 claws down .. 1 raised (a threat display). */
  claws: number;
}

const addLeg = (builder: CritterBuilder, from: Vec3, knee: Vec3, tip: Vec3) => {
  builder.loft(
    [
      { at: from, height: 0.0022, width: 0.0022 },
      { at: knee, height: 0.0018, width: 0.0018 },
      { at: tip, height: 0.0008, width: 0.0008 }
    ],
    { paint: (along) => lerp3(CRAB.leg, CRAB.dark, along * 0.6), sides: 4 }
  );
};

const addLegs = (builder: CritterBuilder, { step }: CrabPose) => {
  LEG_X.forEach((x, index) => {
    for (const sign of [1, -1]) {
      const set = (index + (sign > 0 ? 0 : 1)) % 2 === 0 ? 1 : -1;
      const lift = set === step ? 0.006 : 0;
      const swing = set === step ? sign * 0.004 : 0;
      const from: Vec3 = [x, 0.009, sign * 0.019];
      const knee: Vec3 = [x * 1.4, 0.016 + lift, sign * (0.033 + swing)];
      const tip: Vec3 = [x * 1.7, lift * 0.6, sign * (0.043 + swing)];
      addLeg(builder, from, knee, tip);
    }
  });
};

const addClaws = (builder: CritterBuilder, { claws }: CrabPose) => {
  for (const sign of [1, -1]) {
    const shoulder: Vec3 = [0.013, 0.009, sign * 0.012];
    const elbow: Vec3 = [0.024, 0.011 + claws * 0.012, sign * 0.019];
    const hand: Vec3 = [0.031, 0.012 + claws * 0.02, sign * 0.016];
    builder.loft(
      [
        { at: shoulder, height: 0.0025, width: 0.0025 },
        { at: elbow, height: 0.003, width: 0.003 }
      ],
      { paint: flat(CRAB.claw), sides: 5 }
    );
    builder.ellipsoid(hand, [1, claws * 0.8, 0], [0.008, 0.0045, 0.005], flat(CRAB.claw), 3, 6);
  }
};

const createCrabMesh = (values: CrabPose): PropMesh => {
  const builder = new CritterBuilder();
  builder.ellipsoid([0, 0.011, 0], [1, 0, 0], [0.016, 0.0065, 0.022], shell, 5, 10);
  for (const sign of [1, -1]) {
    const eye: Vec3 = [0.015, 0.018, sign * 0.005];
    builder.ellipsoid(eye, [0, 1, 0], [0.003, 0.0018, 0.0018], flat(CRAB.dark), 3, 5);
  }
  addLegs(builder, values);
  addClaws(builder, values);
  return builder.finish();
};

/** Frames: standing, the two steps of the sideways gait, claws raised. */
const FRAME = { stand: 0, stepA: 1, stepB: 2, claws: 3 } as const;

const CLIPS = createClips({
  [CLIP.idle]: pose(FRAME.stand),
  [CLIP.move]: cycle(FRAME.stepA, FRAME.stand, FRAME.stepB, FRAME.stand),
  [CLIP.fast]: cycle(FRAME.stepA, FRAME.stepB),
  [CLIP.look]: pose(FRAME.stand, FRAME.claws)
});

export const createCrabModel = (): CritterModel => ({
  clips: CLIPS,
  frames: [
    createCrabMesh({ claws: 0, step: 0 }),
    createCrabMesh({ claws: 0, step: 1 }),
    createCrabMesh({ claws: 0, step: -1 }),
    createCrabMesh({ claws: 1, step: 0 })
  ]
});
