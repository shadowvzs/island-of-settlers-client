import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { type CameraState, createCamera } from "../src/render-common/camera-state";
import { createThreeCameraRig, getSightLift, sampleViewGround } from "../src/renderers/three/three-camera";

const viewState = (zoom = 1): CameraState =>
  ({ ...createCamera(64, 64, zoom), viewportHeight: 900, viewportWidth: 1600 });

/** A flat-topped mesa of height 20 within 30 cells of (64, 64), sea level elsewhere. */
const mesa = (x: number, z: number) => (Math.hypot(x - 64, z - 64) < 30 ? 20 : 0);

const projectToNdc = (camera: ReturnType<ReturnType<typeof createThreeCameraRig>["update"]>, point: Vector3) => {
  camera.updateMatrixWorld();
  return point.clone().project(camera);
};

describe("camera aims at the ground height (MC-05)", () => {
  it("keeps today's sea level view on flat ground", () => {
    const rig = createThreeCameraRig(() => 0, () => 0);
    const camera = rig.update(viewState());
    expect(rig.getTargetHeight()).toBe(0);
    const centre = projectToNdc(camera, new Vector3(64, 0, 64));
    expect(Math.abs(centre.x)).toBeLessThan(1e-6);
    expect(Math.abs(centre.y)).toBeLessThan(1e-6);
  });

  it("puts a raised centre at the screen centre in the iso and the cinematic view", () => {
    for (const mode of ["iso", "cinematic"] as const) {
      const rig = createThreeCameraRig(mesa, () => 0);
      rig.setMode(mode);
      const camera = rig.update(viewState());
      const centre = projectToNdc(camera, new Vector3(64, 20, 64));
      expect(Math.abs(centre.x)).toBeLessThan(1e-4);
      expect(Math.abs(centre.y)).toBeLessThan(1e-4);
    }
  });

  it("eases the target between frames instead of jumping", () => {
    let time = 0;
    const rig = createThreeCameraRig(mesa, () => time);
    const state = { ...viewState(), centerX: 200, centerZ: 200 };
    rig.update(state);
    expect(rig.getTargetHeight()).toBe(0);
    time = 16;
    rig.update(viewState());
    expect(rig.getTargetHeight()).toBeGreaterThan(0);
    expect(rig.getTargetHeight()).toBeLessThan(5);
    for (let frame = 0; frame < 120; frame++) {
      time += 16;
      rig.update(viewState());
    }
    expect(rig.getTargetHeight()).toBeCloseTo(20, 1);
  });

  it("samples a cross that grows with the view", () => {
    const ridge = (x: number) => (x > 70 ? 10 : 0);
    expect(sampleViewGround(viewState(3), ridge)).toBe(0);
    expect(sampleViewGround(viewState(0.2), ridge)).toBeGreaterThan(0);
  });

  it("lifts the cinematic camera over a ridge between it and the target", () => {
    const wall = (x: number) => (x > 70 && x < 75 ? 30 : 0);
    const lift = getSightLift({ x: 64, y: 0, z: 64 }, { x: 100, y: 20, z: 64 }, wall);
    expect(lift).toBeGreaterThan(0);
    expect(getSightLift({ x: 64, y: 0, z: 64 }, { x: 100, y: 20, z: 64 }, () => 0)).toBe(0);
  });
});
