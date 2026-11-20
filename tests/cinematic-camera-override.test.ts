import { OrthographicCamera, PerspectiveCamera, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { type CameraState, createCamera } from "../src/render-common/camera-state";
import {
  applyDrift,
  clampOrbitPitch,
  easeProgress,
  interpolateOrbit,
  orbitEye,
  orbitToPose,
  poseToOrbit
} from "../src/render-common/cinematic/camera-orbit";
import type { CameraOrbit, CinematicFrame } from "../src/render-common/cinematic/cinematic-frame";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import type { FrameState } from "../src/render-common/renderer-contract";
import { createCinematicView } from "../src/renderers/three/cinematic/cinematic-view";
import { createThreeCinematicCamera } from "../src/renderers/three/cinematic/three-cinematic-camera";
import { createThreeCameraRig } from "../src/renderers/three/three-camera";

const DEG = Math.PI / 180;
const flat = () => 0;

const shot = (overrides: Partial<CameraOrbit> = {}): CameraOrbit => ({
  distance: 40, fov: 30 * DEG, pitch: 40 * DEG, targetX: 64, targetY: 0, targetZ: 64, yaw: 0, ...overrides
});

const viewState = (): CameraState => ({ ...createCamera(64, 64, 1), viewportHeight: 900, viewportWidth: 1600 });

const cinematicFrame = (orbit: CameraOrbit | null, blend = 1): CinematicFrame => ({
  camera: orbit ? { blend, pose: orbitToPose(orbit) } : null,
  focusDistance: orbit?.distance ?? 1,
  glints: [],
  shake: null
});

const screenOf = (camera: PerspectiveCamera | OrthographicCamera, point: Vector3) => {
  camera.updateMatrixWorld();
  return point.clone().project(camera);
};

describe("cinematic orbit math", () => {
  it("round-trips orbit -> eye pose -> orbit", () => {
    const orbit = shot({ yaw: 1.1, pitch: 25 * DEG, targetY: 3 });
    const back = poseToOrbit(orbitToPose(orbit), orbit.distance);
    for (const key of Object.keys(orbit) as (keyof CameraOrbit)[]) expect(back[key]).toBeCloseTo(orbit[key], 9);
  });

  it("puts yaw 0 on the RTS perspective rig's side of the target", () => {
    const rig = createThreeCameraRig(flat, () => 0);
    rig.setMode("cinematic");
    const camera = rig.update(viewState()) as PerspectiveCamera;
    const toCamera = camera.position.clone().sub(new Vector3(64, 0, 64)).normalize();
    const pitch = Math.asin(toCamera.y);
    const eye = orbitEye(shot({ distance: 1, pitch }));
    expect(eye.x - 64).toBeCloseTo(toCamera.x, 6);
    expect(eye.z - 64).toBeCloseTo(toCamera.z, 6);
  });

  it("clamps a flat shot about its target", () => {
    const clamped = clampOrbitPitch(shot({ pitch: 10 * DEG }), 30 * DEG);
    expect(clamped.pitch).toBeCloseTo(30 * DEG);
    expect([clamped.targetX, clamped.targetZ, clamped.distance]).toEqual([64, 64, 40]);
    const steep = shot({ pitch: 50 * DEG });
    expect(clampOrbitPitch(steep, 30 * DEG)).toBe(steep);
  });

  it("interpolates yaw on the shortest arc and distance in log space", () => {
    const middle = interpolateOrbit(shot({ distance: 10, yaw: 3 }), shot({ distance: 90, yaw: -3 }), 0.5);
    expect(Math.abs(middle.yaw)).toBeGreaterThan(3);
    expect(middle.distance).toBeCloseTo(30, 9);
  });

  it("eases with exact end points", () => {
    for (const ease of ["linear", "easeIn", "easeOut", "easeInOut"] as const) {
      expect(easeProgress(ease, 0)).toBe(0);
      expect(easeProgress(ease, 1)).toBe(1);
    }
    expect(easeProgress("easeInOut", 0.25)).toBeLessThan(0.25);
  });

  it("drifts: dolly, signed orbit past half a turn, tilt and pan", () => {
    const arrived = shot();
    const drift = { distanceTo: 20, pitchBy: 0.1, targetTo: { x: 70, y: 1, z: 60 }, yawBy: 4 };
    expect(applyDrift(arrived, drift, 0).yaw).toBeCloseTo(0);
    const end = applyDrift(arrived, drift, 1);
    expect(end.distance).toBeCloseTo(20);
    expect(end.pitch).toBeCloseTo(arrived.pitch + 0.1);
    expect([end.targetX, end.targetY, end.targetZ]).toEqual([70, 1, 60]);
    // +4 rad wraps to 4 - 2pi; a shortest-arc interpolation would have turned the other way at 0.5.
    expect(applyDrift(arrived, drift, 0.5).yaw).toBeCloseTo(2, 9);
  });
});

describe("cinematic camera override", () => {
  const limits = QUALITY_PRESETS.high.cinematicView;
  const minimal = QUALITY_PRESETS.minimal.cinematicView;

  it("draws nothing without an override", () => {
    const rig = createThreeCinematicCamera({ cellsX: 128, cellsZ: 128, groundHeight: flat, limits });
    expect(rig.update(undefined, viewState(), new PerspectiveCamera(), { x: 0, y: 0, z: 0 })).toBeNull();
    expect(rig.update(cinematicFrame(null), viewState(), new PerspectiveCamera(), { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it("aims the pose at the shot target and derives the LOD camera from the framing", () => {
    const rig = createThreeCinematicCamera({ cellsX: 128, cellsZ: 128, groundHeight: flat, limits });
    const sample = rig.update(cinematicFrame(shot()), viewState(), new PerspectiveCamera(), { x: 0, y: 0, z: 0 })!;
    const centre = screenOf(sample.camera, new Vector3(64, 0, 64));
    expect(Math.abs(centre.x)).toBeLessThan(1e-6);
    expect(Math.abs(centre.y)).toBeLessThan(1e-6);
    expect(sample.lodCamera.centerX).toBeCloseTo(64, 6);
    expect(sample.lodCamera.centerZ).toBeCloseTo(64, 6);
    expect(sample.camera.fov).toBeCloseTo(30, 6);
  });

  it("lifts low shots to 30 degrees on Minimal and caps the far plane, keeping the target centred", () => {
    const rig = createThreeCinematicCamera({ cellsX: 128, cellsZ: 128, groundHeight: flat, limits: minimal });
    const low = shot({ distance: 200, pitch: 8 * DEG });
    const sample = rig.update(cinematicFrame(low), viewState(), new PerspectiveCamera(), { x: 0, y: 0, z: 0 })!;
    const look = sample.camera.getWorldDirection(new Vector3());
    expect(-Math.asin(look.y)).toBeCloseTo(30 * DEG, 6);
    expect(sample.camera.far).toBe(320);
    const centre = screenOf(sample.camera, new Vector3(64, 0, 64));
    expect(Math.abs(centre.y)).toBeLessThan(1e-6);
    const high = createThreeCinematicCamera({ cellsX: 128, cellsZ: 128, groundHeight: flat, limits })
      .update(cinematicFrame(low), viewState(), new PerspectiveCamera(), { x: 0, y: 0, z: 0 })!;
    // High keeps the shared RTS limit (12 degrees, MIN_PITCH of camera-state.ts).
    expect(-Math.asin(high.camera.getWorldDirection(new Vector3()).y)).toBeCloseTo(12 * DEG, 6);
  });

  it("keeps the eye above the ground", () => {
    const hill = () => 30;
    const rig = createThreeCinematicCamera({ cellsX: 128, cellsZ: 128, groundHeight: hill, limits });
    const sample = rig.update(cinematicFrame(shot({ pitch: 20 * DEG })), viewState(), new PerspectiveCamera(),
      { x: 0, y: 0, z: 0 })!;
    expect(sample.camera.position.y).toBeGreaterThanOrEqual(31.5);
  });

  it("blend 0 reproduces the underlying perspective camera and slerps towards the shot", () => {
    const rig = createThreeCinematicCamera({ cellsX: 128, cellsZ: 128, groundHeight: flat, limits });
    const underlying = new PerspectiveCamera(68, 1, 0.05, 600);
    underlying.position.set(10, 2, 10);
    underlying.lookAt(20, 2, 20);
    underlying.updateMatrixWorld();
    const start = rig.update(cinematicFrame(shot(), 0), viewState(), underlying, { x: 0, y: 0, z: 0 })!;
    expect(start.camera.position.distanceTo(underlying.position)).toBeLessThan(1e-9);
    expect(start.camera.quaternion.angleTo(underlying.quaternion)).toBeLessThan(1e-6);
    expect(start.camera.fov).toBeCloseTo(68);
  });

  it("blend 0 from the iso view frames the RTS target at the screen centre", () => {
    const rts = createThreeCameraRig(flat, () => 0);
    const iso = rts.update(viewState()) as OrthographicCamera;
    const rig = createThreeCinematicCamera({ cellsX: 128, cellsZ: 128, groundHeight: flat, limits });
    const sample = rig.update(cinematicFrame(shot({ targetX: 30 }), 0), viewState(), iso, { x: 64, y: 0, z: 64 })!;
    const centre = screenOf(sample.camera, new Vector3(64, 0, 64));
    expect(Math.abs(centre.x)).toBeLessThan(1e-6);
    expect(Math.abs(centre.y)).toBeLessThan(1e-6);
  });
});

describe("cinematic view selection", () => {
  const frameWith = (cinematic?: CinematicFrame) =>
    ({ camera: viewState(), cinematic, time: 1 }) as unknown as FrameState;

  const createView = (quality: "high" | "minimal" = "high") => createCinematicView({ cellsX: 128, cellsZ: 128,
    groundHeight: flat, limits: QUALITY_PRESETS[quality].cinematicView, rtsTargetHeight: () => 0,
    scene: new Scene() });

  it("passes ordinary frames through without allocating and records the drawn iso pose", () => {
    const view = createView();
    const frame = frameWith();
    const iso = createThreeCameraRig(flat, () => 0).update(frame.camera);
    const result = view.resolve(frame, iso, false);
    expect(result.camera).toBe(iso);
    expect(result.frame).toBe(frame);
    expect(result.overriding).toBe(false);
    const pose = view.currentCameraPose()!;
    expect(pose.projection).toBe("orthographic");
    expect([pose.orbit.targetX, pose.orbit.targetZ, pose.orbit.yaw]).toEqual([64, 64, 0]);
  });

  it("prefers the cinematic camera over exploration and never writes the RTS camera", () => {
    const view = createView();
    const frame = frameWith(cinematicFrame(shot({ targetX: 40 })));
    const before = { ...frame.camera };
    const exploration = new PerspectiveCamera();
    const result = view.resolve(frame, exploration, true);
    expect(result.camera).not.toBe(exploration);
    expect(result.overriding).toBe(true);
    // The possessed path keeps its own LOD frame; the RTS path gets a stand-in camera.
    expect(result.frame).toBe(frame);
    expect(frame.camera).toEqual(before);
    const rtsResult = view.resolve(frame, exploration, false);
    expect(rtsResult.frame.camera.centerX).toBeCloseTo(40, 6);
    expect(frame.camera).toEqual(before);
    expect(view.currentCameraPose()!.orbit.targetX).toBeCloseTo(40, 6);
  });

  it("draws one glint layer whose sparkle and edge-dot count follows the detail level", () => {
    // Two map rows: every cell is a boundary cell, so the edge dots hit the cap as well.
    const cells = new Int32Array(Array.from({ length: 200 }, (_, index) => index));
    for (const [quality, sprites] of [["high", 96], ["minimal", 24]] as const) {
      const view = createView(quality);
      const frame = frameWith({ ...cinematicFrame(null), glints: [{ cells }] });
      view.resolve(frame, new PerspectiveCamera(), false);
      expect(view.glintSprites()).toBe(sprites * 2);
      view.resolve(frameWith(), new PerspectiveCamera(), false);
      expect(view.glintSprites()).toBe(0);
    }
  });

  it("shakes only the cinematic override, never the player's own camera (CIN6)", () => {
    const view = createView();
    const shake = { pitch: 0.02, x: 0.3, y: 0.2, yaw: 0.02 };
    const rts = createThreeCameraRig(flat, () => 0).update(frameWith().camera);
    const before = rts.position.clone();
    view.resolve(frameWith({ ...cinematicFrame(null), shake }), rts, false);
    expect(rts.position.equals(before)).toBe(true);
    const plain = view.resolve(frameWith(cinematicFrame(shot())), new PerspectiveCamera(), false).camera.position
      .clone();
    const shaken = view.resolve(frameWith({ ...cinematicFrame(shot()), shake }), new PerspectiveCamera(), false);
    expect(shaken.camera.position.distanceTo(plain)).toBeGreaterThan(0.1);
  });
});
