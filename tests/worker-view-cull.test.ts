import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";

import { createWorkerViewCull, WORKER_CULL_RADIUS } from "../src/renderers/three/worker-view-cull";

/** A camera above (0, 0) looking straight down with a 60° view. */
const downCamera = () => {
  const camera = new PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, 20, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return camera;
};

describe("worker view cull", () => {
  it("keeps workers in view and just past the edge, drops those far outside", () => {
    const cull = createWorkerViewCull();
    cull.setCamera(downCamera());
    // Half the view at the ground is 20·tan(30°) ≈ 11.5 cells.
    expect(cull.contains(0, 0, 0)).toBe(true);
    expect(cull.contains(11.5 + WORKER_CULL_RADIUS * 0.9, 0, 0)).toBe(true);
    expect(cull.contains(30, 0, 0)).toBe(false);
    expect(cull.contains(0, 0, -40)).toBe(false);
  });

  it("counts every worker as visible without a camera (first-frame preparation)", () => {
    const cull = createWorkerViewCull();
    cull.setCamera(undefined);
    expect(cull.contains(1000, 0, 1000)).toBe(true);
  });
});
