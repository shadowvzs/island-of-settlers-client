import { lerp3 } from "../../../shared/world/noise";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import {
  add,
  CritterBuilder,
  type LoftStation,
  type Paint,
  pitchAbout,
  scale,
  sub} from "./critter-builder";
import { refreshBounds } from "./critter-pose";
import { getBodyY, paintPart } from "./quadruped-common";
import { addNeckAndHead } from "./quadruped-head";
import type { QuadPose, QuadShape } from "./quadruped-shape";

const TAU = Math.PI * 2;
/**
 * Ring and ellipsoid resolution of the parts: round enough for a smooth silhouette and shading
 * at close views (possessed eye, spyglass) within the critter budget (critters-water test).
 */
const BODY_SIDES = 18;
const LEG_SIDES = 8;
const TAIL_SIDES = 8;
const THIGH_SHARE = 0.34;

/**
 * Leg phase offsets, swing (radians) and how high a swinging foot folds up: walk one foot after
 * another (lateral sequence), trot in diagonals.
 */
const GAITS = {
  trot: {
    fold: 0.22,
    offsets: { frontLeft: 0, frontRight: 0.5, hindLeft: 0.5, hindRight: 0 },
    swing: 0.55
  },
  walk: {
    fold: 0.22,
    offsets: { frontLeft: 0.25, frontRight: 0.75, hindLeft: 0, hindRight: 0.5 },
    swing: 0.36
  }
} as const;

type LegName = keyof typeof GAITS.walk.offsets;

const addBody = (builder: CritterBuilder, shape: QuadShape, pose: QuadPose) => {
  const centreY = getBodyY(shape, pose);
  let current: Vec3 = [0, 0, 0];
  const stations: LoftStation[] = shape.body.map(([x, height, width, lift]) => ({
    at: [x * shape.bodyLength, centreY + lift * shape.bodyHeight, 0],
    height: height * shape.bodyHeight,
    width: width * shape.bodyWidth
  }));
  const paint = paintPart(shape, "body", () => current);
  builder.loft(stations, {
    endTip: shape.bodyHeight * 0.25,
    paint: (along, up, side) => {
      const index = along * (stations.length - 1);
      const station = stations[Math.round(index)]!;
      current = add(station.at, [0, up * station.height, side * station.width]);
      return paint(along, up, side);
    },
    sides: BODY_SIDES,
    startTip: shape.bodyHeight * 0.3
  });
};

/** Leg joints standing: hip, knee (the hind one is the hock, set back) and foot. */
const getStandingLeg = (shape: QuadShape, pose: QuadPose, front: boolean, sign: number) => {
  const centreY = getBodyY(shape, pose);
  const x = (front ? 0.3 : -0.3) * shape.bodyLength;
  const hip: Vec3 = [x, centreY - shape.bodyHeight * 0.3, sign * shape.bodyWidth * 0.62];
  const length = hip[1];
  const knee: Vec3 = [x + (front ? -0.02 : -0.16) * length, length * 0.4, hip[2]];
  const foot: Vec3 = [x + (front ? 0.02 : -0.02) * length, 0, hip[2]];
  return { foot, hip, knee, length };
};

/** Folded under the lying body: forelegs stretched forward, hind legs tucked beside. */
const getRestingLeg = (shape: QuadShape, hip: Vec3, front: boolean, sign: number) => {
  const reach = shape.legLength;
  if (front) {
    return {
      foot: add(hip, [reach * 0.9, -hip[1] + 0.02, 0]),
      knee: add(hip, [reach * 0.45, -hip[1] + 0.04, 0])
    };
  }
  return {
    foot: add(hip, [-reach * 0.05, -hip[1] + 0.025, sign * reach * 0.12]),
    knee: add(hip, [reach * 0.45, -hip[1] + 0.05, sign * reach * 0.2])
  };
};

/** The fallen body's limp leg: the standing leg swung forward (front) or back (hind). */
const addLeg = (builder: CritterBuilder, shape: QuadShape, pose: QuadPose, name: LegName) => {
  const front = name.startsWith("front");
  const sign = name.endsWith("Left") ? 1 : -1;
  const standing = getStandingLeg(shape, pose, front, sign);
  const { hip, length } = standing;
  const gait = GAITS[pose.footfall];
  const phase = (pose.gait + gait.offsets[name]) * TAU;
  const swing = gait.swing * pose.stride * Math.sin(phase);
  const lift = pose.stride * Math.max(0, Math.cos(phase));
  const bend = (point: Vec3, share: number): Vec3 => {
    const fold = lift * length * share;
    return add(point, [(front ? -0.1 : 0.12) * fold, gait.fold * fold, 0]);
  };
  const knee = pitchAbout(bend(standing.knee, 0.4), hip, swing);
  const foot = pitchAbout(bend(standing.foot, 1), hip, swing);
  const resting = getRestingLeg(shape, hip, front, sign);
  const joints = {
    foot: lerp3(foot, resting.foot, pose.rest),
    knee: lerp3(knee, resting.knee, pose.rest)
  };
  const thigh = shape.legRadius * (front ? 1.8 : 2.3);
  const legPaint = paintPart(shape, "leg", () => joints.foot);
  const bodyPaint = paintPart(shape, "body", () => hip);
  /** The thigh and upper arm wear the body's coat, the lower leg its stocking. */
  const paint: Paint = (along, up, side) =>
    along < THIGH_SHARE ? bodyPaint(0.5, up, side) : legPaint(along, up, side);
  builder.loft(
    [
      {
        at: add(hip, [0, shape.bodyHeight * 0.25, 0]),
        height: thigh * 1.2,
        up: [1, 0, 0],
        width: thigh
      },
      { at: lerp3(hip, joints.knee, 0.5), height: thigh * 0.85, up: [1, 0, 0], width: thigh * 0.75 },
      {
        at: joints.knee,
        height: shape.legRadius * 1.1,
        up: [1, 0, 0],
        width: shape.legRadius * 1.05
      },
      {
        at: joints.foot,
        height: shape.legRadius * 0.85,
        up: [1, 0, 0],
        width: shape.legRadius * 0.85
      }
    ],
    { paint, sides: LEG_SIDES }
  );
  const paw: Vec3 = [shape.legRadius * 1.5, shape.legRadius * 0.75, shape.legRadius * 1.05];
  const pawAt = add(joints.foot, [shape.legRadius * 0.6, shape.legRadius * 0.3, 0]);
  builder.ellipsoid(
    pawAt,
    [1, 0, 0],
    paw,
    paintPart(shape, "foot", () => pawAt),
    3,
    6
  );
};

const addTail = (builder: CritterBuilder, shape: QuadShape, pose: QuadPose) => {
  const centreY = getBodyY(shape, pose);
  const base: Vec3 = [-0.5 * shape.bodyLength, centreY + 0.3 * shape.bodyHeight, 0];
  const droop = shape.tailDroop + pose.rest * 0.3;
  const direction: Vec3 = [-Math.cos(droop), -Math.sin(droop), 0];
  const stations: LoftStation[] = [0, 0.3, 0.6, 0.85, 1].map((t) => {
    const radius = shape.tailRadius * (0.45 + Math.sin(Math.PI * Math.min(0.95, t)) * 0.75);
    const at = add(add(base, scale(direction, shape.tailLength * t)), [
      0,
      -t * t * shape.tailLength * 0.15,
      0
    ]);
    return {
      at: pose.rest > 0.5 ? restTail(at, base, t, shape) : at,
      height: radius,
      width: radius
    };
  });
  builder.loft(stations, {
    endTip: shape.tailRadius * 0.4,
    paint: paintPart(shape, "tail", () => base),
    sides: TAIL_SIDES
  });
};

/** Lying, the tail curls along the ground around the body. */
const restTail = (at: Vec3, base: Vec3, t: number, shape: QuadShape): Vec3 => {
  const swept = sub(at, base);
  return [
    base[0] + swept[0] * 0.6,
    Math.max(shape.tailRadius, at[1] * 0.4),
    base[2] + t * shape.tailLength * 0.55
  ];
};

/** One pose of a four legged critter (same vertices for every pose of a shape). */
export const createQuadrupedMesh = (shape: QuadShape, pose: QuadPose): PropMesh => {
  const builder = new CritterBuilder();
  addBody(builder, shape, pose);
  addNeckAndHead(builder, shape, pose);
  for (const name of Object.keys(GAITS.walk.offsets) as LegName[]) {
    addLeg(builder, shape, pose, name);
  }
  addTail(builder, shape, pose);
  return refreshBounds(builder.finish());
};
