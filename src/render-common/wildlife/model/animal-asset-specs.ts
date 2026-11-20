import { SPECIES } from "../wildlife-species";
import { JOINT, PART, type Part } from "./animal-rig";

/** Joints read from bone heads (the root is the body centre between the four leg tops). */
type BoneJoint = Exclude<keyof typeof JOINT, "root">;

/**
 * How a skinned base model plugs into the shared rig: its scale to island units, which rig
 * part each bone's vertices belong to, and which bone head is each joint pivot. A new or
 * artist-made model only needs a new entry (any bone names, any units).
 * The rig's "left" is +z: the model's anatomical right (glTF faces +z, so its left is +x).
 */
export interface AnimalAssetSpec {
  joints: Record<BoneJoint, string>;
  parts: Record<string, Part>;
  /** Model units to island units (rabbit ~0.28 to the ear tips, deer 0.5, elk 0.72 withers). */
  scale: number;
}

const cervidSide = (side: "L" | "R", front: "Frontleg" | "Fronleg") => {
  const left = side === "R";
  return {
    [`Frontleg_${side}`]: left ? PART.frontLeftUpper : PART.frontRightUpper,
    [`Frontleg_${side}.001`]: left ? PART.frontLeftLower : PART.frontRightLower,
    [`Frontleg_${side}.002`]: left ? PART.frontLeftLower : PART.frontRightLower,
    [`IK-${front}_${side}`]: left ? PART.frontLeftLower : PART.frontRightLower,
    [`Backleg_${side}`]: left ? PART.hindLeftUpper : PART.hindRightUpper,
    [`Backleg_${side}.001`]: left ? PART.hindLeftLower : PART.hindRightLower,
    [`Backleg_${side}.002`]: left ? PART.hindLeftLower : PART.hindRightLower,
    [`IK-Backleg_${side}`]: left ? PART.hindLeftLower : PART.hindRightLower,
    [`Head_${side}.001`]: left ? PART.earLeft : PART.earRight
  };
};

/** The deer and elk sources share one skeleton (Kelgar deer rig). */
const createCervidSpec = (scale: number, frontIk: "Frontleg" | "Fronleg"): AnimalAssetSpec => ({
  joints: {
    earLeft: "Head_R.001",
    earRight: "Head_L.001",
    frontLeftHip: "Frontleg_R",
    frontLeftKnee: "Frontleg_R.001",
    frontRightHip: "Frontleg_L",
    frontRightKnee: "Frontleg_L.001",
    head: "Head",
    hindLeftHip: "Backleg_R",
    hindLeftKnee: "Backleg_R.001",
    hindRightHip: "Backleg_L",
    hindRightKnee: "Backleg_L.001",
    neck: "Backbone.002",
    spine: "Backbone",
    tail: "Hip"
  },
  parts: {
    Backbone: PART.body,
    "Backbone.001": PART.body,
    "Backbone.002": PART.neck,
    Head: PART.head,
    Hip: PART.rear,
    "IK-Backbone": PART.body,
    "IK-Head": PART.head,
    "IK-Hip": PART.rear,
    Main: PART.body,
    ...cervidSide("L", frontIk),
    ...cervidSide("R", "Frontleg")
  },
  scale
});

const rabbitSide = (side: "L" | "R") => {
  const left = side === "R";
  return {
    [`FrontUpLeg_${side}`]: left ? PART.frontLeftUpper : PART.frontRightUpper,
    [`FrontLeg_${side}`]: left ? PART.frontLeftLower : PART.frontRightLower,
    [`FrontPaw_${side}`]: left ? PART.frontLeftLower : PART.frontRightLower,
    [`BackUpLeg_${side}`]: left ? PART.hindLeftUpper : PART.hindRightUpper,
    [`BackLeg_${side}`]: left ? PART.hindLeftUpper : PART.hindRightUpper,
    [`BackLeg_${side}.001`]: left ? PART.hindLeftLower : PART.hindRightLower,
    [`BackPaw_${side}`]: left ? PART.hindLeftLower : PART.hindRightLower,
    [`Ear_${side}`]: left ? PART.earLeft : PART.earRight
  };
};

/** Kelgar rabbit rig: the hind "knee" is the heel, the long foot is the lower leg. */
const RABBIT_SPEC: AnimalAssetSpec = {
  joints: {
    earLeft: "Ear_R",
    earRight: "Ear_L",
    frontLeftHip: "FrontUpLeg_R",
    frontLeftKnee: "FrontLeg_R",
    frontRightHip: "FrontUpLeg_L",
    frontRightKnee: "FrontLeg_L",
    head: "Head",
    hindLeftHip: "BackUpLeg_R",
    hindLeftKnee: "BackLeg_R.001",
    hindRightHip: "BackUpLeg_L",
    hindRightKnee: "BackLeg_L.001",
    neck: "Neck",
    spine: "Spine",
    tail: "Tail"
  },
  parts: {
    Head: PART.head,
    Hips: PART.rear,
    IK_Head: PART.head,
    Neck: PART.neck,
    Spine: PART.body,
    "Spine.001": PART.body,
    Tail: PART.tail,
    ...rabbitSide("L"),
    ...rabbitSide("R")
  },
  scale: 0.019
};

export const ANIMAL_ASSET_SPECS: Record<number, AnimalAssetSpec> = {
  [SPECIES.rabbit]: RABBIT_SPEC,
  [SPECIES.deer]: createCervidSpec(0.135, "Frontleg"),
  [SPECIES.elk]: createCervidSpec(0.195, "Fronleg")
};
