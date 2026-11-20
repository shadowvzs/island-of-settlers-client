import { Bone, BoxGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh,
  Uint16BufferAttribute } from "three";
import { expect, it } from "vitest";

import { createUnitEyeOffset } from "../src/renderers/three/unit-eye-offset";

it("reads the real scaled/posed head relative to its ground root without moving either", () => {
  const world = new Group(), ground = new Group(), body = new Group(), head = new Bone();
  world.add(ground); ground.add(body); body.add(head); head.name = "Head";
  ground.position.set(10, 2, 5); body.scale.setScalar(.9); head.position.set(.02, 1.1, .05);
  const sample = createUnitEyeOffset(body, ground), position = ground.position.clone();
  const first = sample()!;
  expect(first.x).toBeCloseTo(.018); expect(first.y).toBeCloseTo(1.025); expect(first.z).toBeCloseTo(.045);
  expect(ground.position.equals(position)).toBe(true);
  head.position.y += .1;
  expect(sample()!.y).toBeCloseTo(1.115);
  ground.position.set(20, 5, 15); expect(sample()!.y).toBeCloseTo(1.115);
  expect(createUnitEyeOffset(new Group(), ground)()).toBeUndefined();
});

it("places eyes within the measured skinned head instead of at its neck pivot", () => {
  const ground = new Group(), body = new Group(), head = new Bone();
  ground.add(body); head.name = "Head"; head.position.y = 1;
  const geometry = new BoxGeometry(.2, .3, .2).translate(0, 1.15, 0);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) weights[index * 4] = 1;
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  const material = new MeshBasicMaterial(), mesh = new SkinnedMesh(geometry, material);
  mesh.add(head); body.add(mesh); mesh.bind(new Skeleton([head]));
  const vertices = Array.from(geometry.getAttribute("position").array);
  const sample = createUnitEyeOffset(body, ground);
  expect(sample()!.y).toBeCloseTo(1.216, 5);
  head.position.y += .05;
  expect(sample()!.y).toBeCloseTo(1.266, 5);
  expect(Array.from(geometry.getAttribute("position").array)).toEqual(vertices);
  mesh.skeleton.dispose(); geometry.dispose(); material.dispose();
});
