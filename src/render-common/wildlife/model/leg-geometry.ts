import { SPECIES } from "../wildlife-species";
import { POSE } from "./animal-rig";

/**
 * Distance between the front and hind leg tops of the adult models (the pitch lever);
 * tests/wildlife-models.test.ts keeps it in sync with the assets.
 */
export const HIP_SPAN: Record<number, number> = {
  [SPECIES.rabbit]: 0.18,
  [SPECIES.deer]: 0.266,
  [SPECIES.elk]: 0.448
};

/** A leg segment in the side plane (x forward, y up, model units). */
export type Segment = readonly [number, number];
export type Leg = readonly [upper: Segment, lower: Segment];

/**
 * The legs of the adult models standing: hip to knee (hock, heel) and knee to the ground
 * contact, front and hind (tests/wildlife-models.test.ts keeps them in sync with the assets).
 */
export const LEG_SEGMENTS: Record<number, { front: Leg; hind: Leg }> = {
  [SPECIES.rabbit]: {
    front: [
      [-0.035, -0.04],
      [0.03, -0.067]
    ],
    hind: [
      [-0.033, -0.099],
      [0.02, -0.044]
    ]
  },
  [SPECIES.deer]: {
    front: [
      [0.005, -0.213],
      [0.019, -0.211]
    ],
    hind: [
      [-0.12, -0.217],
      [0.062, -0.213]
    ]
  },
  [SPECIES.elk]: {
    front: [
      [0.016, -0.279],
      [0.022, -0.276]
    ],
    hind: [
      [-0.194, -0.273],
      [0.065, -0.324]
    ]
  }
};

/** Half the distance between the left and right leg tops, front and hind (model units). */
export const HIP_WIDTH: Record<number, { front: number; hind: number }> = {
  [SPECIES.rabbit]: { front: 0.032, hind: 0.035 },
  [SPECIES.deer]: { front: 0.06, hind: 0.065 },
  [SPECIES.elk]: { front: 0.095, hind: 0.094 }
};

/** The torso as a box (model units: rump to chest, belly to back, half width over the haunches). */
export const TORSO: Record<
  number,
  { back: number; bottom: number; front: number; halfWidth: number; top: number }
> = {
  [SPECIES.rabbit]: { back: -0.103, bottom: 0.073, front: 0.115, halfWidth: 0.067, top: 0.202 },
  [SPECIES.deer]: { back: -0.314, bottom: 0.303, front: 0.149, halfWidth: 0.103, top: 0.564 },
  [SPECIES.elk]: { back: -0.453, bottom: 0.386, front: 0.252, halfWidth: 0.163, top: 0.797 }
};

/**
 * The sole under each foot along the lower leg: heel and toe offsets from the ground contact
 * (model units), front and hind; a tilted foot touches down with one of its ends.
 */
const SOLES: Record<number, { front: Segment; hind: Segment }> = {
  [SPECIES.rabbit]: { front: [-0.031, 0.021], hind: [-0.029, 0.019] },
  [SPECIES.deer]: { front: [-0.046, 0.025], hind: [-0.044, 0.022] },
  [SPECIES.elk]: { front: [-0.024, 0.038], hind: [-0.033, 0.037] }
};

/** The four legs: hip and knee channel, front or hind, side (+1 left, -1 right). */
export const LEGS = [
  { front: true, hip: POSE.frontLeftHip, knee: POSE.frontLeftKnee, side: 1 },
  { front: true, hip: POSE.frontRightHip, knee: POSE.frontRightKnee, side: -1 },
  { front: false, hip: POSE.hindLeftHip, knee: POSE.hindLeftKnee, side: 1 },
  { front: false, hip: POSE.hindRightHip, knee: POSE.hindRightKnee, side: -1 }
] as const;
export type LegInfo = (typeof LEGS)[number];

/** Height of the leg tops above the ground when standing (hip to ground through the leg). */
export const getHipHeight = (leg: Leg) => -(leg[0][1] + leg[1][1]);

/** Height of the body pivot (the root joint sits between the four leg tops). */
export const getRootHeight = (species: number) => {
  const legs = LEG_SEGMENTS[species]!;
  return (getHipHeight(legs.front) + getHipHeight(legs.hind)) / 2;
};

/** A point of the side plane turned about the z axis (+ swings forward / up). */
const turnSegment = ([x, y]: Segment, angle: number) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos] as const;
};

/** Model space points of one leg: top (hip), knee (hock) and foot, without the body pitch. */
export interface LegPoints {
  foot: [number, number, number];
  /** Back and front end of the sole. */
  heel: [number, number, number];
  hip: [number, number, number];
  knee: [number, number, number];
  toe: [number, number, number];
}

export const createLegPoints = (): LegPoints => ({
  foot: [0, 0, 0],
  heel: [0, 0, 0],
  hip: [0, 0, 0],
  knee: [0, 0, 0],
  toe: [0, 0, 0]
});

/** Writes a point of the sole: `along` from the foot in the lower leg's turned frame. */
const setSolePoint = (
  target: [number, number, number],
  foot: LegPoints["foot"],
  along: number,
  angle: number
) => {
  target[0] = foot[0] + along * Math.cos(angle);
  target[1] = foot[1] + along * Math.sin(angle);
  target[2] = foot[2];
};

/** Forward kinematics of a leg at its hip and knee channel angles (writes `out`). */
export const getLegPoints = (
  species: number,
  info: LegInfo,
  hip: number,
  knee: number,
  out: LegPoints
) => {
  const segments = info.front ? LEG_SEGMENTS[species]!.front : LEG_SEGMENTS[species]!.hind;
  const width = info.front ? HIP_WIDTH[species]!.front : HIP_WIDTH[species]!.hind;
  const span = HIP_SPAN[species]! / 2;
  const z = width * info.side;
  out.hip[0] = info.front ? span : -span;
  out.hip[1] = getHipHeight(segments);
  out.hip[2] = z;
  const upper = turnSegment(segments[0], hip);
  const lower = turnSegment(segments[1], hip + knee);
  out.knee[0] = out.hip[0] + upper[0];
  out.knee[1] = out.hip[1] + upper[1];
  out.knee[2] = z;
  out.foot[0] = out.knee[0] + lower[0];
  out.foot[1] = out.knee[1] + lower[1];
  out.foot[2] = z;
  const sole = info.front ? SOLES[species]!.front : SOLES[species]!.hind;
  setSolePoint(out.heel, out.foot, sole[0], hip + knee);
  setSolePoint(out.toe, out.foot, sole[1], hip + knee);
  return out;
};

/** Turns a model point about the root joint by the rig's body pitch (in place). */
export const pitchAboutRoot = (point: number[], pitch: number, rootHeight: number) => {
  const turned = turnSegment([point[0]!, point[1]! - rootHeight], pitch);
  point[0] = turned[0];
  point[1] = turned[1] + rootHeight;
};
