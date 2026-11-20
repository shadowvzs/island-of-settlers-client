import { PerspectiveCamera } from "three";
import { expect, it } from "vitest";

import { createOrnamentalPlantLod } from "../src/renderers/three/plants/ornamental-plant-lod";
import type { RoadDecorationFrame } from "../src/shared/settlement/road-decoration-state";

const frame: RoadDecorationFrame = {
  uid: 7, item: "roadDecoration:plant-round-boxwood-roadside-ground-0:native",
  position: [0, 0, 0], yaw: 0,
  volumes: [{ min: [-1, 0, -1], max: [1, 1.5, 1] }], supports: []
};

const cameraAt = (distance: number) => {
  const camera = new PerspectiveCamera(35, 1, .1, 1000);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, .75, 0);
  camera.updateMatrixWorld();
  return camera;
};

it("keeps a near plant near over one camera quantization step", () => {
  const lod = createOrnamentalPlantLod(true);
  try {
    lod.update([frame], cameraAt(56), 900);
    expect(lod.tierFor(frame.uid)).toBe("near");
    // 58 is one floor(z / 2) step away and drops the projected height below the 70 px entry point.
    lod.update([frame], cameraAt(58), 900);
    expect(lod.tierFor(frame.uid)).toBe("near");
  } finally { lod.dispose(); }
});

it("still drops below 80% of the threshold", () => {
  const lod = createOrnamentalPlantLod(true);
  try {
    lod.update([frame], cameraAt(56), 900);
    expect(lod.tierFor(frame.uid)).toBe("near");
    lod.update([frame], cameraAt(80), 900);
    expect(lod.tierFor(frame.uid)).not.toBe("near");
  } finally { lod.dispose(); }
});
