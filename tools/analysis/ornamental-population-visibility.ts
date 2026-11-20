import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Box3, Frustum, Matrix4, Vector3 } from "three";

import { getRoadDecorationItem } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { createOrnamentalPlantModels } from "../../src/renderers/three/plants/ornamental-plant-model";
import { createThreeCameraRig } from "../../src/renderers/three/three-camera";

const cameraState = { centerX: 60, centerZ: 45, viewportWidth: 1100, viewportHeight: 900,
  zoom: .15, yaw: 0, tilt: 0 };
const ids = ["roadDecoration:plant-red-maple-standalone-ground-0:native",
  "roadDecoration:plant-bonsai-maple-roadside-pot-0:native",
  "roadDecoration:plant-round-boxwood-roadside-ground-0:native"];
const camera = createThreeCameraRig(() => 0).update(cameraState);
camera.updateMatrixWorld(true);
const frustum = new Frustum().setFromProjectionMatrix(new Matrix4()
  .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
const owner = createOrnamentalPlantModels(false);
const models = ids.map(id => owner.create(getRoadDecorationItem(id)!.plant!, "far"));
const local = models.map(model => new Box3().setFromObject(model.root));
const bounds = new Box3(), transform = new Matrix4(), point = new Vector3();
let fullyVisible = 0, partiallyVisible = 0, outside = 0;
try {
  for (let index = 0; index < 192; index++) {
    transform.makeRotationY(index * .73 % (Math.PI * 2));
    transform.setPosition(8 + index % 16 * 7, 0, 8 + Math.floor(index / 16) * 7);
    bounds.copy(local[index % 3]!).applyMatrix4(transform);
    if (!frustum.intersectsBox(bounds)) { outside++; continue; }
    let fully = true;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) if (!frustum.containsPoint(point.set(x, y, z))) fully = false;
    if (fully) fullyVisible++; else partiallyVisible++;
  }
  const report = { method: "CPU reconstruction of exact native-a isometric camera and actual far geometry AABBs",
    camera: cameraState, submittedInstances: 192, fullyVisible, partiallyVisible, outside,
    intersectingInstances: fullyVisible + partiallyVisible,
    submittedTrianglesWithGround: models.reduce((sum, model) => sum + model.triangles * 64, 2),
    shadowPasses: 0, note: "GPU report is separate; a chunk submission can include offscreen instances." };
  writeFileSync(resolve("../resources/project-reviews/ornamental-plant-runtime-2026-11-04/native-a/visibility-cpu.json"),
    JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { models.forEach(model => model.dispose()); }
