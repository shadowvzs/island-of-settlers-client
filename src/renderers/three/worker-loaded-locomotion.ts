import { AnimationClip, type AnimationMixer, type KeyframeTrack } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";

const isLowerBodyTrack = (track: KeyframeTrack) =>
  /^(?:Hips|(?:Left|Right)(?:UpLeg|Leg|Foot|ToeBase))\./.test(track.name);

/** Split actions share immutable key buffers; no clip/track allocations occur while walking. */
export const splitLoadedLocomotionClips = (clips: readonly AnimationClip[]) => {
  const split = (name: string, lower: boolean) => {
    const source = clips.find((clip) => clip.name === name);
    if (!source) throw new Error(`Missing worker locomotion clip: ${name}`);
    const tracks = source.tracks.filter((track) => isLowerBodyTrack(track) === lower);
    if (!tracks.length) throw new Error(`Worker clip has no ${lower ? "lower" : "upper"} body tracks: ${name}`);
    return new AnimationClip(`${name}_${lower ? "legs" : "load"}`, source.duration, tracks);
  };
  return {
    idle: split("idle_breathe", true),
    walk: split("walk", true),
    run: split("run", true),
    carry_shoulder: split("carry_shoulder", false),
    carry_back: split("carry_back", false)
  };
};

/** Caller stops previous actions when entering/changing carry; transfers use their own full pose. */
export const createLoadedLocomotion = (worker: {
  mixer: AnimationMixer;
  clips: readonly AnimationClip[];
}) => {
  const clips = splitLoadedLocomotionClips(worker.clips);
  const walk = worker.mixer.clipAction(clips.walk), run = worker.mixer.clipAction(clips.run);
  const idle = worker.mixer.clipAction(clips.idle);
  const shoulder = worker.mixer.clipAction(clips.carry_shoulder);
  const back = worker.mixer.clipAction(clips.carry_back);
  const update = (frame: Pick<WorkerFrame, "action" | "gaitPhase" | "runBlend" | "standingCarry">) => {
    if (frame.action !== "carry_shoulder" && frame.action !== "carry_back") return;
    const upper = frame.action === "carry_shoulder" ? shoulder : back;
    const blend = Math.max(0, Math.min(1, frame.runBlend));
    walk.setEffectiveWeight(frame.standingCarry ? 0 : 1 - blend).play();
    run.setEffectiveWeight(frame.standingCarry ? 0 : blend).play();
    idle.setEffectiveWeight(frame.standingCarry ? 1 : 0).play();
    idle.time = 0;
    upper.setEffectiveWeight(1).play();
    walk.time = frame.gaitPhase * clips.walk.duration;
    run.time = frame.gaitPhase * clips.run.duration;
    // Chest/arms keep their load support pose. The pelvis and feet use the ground-matched gait.
    upper.time = 0;
    worker.mixer.update(0);
  };
  return { update };
};
