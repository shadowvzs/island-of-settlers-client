import { Bone, BufferGeometry, Float32BufferAttribute, Group, Matrix4, MeshBasicMaterial,
  Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { ArmourPoseSnapshot } from "../tools/analysis/armour-pose-snapshot";
import { clothPosePoints, prepareClothPose } from "../tools/analysis/source-cloth-weight-contacts";
import { type ClothWeightGroup, createClothWeightGroups } from "../tools/analysis/source-cloth-weight-groups";
import { clothSupportTransfer } from "../tools/analysis/source-cloth-weight-step";

const createFixture = () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([.2, .3, -.1, .4, .3, -.1, .2, .5, -.1], 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3], 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute([.4, .6, 0, 0, .4, .6, 0, 0, .4, .6, 0, 0], 4));
  const body = new SkinnedMesh(geometry, new MeshBasicMaterial()), root = new Group();
  body.name = "body";
  const bones = ["Hips", "LeftUpLeg", "LeftLeg", "Spine"].map(name => {
    const bone = new Bone(); bone.name = name; return bone;
  });
  body.bind(new Skeleton(bones, bones.map(() => new Matrix4())));
  root.add(body);
  const groups: ClothWeightGroup[] = [0, 1, 2].map(vertex => {
    const seed = [0, 1, 2, 3].map(slot => geometry.getAttribute("skinWeight").getComponent(vertex, slot));
    return { joints: [0, 1, 2, 3], members: [vertex],
      raw: new Vector3().fromBufferAttribute(geometry.getAttribute("position"), vertex), seed, weights: [...seed] };
  });
  const matrixWorld = new Matrix4().makeRotationY(.43).scale(new Vector3(1.3, .9, 1.1)).setPosition(12, 2, -7);
  const inverseBind = new Matrix4().makeTranslation(-.13, .27, -.19);
  const diagnostics: ArmourPoseSnapshot = { schema: 1, posedMeshes: [{ name: "body", skeleton: 0,
    matrixWorld: matrixWorld.toArray(), bindMatrix: inverseBind.clone().invert().toArray(),
    bindMatrixInverse: inverseBind.toArray() }], skeletons: [{ bones: bones.map((bone, joint) => ({ name: bone.name,
      matrixWorld: new Matrix4().makeRotationZ(joint * .3).setPosition(joint * .1, joint * -.08, joint * .04).toArray() })),
    inverses: bones.map(() => new Matrix4().toArray()) }] };
  const cell = { diagnostics, label: "float32-weight-sum" };
  return { body, cell, groups };
};

describe("source cloth affine skin cache", () => {
  it("moves available weight towards support even when the steepest unrestricted donor is empty", () => {
    const transfer = clothSupportTransfer([.8, .2, 0, 0], [.1, .2, -.8, -.9], .03)!;
    expect(transfer.donor).toBe(0);
    expect(transfer.recipient).toBe(1);
    expect(transfer.weights.every(weight => weight >= 0)).toBe(true);
    expect(transfer.weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 14);
    expect(transfer.weights[1]).toBeGreaterThan(.2);
    expect(clothSupportTransfer([0, 1, 0, 0], [.1, .2, -.8, -.9], .03)).toBeUndefined();
  });

  it("retains the native seed exactly with inexact Float32 weight sums and translated bind/world matrices", () => {
    const { body, cell, groups: originalGroups } = createFixture();
    expect(originalGroups[0]!.seed.reduce((sum, weight) => sum + weight, 0)).not.toBe(1);
    const grouped = createClothWeightGroups(body, new Set([0, 1, 2]), originalGroups.map(group => group.raw), 0);
    grouped.write();
    const { groups } = grouped;
    for (const group of groups) group.seed.forEach((weight, slot) =>
      expect(weight).toBe(body.geometry.getAttribute("skinWeight").getComponent(group.members[0]!, slot)));
    const pose = prepareClothPose(body, body, cell, groups, [0, 1, 2], [0, 1, 2]);
    const points = clothPosePoints(pose, groups);
    for (const group of groups) {
      const vertex = group.members[0]!, actual = body.applyBoneTransform(vertex, group.raw.clone()).applyMatrix4(body.matrixWorld);
      expect(points[vertex]!.toArray()).toEqual(actual.toArray());
    }
  });

  it("matches the real skin derivative when weight moves between joints without moving anatomy", () => {
    const { body, cell, groups } = createFixture();
    const pose = prepareClothPose(body, body, cell, groups, [0, 1, 2], [0, 1, 2]);
    for (const group of groups) {
      group.weights[0]! += .125; group.weights[1]! -= .125;
      const vertex = group.members[0]!;
      body.geometry.getAttribute("skinWeight").setXYZW(vertex, ...group.weights as [number, number, number, number]);
      // Quantized output attributes, rather than the unrounded optimizer proposal, are authoritative.
      group.weights = group.weights.map((_, slot) => body.geometry.getAttribute("skinWeight").getComponent(vertex, slot));
    }
    const points = clothPosePoints(pose, groups);
    for (const group of groups) {
      const vertex = group.members[0]!, actual = body.applyBoneTransform(vertex, group.raw.clone()).applyMatrix4(body.matrixWorld);
      expect(points[vertex]!.toArray()).toEqual(actual.toArray());
      expect(new Vector3().fromBufferAttribute(body.geometry.getAttribute("position"), vertex).toArray())
        .toEqual(group.raw.toArray());
    }
  });

  it("keeps normalized integer skin weights in their actual stored domain", () => {
    const { body, cell, groups: originalGroups } = createFixture();
    body.geometry.setAttribute("skinWeight", new Uint16BufferAttribute([
      26214, 39321, 0, 0, 26214, 39321, 0, 0, 26214, 39321, 0, 0,
    ], 4, true));
    const grouped = createClothWeightGroups(body, new Set([0, 1, 2]), originalGroups.map(group => group.raw), 0);
    grouped.write();
    const pose = prepareClothPose(body, body, cell, grouped.groups, [0, 1, 2], [0, 1, 2]);
    for (const group of grouped.groups) {
      group.weights[0]! -= .03125; group.weights[1]! += .03125;
      grouped.project(group);
    }
    grouped.write();
    const points = clothPosePoints(pose, grouped.groups);
    for (const group of grouped.groups) {
      const vertex = group.members[0]!;
      group.weights.forEach((weight, slot) =>
        expect(weight).toBe(body.geometry.getAttribute("skinWeight").getComponent(vertex, slot)));
      const actual = body.applyBoneTransform(vertex, group.raw.clone()).applyMatrix4(body.matrixWorld);
      expect(points[vertex]!.toArray()).toEqual(actual.toArray());
    }
  });
});
