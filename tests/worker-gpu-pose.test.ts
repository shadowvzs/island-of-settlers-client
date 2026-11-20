import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";

import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import {
  CROWD_BAKE_FPS,
  crowdBakeClips,
  crowdClipFrames,
  crowdClipSeconds,
  crowdNeedsSkinned,
  crowdPoseKey,
  crowdPoseRequest,
  crowdPoseRow,
  loadedCrowdClip
} from "../src/renderers/three/worker-gpu-pose";

const frame = (overrides: Partial<WorkerFrame> = {}): WorkerFrame => ({
  action: "walk", actorId: 7, animationTime: 0.4, gaitPhase: 0.25, heading: 0, nation: "roman", runBlend: 0.3,
  selected: false, target: null, variant: "base", x: 0, y: 0, z: 0, ...overrides
} as unknown as WorkerFrame);

/** A clip with one lower-body and one upper-body track, as the loaded-locomotion split needs. */
const clip = (name: string, duration: number, armY = 0) => new AnimationClip(name, duration, [
  new VectorKeyframeTrack("Hips.position", [0, duration], [0, 1, 0, 0, 1.1, 0]),
  new QuaternionKeyframeTrack("LeftArm.quaternion", [0, duration], [0, 0, 0, 1, 0, armY, 0, Math.sqrt(1 - armY * armY)])
]);

describe("crowdPoseRequest", () => {
  it("mixes walk and run by the gait phase and run blend", () => {
    expect(crowdPoseRequest(frame())).toEqual({
      blendClip: "run", blendTime: 0.25, clip: "walk", phase: true, time: 0.25, weight: 0.3
    });
  });

  it("reverses the walk phase for a catapult crew walking backwards", () => {
    expect(crowdPoseRequest(frame({ catapultReverseWalk: true })).time).toBeCloseTo(0.75);
  });

  it("walks with a hand-carried ware and stands with a tucked soft load", () => {
    expect(crowdPoseRequest(frame({ action: "idle_breathe", carryingWare: "water" })).clip).toBe("walk");
    const standing = crowdPoseRequest(frame({ action: "idle_breathe", carryingWare: "hides", standingCarry: true }));
    expect(standing).toEqual({ clip: "idle_breathe", time: 0.4, weight: 0 });
  });

  it("uses the baked load composites for shoulder and back carries", () => {
    expect(crowdPoseRequest(frame({ action: "carry_back" }))).toMatchObject({
      blendClip: loadedCrowdClip("carry_back", "run"), clip: loadedCrowdClip("carry_back", "walk"), phase: true
    });
    expect(crowdPoseRequest(frame({ action: "carry_shoulder", standingCarry: true }))).toEqual({
      clip: loadedCrowdClip("carry_shoulder", "stand"), time: 0, weight: 0
    });
  });

  it("plays a ware transfer as the material gesture mixed towards the carry clip", () => {
    const pickup = { direction: "pickup", progress: 0.9, ware: "flour", target: { x: 0, y: 0.2, z: 0 } };
    const request = crowdPoseRequest(frame({ action: "pickup_material", y: 0,
      wareTransfer: pickup as unknown as WorkerFrame["wareTransfer"] }));
    expect(request).toMatchObject({ blendClip: "carry_back", blendTime: 0, clip: "pickup_material", phase: true,
      time: 0.9 });
    expect(request.weight).toBeGreaterThan(0);
    expect(request.weight).toBeLessThan(1);
    // Both-hand wares keep the idle carry; a table pickup is the idle gesture too: one clip, no mix.
    const waterTransfer = { ...pickup, ware: "water" } as unknown as WorkerFrame["wareTransfer"];
    const water = crowdPoseRequest(frame({ wareTransfer: waterTransfer }));
    expect(water).toEqual({ clip: "idle_breathe", time: 0, weight: 0 });
    expect(crowdPoseKey(frame({ wareTransfer: pickup as unknown as WorkerFrame["wareTransfer"] }))).toBe("transfer");
  });

  it("plays other actions at their clip time; the spyglass holds its end; drink work idles", () => {
    expect(crowdPoseRequest(frame({ action: "chop_tree" }))).toEqual({
      clamp: false, clip: "chop_tree", time: 0.4, weight: 0
    });
    expect(crowdPoseRequest(frame({ action: "spyglass_scan" })).clamp).toBe(true);
    expect(crowdPoseRequest(frame({ action: "pick_tea" as WorkerFrame["action"] })).clip).toBe("idle_breathe");
  });

  it("keeps layered and selected frames on the skinned path", () => {
    expect(crowdNeedsSkinned(frame())).toBe(false);
    expect(crowdNeedsSkinned(frame({ selected: true }))).toBe(true);
    const guard = { faction: 1, attackProgress: null, type: "shield" } as WorkerFrame["combat"];
    expect(crowdNeedsSkinned(frame({ combat: guard }))).toBe(false);
    expect(crowdNeedsSkinned(frame({ combat: { ...guard!, attackProgress: 0.4 } }))).toBe(true);
    expect(crowdNeedsSkinned(frame({ combat: { ...guard!, defending: true } }))).toBe(true);
    expect(crowdNeedsSkinned(frame({ combat: { ...guard!, flinch: 0.2 } }))).toBe(true);
    expect(crowdNeedsSkinned(frame({ fall: 0.2 as unknown as WorkerFrame["fall"] }))).toBe(true);
    expect(crowdNeedsSkinned(frame({ handcart: {} as unknown as WorkerFrame["handcart"] }))).toBe(true);
  });

  it("groups locomotion into one pose family", () => {
    expect(crowdPoseKey(frame())).toBe("locomotion");
    expect(crowdPoseKey(frame({ action: "idle_breathe", carryingWare: "stone" }))).toBe("locomotion");
    expect(crowdPoseKey(frame({ action: "chop_tree" }))).toBe("chop_tree");
  });
});

describe("crowdPoseRow", () => {
  const range = { duration: 2, frames: crowdClipFrames(2), start: 10 };

  it("spans the clip from its first to its last row and wraps loops", () => {
    expect(range.frames).toBe(2 * CROWD_BAKE_FPS + 1);
    expect(crowdPoseRow(range, 0)).toBe(10);
    expect(crowdPoseRow(range, 1)).toBeCloseTo(10 + (range.frames - 1) / 2);
    expect(crowdPoseRow(range, 2.5)).toBeCloseTo(crowdPoseRow(range, 0.5));
    expect(crowdPoseRow(range, -0.5)).toBeCloseTo(crowdPoseRow(range, 1.5));
  });

  it("never reaches the row after the clip's last and clamps a held clip", () => {
    expect(crowdPoseRow(range, 1.99999)).toBeLessThan(10 + range.frames - 1);
    expect(crowdPoseRow(range, 5, true)).toBeLessThan(10 + range.frames - 1);
    expect(crowdPoseRow(range, 5, true)).toBeGreaterThan(10 + range.frames - 1.01);
  });

  it("turns a gait phase into clip seconds", () => {
    expect(crowdClipSeconds({ phase: true }, 0.25, 2)).toBe(0.5);
    expect(crowdClipSeconds({}, 0.25, 2)).toBe(0.25);
  });
});

describe("crowdBakeClips", () => {
  it("adds the held-load composites over each gait's legs", () => {
    const clips = [clip("walk", 1), clip("run", 0.7), clip("idle_breathe", 3), clip("carry_shoulder", 2, 0.5),
      clip("carry_back", 2, 0.3), clip("chop_tree", 1.5)];
    const baked = crowdBakeClips(clips);
    const names = baked.map(entry => entry.name);
    expect(names.slice(0, clips.length)).toEqual(clips.map(entry => entry.name));
    expect(names).toContain(loadedCrowdClip("carry_shoulder", "walk"));
    expect(names).toContain(loadedCrowdClip("carry_back", "stand"));
    const shoulderRun = baked.find(entry => entry.name === loadedCrowdClip("carry_shoulder", "run"))!;
    expect(shoulderRun.duration).toBe(0.7);
    expect(shoulderRun.tracks.map(track => track.name).sort()).toEqual(["Hips.position", "LeftArm.quaternion"]);
    // The upper body is held at the carry clip's first key: one key, its time 0 value.
    const arm = shoulderRun.tracks.find(track => track.name === "LeftArm.quaternion")!;
    expect([...arm.times]).toEqual([0]);
    expect([...arm.values]).toEqual([0, 0, 0, 1]);
    const stand = baked.find(entry => entry.name === loadedCrowdClip("carry_back", "stand"))!;
    expect(stand.duration).toBeGreaterThan(0);
    expect(crowdClipFrames(stand.duration)).toBe(2);
  });
});
