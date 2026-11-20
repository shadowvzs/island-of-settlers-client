import { AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from "three";
import { expect, it } from "vitest";

import { createLoadedLocomotion, splitLoadedLocomotionClips } from "../src/renderers/three/worker-loaded-locomotion";

const clips = () => {
  const rotation = (name: string, from: number, to: number) => new QuaternionKeyframeTrack(
    name, [0, 0.5, 1], [from, to, from].flatMap((angle) => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle).toArray())
  );
  return [
    new AnimationClip("idle_breathe", 1, [
      new VectorKeyframeTrack("Hips.position", [0, 1], [0, 1, 0, 0, 1, 0]),
      rotation("LeftUpLeg.quaternion", 0, 0), rotation("Spine.quaternion", 0, 0.1)
    ]),
    new AnimationClip("walk", 1, [new VectorKeyframeTrack("Hips.position", [0, 0.5, 1], [0, 1, 0, 0, 1.1, 0, 0, 1, 0]), rotation("LeftUpLeg.quaternion", 0, 0.2), rotation("Spine.quaternion", 0, 0.8)]),
    new AnimationClip("run", 1, [new VectorKeyframeTrack("Hips.position", [0, 0.5, 1], [0, 1, 0, 0, 1.3, 0, 0, 1, 0]), rotation("LeftUpLeg.quaternion", 0, 0.6), rotation("Spine.quaternion", 0, 1.2)]),
    ...["carry_shoulder", "carry_back"].map((name) => new AnimationClip(name, 1, [
      new VectorKeyframeTrack("Hips.position", [0, 1], [0, 3, 0, 0, 4, 0]),
      rotation("LeftUpLeg.quaternion", 1, 2), rotation("Spine.quaternion", 0.3, 0.9)
    ]))
  ];
};

it("splits hips/feet from cargo-support tracks without copying or changing source keyframes", () => {
  const source = clips(), split = splitLoadedLocomotionClips(source);
  expect(split.walk.tracks.map((track) => track.name)).toEqual(["Hips.position", "LeftUpLeg.quaternion"]);
  expect(split.carry_back.tracks.map((track) => track.name)).toEqual(["Spine.quaternion"]);
  expect(split.walk.tracks[0]).toBe(source[1]!.tracks[0]);
  expect(source[1]!.tracks).toHaveLength(3);
});

it.each(["carry_shoulder", "carry_back"] as const)("%s retains upper support while lower gait follows speed and phase", (action) => {
  const root = new Group(), hips = new Bone(), leg = new Bone(), spine = new Bone();
  hips.name = "Hips"; leg.name = "LeftUpLeg"; spine.name = "Spine";
  root.add(hips); hips.add(leg, spine);
  const mixer = new AnimationMixer(root), loaded = createLoadedLocomotion({ mixer, clips: clips() });
  loaded.update({ action, gaitPhase: 0.5, runBlend: 0.25 });
  expect(hips.position.y).toBeCloseTo(1.15, 6);
  expect(spine.rotation.x).toBeCloseTo(0.3, 6);
  expect(leg.rotation.x).toBeCloseTo(0.3, 6);
  loaded.update({ action, gaitPhase: 0.5, runBlend: 0.25, standingCarry: true });
  expect(hips.position.y).toBeCloseTo(1, 6);
  expect(leg.rotation.x).toBeCloseTo(0, 6);
  expect(spine.rotation.x).toBeCloseTo(0.3, 6);
  loaded.update({ action, gaitPhase: 0, runBlend: 1 });
  expect(hips.position.y).toBeCloseTo(1, 6);
  expect(spine.rotation.x).toBeCloseTo(0.3, 6);
  expect(leg.rotation.x).toBeCloseTo(0, 6);
  mixer.stopAllAction(); mixer.uncacheRoot(root);
});
