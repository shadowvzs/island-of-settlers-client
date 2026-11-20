import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { createPersianRoomGeometry } from "../src/renderers/three/buildings/persian-room-geometry";

it.each([true, false])("cuts real arched windows through both sides of a thick rounded room (%s)", detailed => {
  const part: BuildingPart = { persianOpening: [0, 0, -.49],
    persianWindows: [0, Math.PI].map(angle => ({ angle, bottom: -.20, halfAngle: .20, rise: .10, spring: .10 })),
    position: [0, 0, 0], shape: "persian-room", size: [1, 1, 1], stage: 1, surface: "plaster" };
  const geometry = createPersianRoomGeometry(part, detailed), material = new MeshBasicMaterial();
  const object = new Mesh(geometry, material); object.updateMatrixWorld(true);
  const ray = (x: number, y: number) => new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1))
    .intersectObject(object);
  expect(ray(0, 0)).toHaveLength(0);
  expect(ray(0, .15)).toHaveLength(0);
  expect(ray(0, .30)[0]!.point.z).toBeCloseTo(.5);
  expect(ray(0, -.30)[0]!.point.z).toBeCloseTo(.5);
  expect(ray(.15, 0).length).toBeGreaterThan(0);
  expect(ray(.09, .17).length).toBeGreaterThan(0);
  geometry.dispose(); material.dispose();
});
