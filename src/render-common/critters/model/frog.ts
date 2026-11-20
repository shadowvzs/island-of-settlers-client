import { lerp3 } from "../../../shared/world/noise";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import { countershade, CritterBuilder, flat, type Paint,speckle } from "./critter-builder";
import { CLIP, createClips, type CritterModel,pose } from "./critter-model";

/**
 * Common frog: an original procedural model in world units (forward +x, up +y, left +z), sitting
 * on its folded hind legs; the leap stretches the legs back and lifts the body.
 */
const FROG = {
  back: [0.36, 0.43, 0.17] as Vec3,
  belly: [0.84, 0.8, 0.6] as Vec3,
  blotch: [0.16, 0.17, 0.08] as Vec3,
  eye: [0.12, 0.1, 0.05] as Vec3,
  leg: [0.42, 0.45, 0.2] as Vec3
};

const back: Paint = (along, up, side) => {
  const base = countershade(FROG.back, FROG.belly, -0.35)(along, up, side);
  const blotch = speckle(along * 9, up * 3, side * 5) > 0.55 && up > 0 ? 0.65 : 0;
  return lerp3(base, FROG.blotch, blotch);
};

/** One leg as a thin tube through its joints (tapering to the toes). */
const addLeg = (builder: CritterBuilder, joints: readonly Vec3[], radius: number) => {
  builder.loft(
    joints.map((at, index) => {
      const size = radius * (1 - (index / joints.length) * 0.55);
      return { at, height: size, width: size };
    }),
    { endTip: radius * 0.5, paint: flat(FROG.leg), sides: 5 }
  );
};

interface FrogPose {
  /** 0 sitting .. 1 stretched in the leap. */
  leap: number;
}

const addHindLegs = (builder: CritterBuilder, { leap }: FrogPose) => {
  for (const sign of [1, -1]) {
    const hip: Vec3 = [-0.012, 0.011 + leap * 0.004, sign * 0.011];
    const knee = lerp3([0.004, 0.007, sign * 0.021], [-0.026, 0.009, sign * 0.016], leap);
    const ankle = lerp3([-0.014, 0.003, sign * 0.023], [-0.042, 0.006, sign * 0.014], leap);
    const toe = lerp3([0.004, 0.001, sign * 0.027], [-0.056, 0.004, sign * 0.016], leap);
    addLeg(builder, [hip, knee, ankle, toe], 0.0045);
  }
};

const addFrontLegs = (builder: CritterBuilder, { leap }: FrogPose) => {
  for (const sign of [1, -1]) {
    const shoulder: Vec3 = [0.012, 0.011 + leap * 0.006, sign * 0.009];
    const elbow = lerp3([0.017, 0.005, sign * 0.013], [0.026, 0.012, sign * 0.012], leap);
    const hand = lerp3([0.02, 0.001, sign * 0.012], [0.036, 0.009, sign * 0.01], leap);
    addLeg(builder, [shoulder, elbow, hand], 0.003);
  }
};

const createFrogMesh = (values: FrogPose): PropMesh => {
  const builder = new CritterBuilder();
  const lift = values.leap * 0.006;
  const pitch = 0.32 - values.leap * 0.25;
  const axis: Vec3 = [Math.cos(pitch), Math.sin(pitch), 0];
  builder.ellipsoid([0, 0.012 + lift, 0], axis, [0.021, 0.011, 0.014], back, 5, 10);
  builder.ellipsoid([0.017, 0.018 + lift, 0], [1, 0.1, 0], [0.011, 0.008, 0.012], back, 4, 9);
  for (const sign of [1, -1]) {
    const eye: Vec3 = [0.02, 0.025 + lift, sign * 0.007];
    builder.ellipsoid(eye, [1, 0, 0], [0.004, 0.004, 0.004], flat(FROG.eye), 3, 6);
  }
  addHindLegs(builder, values);
  addFrontLegs(builder, values);
  return builder.finish();
};

/** Frames: sitting, half way and stretched in a leap. */
const FROG_FRAME = { sit: 0, half: 1, leap: 2 } as const;

const CLIPS = createClips({
  [CLIP.idle]: pose(FROG_FRAME.sit),
  /** The leap: 0 crouched, 1 stretched (the hop runs 0 .. 1 .. 0 along its arc). */
  [CLIP.air]: pose(FROG_FRAME.sit, FROG_FRAME.half, FROG_FRAME.leap)
});

export const createFrogModel = (): CritterModel => ({
  clips: CLIPS,
  frames: [0, 0.5, 1].map((leap) => createFrogMesh({ leap }))
});
