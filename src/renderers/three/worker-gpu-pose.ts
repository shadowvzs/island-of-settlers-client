import { AnimationClip, type KeyframeTrack } from "three";

import { COIN_CARGO_VISUALS, HAND_CARRIED_INGREDIENTS } from "../../render-common/wares/ware-catalog";
import { isDrinkWorkAction } from "../../render-common/workers/drink-work-actions";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { splitLoadedLocomotionClips } from "./worker-loaded-locomotion";
import { isSoftHandLoad, SOFT_HAND_LOADS } from "./worker-soft-carry";
import { workerTransferMaterialAction } from "./worker-transfer-pose";
import { transferCarryAction, transferCarryWeight } from "./worker-ware-transfer";

/**
 * C06 GPU crowd: which frames a baked bone-matrix texture can pose and how (pure, testable). A
 * crowd pose is at most two clip rows mixed (the walk / run crossfade) plus the previous pose row
 * fading out over `CROWD_STATE_BLEND_SECONDS` (the skinned path's state blend). Frames whose
 * silhouette depends on a procedural layer (ware transfers, falls, combat, carts, cranks, contact
 * work) stay on the skinned path, so the far crowd looks the same as before (D-C4: base clip only).
 */

/** Baked frames per second of a clip; rows between frames are interpolated in the shader. */
export const CROWD_BAKE_FPS = 15;
/** The skinned path's blend between pose families (three-worker.ts POSE_BLEND_SECONDS). */
export const CROWD_STATE_BLEND_SECONDS = 0.2;

/** One baked clip: its first texture row, its row count (>= 2) and the clip's duration. */
export interface CrowdClipRange {
  duration: number;
  frames: number;
  start: number;
}

/**
 * A frame's pose as clip rows: `clip` at `time`, mixed towards `blendClip` at `blendTime` by
 * `weight`. Gait times are shares of the clip (`phase`), other times are clip seconds.
 */
export interface CrowdPoseRequest {
  blendClip?: string;
  blendTime?: number;
  /** The clip holds its last frame instead of looping (spyglass_scan). */
  clamp?: boolean;
  clip: string;
  phase?: boolean;
  time: number;
  weight: number;
}

/** Seconds into a clip of `duration` for a request time (a gait phase or seconds). */
export const crowdClipSeconds = (request: Pick<CrowdPoseRequest, "phase">, time: number, duration: number) =>
  request.phase ? time * duration : time;

const CARRIED_IN_HANDS: readonly string[] = [...SOFT_HAND_LOADS, ...COIN_CARGO_VISUALS, "water", "fish", "stone",
  "marble", "bread", "iron", ...HAND_CARRIED_INGREDIENTS];
const LOADED_ACTIONS = ["carry_shoulder", "carry_back"] as const;
const LOADED_GAITS = ["walk", "run", "stand"] as const;

/** Name of the baked composite clip: a load's upper body over the legs of one gait. */
export const loadedCrowdClip = (action: typeof LOADED_ACTIONS[number], gait: typeof LOADED_GAITS[number]) =>
  `${action}:${gait}`;

/** Rows a clip of `duration` seconds needs at `fps`: its last row is the clip's end (a loop's start again). */
export const crowdClipFrames = (duration: number, fps = CROWD_BAKE_FPS) =>
  Math.max(2, Math.ceil(duration * fps) + 1);

/** Fractional texture row of `time` within `range`; loops wrap, a clamped clip holds its last frame. */
export const crowdPoseRow = (range: CrowdClipRange, time: number, clamp = false) => {
  if (range.duration <= 0) return range.start;
  const wrapped = clamp
    ? Math.min(range.duration, Math.max(0, time))
    : ((time % range.duration) + range.duration) % range.duration;
  // Never reach the row after the clip's last: the shader also fetches the next row.
  const share = Math.min(wrapped / range.duration, 0.9999);
  return range.start + share * (range.frames - 1);
};

/** Keyframe track frozen at its first key (the load clips are held at time 0 while walking). */
const constantTrack = (track: KeyframeTrack) => {
  const frozen = track.clone();
  frozen.times = new Float32Array([0]);
  frozen.values = track.values.slice(0, track.getValueSize());
  return frozen;
};

/**
 * The clips the bake samples: the body's own clips plus the loaded-locomotion composites
 * (`worker-loaded-locomotion.ts`): the carry clip's upper body held at time 0 over the walk, run
 * or idle legs, so a shoulder/back carrier mixes rows the same way the skinned path mixes actions.
 */
export const crowdBakeClips = (clips: readonly AnimationClip[]) => {
  const split = splitLoadedLocomotionClips(clips);
  const legs = { run: split.run, stand: split.idle, walk: split.walk } as const;
  const composites = LOADED_ACTIONS.flatMap(action => LOADED_GAITS.map(gait => {
    const lower = legs[gait];
    const upper = split[action].tracks.map(constantTrack);
    // A held pose still needs a non-zero duration: the mixer's loop maths divides by it.
    const duration = gait === "stand" ? 1 / CROWD_BAKE_FPS : lower.duration;
    const lowerTracks = gait === "stand" ? lower.tracks.map(constantTrack) : lower.tracks;
    return new AnimationClip(loadedCrowdClip(action, gait), duration, [...lowerTracks, ...upper]);
  }));
  return [...clips, ...composites];
};

/**
 * A soldier swinging, blocking, flinching or under manual guard is posed by the melee layer; one
 * standing guard far away plays its base clip and keeps the weapon in its hand through the socket.
 */
const fighting = (combat: NonNullable<WorkerFrame["combat"]>) =>
  combat.attackProgress !== null || !!combat.defending || combat.flinch !== undefined || !!combat.manualGuard ||
  combat.manualBowPitch !== undefined;

/** Why a frame's pose needs the skinned path (a procedural layer or selection), or undefined. */
export const crowdSkinnedReason = (frame: WorkerFrame) => {
  if (frame.action === "carry_overhead_boat" || frame.action === "boat_lift" || frame.fisherBoatHands || frame.fisherBoatBoarding ||
    frame.wareTransfer?.ware === "boat") return "boatContact";
  if (frame.fall !== undefined || frame.fallenBandit) return "fall";
  if (frame.combat && fighting(frame.combat)) return "combat";
  if (frame.handcart) return "handcart";
  if (frame.horseLead) return "horseLead";
  if (frame.wellWork) return "wellWork";
  if (frame.foresterSeedling) return "seedling";
  if (frame.plantationSiteId !== undefined) return "plantation";
  if (frame.fieldWork !== undefined) return "fieldWork";
  if (frame.shipHullWork) return "shipHull";
  if (frame.catapultHands) return "catapult";
  if (frame.selected || frame.targeted) return "selected";
  return undefined;
};

/** Frames whose pose needs a procedural layer or a transfer: the skinned path keeps them. */
export const crowdNeedsSkinned = (frame: WorkerFrame) => crowdSkinnedReason(frame) !== undefined;

const locomotion = (frame: WorkerFrame): CrowdPoseRequest => ({
  blendClip: "run",
  blendTime: frame.gaitPhase,
  clip: "walk",
  phase: true,
  time: frame.catapultReverseWalk ? 1 - frame.gaitPhase : frame.gaitPhase,
  weight: Math.max(0, Math.min(1, frame.runBlend))
});

const loaded = (frame: WorkerFrame, action: typeof LOADED_ACTIONS[number]): CrowdPoseRequest => {
  if (frame.standingCarry) return { clip: loadedCrowdClip(action, "stand"), time: 0, weight: 0 };
  return { ...locomotion(frame), blendClip: loadedCrowdClip(action, "run"), clip: loadedCrowdClip(action, "walk"),
    time: frame.gaitPhase };
};

/** Wares whose transfer keeps the idle carry clip (both hands hold them in front of the body). */
const TRANSFER_HELD_IDLE: readonly string[] = [...SOFT_HAND_LOADS, "water", "fish", "stone", "marble", "bread",
  ...HAND_CARRIED_INGREDIENTS];

/**
 * A ware transfer as the skinned poser plays it: the material gesture at the transfer's progress,
 * mixed towards the carry clip's first frame by the carry weight (the transfer's own ease-in is
 * the member's state blend; the hand reach layers are dropped below the crowd size).
 */
const transfer = (frame: WorkerFrame, wareTransfer: NonNullable<WorkerFrame["wareTransfer"]>): CrowdPoseRequest => {
  const heldIdle = TRANSFER_HELD_IDLE.includes(wareTransfer.ware);
  const carry = heldIdle ? "idle_breathe" : transferCarryAction(frame);
  const material = workerTransferMaterialAction(frame);
  if (material === carry) return { clip: material, time: 0, weight: 0 };
  return {
    blendClip: carry,
    blendTime: 0,
    clip: material,
    phase: true,
    time: Math.min(0.999, wareTransfer.progress),
    weight: transferCarryWeight(wareTransfer)
  };
};

/**
 * The clip rows of a frame the GPU crowd may pose (`crowdNeedsSkinned` is false), mirroring the
 * skinned poser's clip choice without its procedural layers. Locomotion and transfer times are
 * shares of the clip (`phase`), other times are clip seconds.
 */
export const crowdPoseRequest = (frame: WorkerFrame): CrowdPoseRequest => {
  if (frame.wareTransfer) return transfer(frame, frame.wareTransfer);
  if (CARRIED_IN_HANDS.includes(frame.carryingWare ?? "") && frame.action !== "fish_basket_pickup") {
    if (frame.catapultTuckedCarry || (isSoftHandLoad(frame.carryingWare) && frame.standingCarry))
      return { clip: "idle_breathe", time: frame.animationTime, weight: 0 };
    return locomotion(frame);
  }
  if (frame.action === "carry_overhead_boat") return { clip: frame.action, phase: true,
    time: frame.standingCarry ? 0 : frame.gaitPhase, weight: 0 };
  if (frame.action === "carry_shoulder" || frame.action === "carry_back")
    return loaded(frame, frame.action);
  if (frame.action === "walk" || frame.action === "run") return locomotion(frame);
  const idle = isDrinkWorkAction(frame.action) || frame.wellWork?.style === "hand-rope";
  const clip = idle ? "idle_breathe" : frame.action;
  return { clamp: clip === "spyglass_scan", clip, time: frame.animationTime, weight: 0 };
};

/** Pose families, as the skinned path's `workerPoseKey`: a change between them blends. */
export const crowdPoseKey = (frame: WorkerFrame) => {
  if (frame.wareTransfer) return "transfer";
  if (frame.action === "walk" || frame.action === "run" || CARRIED_IN_HANDS.includes(frame.carryingWare ?? ""))
    return "locomotion";
  return frame.action;
};
