import { Bone, BoxGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from "three";
import { expect, it } from "vitest";

import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createWorkerCatapultSupport } from "../src/renderers/three/worker-catapult-support";

it("calibrates a rig's real soles to the platform once and releases the offset outside the tower", () => {
  const group = new Group(), root = new Group(), foot = new Bone();
  foot.name = "LeftFoot"; group.position.y = 2.005; group.add(root); root.add(foot); root.scale.setScalar(.916);
  const geometry = new BoxGeometry(.1, .1, .2); geometry.translate(0, .01, 0);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4); for (let vertex = 0; vertex < count; vertex++) weights[vertex * 4] = 1;
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  const material = new MeshBasicMaterial(), mesh = new SkinnedMesh(geometry, material); root.add(mesh);
  group.updateMatrixWorld(true); mesh.bind(new Skeleton([foot]));
  const support = createWorkerCatapultSupport(root);
  const frame = { y: 2, action: "idle_breathe", catapultStoneDiameter: .16 } as WorkerFrame;
  support.present(frame); support.capture(frame);
  const point = new Vector3(); let sole = Infinity;
  for (let vertex = 0; vertex < count; vertex++) {
    mesh.getVertexPosition(vertex, point); mesh.localToWorld(point); sole = Math.min(sole, point.y);
  }
  expect(sole).toBeCloseTo(2.001, 6);
  const calibrated = root.position.y;
  support.present({ ...frame, action: "walk" }); support.capture({ ...frame, action: "walk" });
  expect(root.position.y).toBe(calibrated);
  support.present({ ...frame, catapultStoneDiameter: undefined }); expect(root.position.y).toBe(0);
  geometry.dispose(); material.dispose();
});
