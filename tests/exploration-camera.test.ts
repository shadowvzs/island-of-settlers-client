import { describe, expect, it } from "vitest";

import { createExplorationCameraBoundary } from "../src/app/exploration/contracts";
import { explorationSpyglassFieldOfView } from "../src/app/exploration/movement";
import type { CameraState } from "../src/render-common/camera-state";
import type { ExplorationPose } from "../src/render-common/exploration/exploration-frame";
import {
  clampExplorationPose,
  createExplorationCameraRig,
  explorationBlendEase,
  explorationLookDirection,
  explorationRtsCameraView,
  wrapExplorationYaw
} from "../src/renderers/three/exploration/three-camera";

const savedCamera = (): CameraState => ({
  centerX: 20,
  centerZ: 30,
  tilt: 0,
  viewportHeight: 900,
  viewportWidth: 1440,
  yaw: 0,
  zoom: 1.3
});

const eyePose = (changes: Partial<ExplorationPose> = {}): ExplorationPose => ({
  eyeHeight: 1.7,
  fov: 1.15,
  mode: "eye",
  pitch: 0,
  x: 24,
  y: 0,
  yaw: 0,
  z: 34,
  ...changes
});

const ground = (x: number, z: number) => 2 + x * 0.01 + z * 0.02;

describe("exploration transient camera", () => {
  it("keeps the actual camera narrowing through every tenth from 2× to 8×", () => {
    const rig = createExplorationCameraRig({ groundHeight: ground });
    let previous = Infinity;
    for (let tenth = 20; tenth <= 80; tenth++) {
      const fov = explorationSpyglassFieldOfView(tenth / 10);
      rig.update(savedCamera(), { blend: 1, pose: eyePose({ fov }) });
      expect(rig.camera.fov).toBeCloseTo(fov * 180 / Math.PI);
      expect(rig.camera.fov).toBeLessThan(previous);
      previous = rig.camera.fov;
    }
  });
  it("applies the eye pose at blend 1 without mutating the saved RTS camera", () => {
    const rig = createExplorationCameraRig({ groundHeight: ground });
    const saved = savedCamera();
    const before = { ...saved };
    const sample = rig.update(saved, { blend: 1, pose: eyePose() });

    expect(sample.applied).toBe(true);
    expect(sample.blend).toBe(1);
    expect(sample.position.x).toBe(24);
    expect(sample.position.y).toBeCloseTo(ground(24, 34) + 1.7);
    expect(sample.position.z).toBe(34);
    expect(rig.camera.position.x).toBe(24);
    expect(rig.camera.position.y).toBeCloseTo(ground(24, 34) + 1.7);
    expect(rig.camera.position.z).toBe(34);
    expect(sample.yaw).toBeCloseTo(0);
    expect(sample.pitch).toBeCloseTo(0);
    expect(sample.fov).toBeCloseTo(1.15);
    expect(rig.camera.far).toBe(600);
    const nearSight = rig.update(saved, { blend: 1, pose: eyePose({ viewDistance: 260 }) });
    expect(nearSight.position).toEqual(sample.position);
    expect(rig.camera.far).toBe(260);
    rig.update(saved, { blend: 1, pose: eyePose({ viewDistance: 620 }) });
    expect(rig.camera.far).toBe(620);
    expect(saved).toEqual(before);
  });

  it("starts at the saved RTS target and interpolates towards the eye pose", () => {
    const rig = createExplorationCameraRig({ groundHeight: () => 0 });
    const saved = savedCamera();
    const eye = eyePose();
    const start = rig.update(saved, { blend: 0, pose: eye });
    const middle = rig.update(saved, { blend: 0.5, pose: eye });
    const end = rig.update(saved, { blend: 1, pose: eye });

    expect(start.position.y).toBeGreaterThan(5);
    expect(Math.hypot(start.position.x - eye.x, start.position.z - eye.z)).toBeGreaterThan(1);
    expect(explorationBlendEase(0)).toBe(0);
    expect(explorationBlendEase(0.5)).toBe(0.5);
    expect(explorationBlendEase(1)).toBe(1);
    expect(middle.position.y).toBeGreaterThan(end.position.y);
    expect(middle.position.y).toBeLessThan(start.position.y);
    expect(middle.position.x).toBeGreaterThan(end.position.x);
    expect(end.position).toEqual({ x: eye.x, y: eye.eyeHeight, z: eye.z });
  });

  it("starts at the injected RTS position and aims at the settler during approach", () => {
    const saved = savedCamera();
    const defaultView = explorationRtsCameraView(saved, { groundHeight: () => 0 });
    expect(defaultView.target).toEqual({ x: saved.centerX, y: 0, z: saved.centerZ });
    expect(defaultView.position.y).toBeGreaterThan(0);

    const rig = createExplorationCameraRig({
      groundHeight: () => 0,
      rtsView: () => ({
        fov: 0.6,
        position: { x: 0, y: 8, z: 0 },
        target: { x: 0, y: 0, z: 0 }
      })
    });
    const start = rig.update(saved, { blend: 0, pose: eyePose() });
    expect(start.position).toEqual({ x: 0, y: 8, z: 0 });
    expect(start.pitch).toBeLessThan(0);
    expect(start.pitch).toBeGreaterThan(-Math.PI / 2);
    expect(start.fov).toBeCloseTo(0.6);
    const approach = rig.update(saved, { blend: 0.5, pose: eyePose() });
    expect(approach.target.x).toBeGreaterThan(0);
    expect(approach.target.z).toBeGreaterThan(0);
    const cameraDirection = rig.camera.getWorldDirection(rig.camera.position.clone());
    expect(cameraDirection.y).toBeLessThan(0);
  });

  it("clamps pitch, FOV, eye height, yaw and ground clearance", () => {
    const rig = createExplorationCameraRig({ groundHeight: ground });
    const saved = savedCamera();

    const lookingDown = clampExplorationPose(eyePose({ pitch: -20 }), {
      groundHeight: ground
    });
    expect(lookingDown.pitch).toBeCloseTo(-82 * Math.PI / 180);
    expect(clampExplorationPose(eyePose({ pitch: 20 }), { groundHeight: ground }).pitch)
      .toBeCloseTo(82 * Math.PI / 180);

    const tinyFov = rig.update(saved, { blend: 1, pose: eyePose({ fov: 0.01 }) });
    expect(tinyFov.fov).toBeCloseTo(5 * Math.PI / 180);
    expect(rig.camera.fov).toBeCloseTo(5);
    const hugeFov = rig.update(saved, { blend: 1, pose: eyePose({ fov: 3 }) });
    expect(hugeFov.fov).toBeCloseTo(85 * Math.PI / 180);

    const tooHigh = rig.update(saved, { blend: 1, pose: eyePose({ eyeHeight: 50 }) });
    expect(tooHigh.position.y).toBeCloseTo(ground(24, 34) + 2.6);
    const tooLow = rig.update(saved, { blend: 1, pose: eyePose({ eyeHeight: -3 }) });
    expect(tooLow.position.y).toBeCloseTo(ground(24, 34) + 0.35);

    const transitionUnderground = rig.update(saved, {
      blend: 1,
      pose: eyePose({ mode: "transition", y: -100 })
    });
    expect(transitionUnderground.position.y).toBeCloseTo(ground(24, 34) + 0.4);

    const wrapped = rig.update(saved, { blend: 1, pose: eyePose({ yaw: Math.PI * 3 }) });
    expect(wrapped.yaw).toBeCloseTo(-Math.PI);
    expect(wrapExplorationYaw(Math.PI * 5)).toBeCloseTo(-Math.PI);
  });

  it("uses a yaw/pitch look direction with no roll and a finite FOV", () => {
    const rig = createExplorationCameraRig({ groundHeight: () => 0 });
    rig.update(savedCamera(), {
      blend: 1,
      pose: eyePose({ fov: Math.PI / 3, pitch: 0.4, x: 1, z: 2, yaw: Math.PI / 2 })
    });
    const direction = rig.camera.getWorldDirection(rig.camera.position.clone());
    const expected = explorationLookDirection(Math.PI / 2, 0.4);
    expect(direction.x).toBeCloseTo(expected.x);
    expect(direction.y).toBeCloseTo(expected.y);
    expect(direction.z).toBeCloseTo(expected.z);
    expect(rig.camera.fov).toBeCloseTo(60);
    expect(rig.camera.near).toBeGreaterThan(0);
    expect(rig.camera.far).toBeGreaterThan(rig.camera.near);
    expect(rig.camera.aspect).toBeCloseTo(1440 / 900);
  });

  it("uses the configured stable eye height when the pose omits a useful one", () => {
    const rig = createExplorationCameraRig({ eyeHeight: 1.55, groundHeight: () => 4 });
    const sample = rig.update(savedCamera(), {
      blend: 1,
      pose: eyePose({ eyeHeight: Number.NaN })
    });
    expect(sample.eyeHeight).toBeCloseTo(1.55);
    expect(sample.position.y).toBeCloseTo(5.55);
  });

  it("consumes the frozen camera boundary without changing saved or gameplay RTS state", () => {
    const saved = savedCamera();
    const boundary = createExplorationCameraBoundary(saved);
    boundary.setPose(eyePose(), 1);
    const rig = createExplorationCameraRig({ groundHeight: () => 0 });
    rig.update(boundary.gameplayCamera(), boundary.frame().camera);
    expect(boundary.savedRts()).toEqual(saved);
    expect(boundary.gameplayCamera()).toEqual(saved);
    expect(boundary.frame().camera?.pose).toMatchObject({ mode: "eye", x: eyePose().x });
  });

  it("returns a harmless RTS view and can be disposed repeatedly", () => {
    const rig = createExplorationCameraRig({ groundHeight: () => 0 });
    const idle = rig.update(savedCamera(), null);
    expect(idle.applied).toBe(false);
    expect(rig.camera.position.y).toBeGreaterThan(0);
    rig.dispose();
    rig.dispose();
  });
});
