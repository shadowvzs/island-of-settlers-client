import { Bone, DataTexture, Matrix4, Skeleton } from "three";
import { expect, it } from "vitest";

import { isSkeletonGated, setSkeletonsGated } from "../src/renderers/three/character-skeleton-gate";

const uploadedSkeleton = () => {
  const bone = new Bone();
  bone.updateMatrixWorld(true);
  const skeleton = new Skeleton([bone], [new Matrix4()]);
  skeleton.boneTexture = new DataTexture();
  skeleton.update();
  return skeleton;
};

it("skips the bone-matrix update of a gated skeleton and resumes it when thawed", () => {
  const skeleton = uploadedSkeleton();
  const version = skeleton.boneTexture!.version;
  setSkeletonsGated([skeleton], true);
  expect(isSkeletonGated(skeleton)).toBe(true);
  skeleton.update();
  expect(skeleton.boneTexture!.version).toBe(version);
  setSkeletonsGated([skeleton], false);
  expect(isSkeletonGated(skeleton)).toBe(false);
  skeleton.update();
  expect(skeleton.boneTexture!.version).toBeGreaterThan(version);
});

it("never gates a skeleton that has not uploaded its bone texture yet", () => {
  const bone = new Bone();
  bone.position.set(1, 2, 3);
  bone.updateMatrixWorld(true);
  const skeleton = new Skeleton([bone], [new Matrix4()]);
  setSkeletonsGated([skeleton], true);
  expect(isSkeletonGated(skeleton)).toBe(false);
  skeleton.update();
  // A gated first update would leave the bind-pose matrices at zero.
  expect(skeleton.boneMatrices!.some(value => value !== 0)).toBe(true);
});
