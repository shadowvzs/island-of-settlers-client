import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial, NumberKeyframeTrack,
  QuaternionKeyframeTrack } from "three";
import { expect, it } from "vitest";

import { prepareBuildingExportAnimationTargets } from "../tools/bench/building-export-animation-targets";

it("retains the real empty hidden entrance anchor for a no-op GLB clip and restores its visibility", () => {
  const root = new Group(), door = new Group(); door.name = "indigenous_18_door"; door.visible = false; root.add(door);
  const clip = new AnimationClip("door", 1, [new QuaternionKeyframeTrack(`${door.name}.quaternion`,
    [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
  const prepared = prepareBuildingExportAnimationTargets(root, [clip]);
  expect(door.visible).toBe(true); expect(door.children).toHaveLength(0);
  prepared.restore(); prepared.restore(); expect(door.visible).toBe(false);
});

it("never exposes hidden meshes or groups containing hidden architectural geometry", () => {
  const root = new Group(), door = new Group(); door.name = "door"; door.visible = false;
  const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); mesh.visible = false; door.add(mesh); root.add(door);
  const clip = new AnimationClip("door", 1, [new QuaternionKeyframeTrack("door.quaternion", [0], [0, 0, 0, 1])]);
  const prepared = prepareBuildingExportAnimationTargets(root, [clip]);
  expect(door.visible).toBe(false); expect(mesh.visible).toBe(false); prepared.restore();
});

it("rejects a nonexistent curtain morph instead of dropping its track", () => {
  const root = new Group(), clip = new AnimationClip("door", 1,
    [new NumberKeyframeTrack("tent_fabric.morphTargetInfluences[0]", [0], [0])]);
  expect(() => prepareBuildingExportAnimationTargets(root, [clip])).toThrow("Missing export morph target");
});

it("binds hidden Well channels to a nonrendering proxy while preserving original clips and geometry", () => {
  const root = new Group(), well = new Group(), door = new Group();
  well.name = "indigenous_35"; well.userData.buildingId = 35; root.add(well);
  door.name = "indigenous_35_door"; door.visible = false; well.add(door);
  const fabric = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  fabric.name = "indigenous_35_tent_fabric"; door.add(fabric);
  const clip = new AnimationClip("indigenous_35_door", 2,
    [new NumberKeyframeTrack(`${fabric.name}.morphTargetInfluences[0]`, [0, 1, 2], [0, 1, 0])]);
  const prepared = prepareBuildingExportAnimationTargets(root, [clip]);
  expect(clip.tracks[0]!.name).toBe(`${fabric.name}.morphTargetInfluences[0]`);
  const proxy = well.getObjectByName("indigenous_35_hidden_door_anchor")!;
  expect(proxy.children).toHaveLength(0); expect(door.visible).toBe(false);
  expect(prepared.animations[0]!.name).toBe(clip.name);
  expect(prepared.animations[0]!.duration).toBe(2);
  expect(prepared.animations[0]!.tracks[0]!.name).toBe(`${proxy.name}.quaternion`);
  expect(Array.from(prepared.animations[0]!.tracks[0]!.times)).toEqual([0, 1, 2]);
  prepared.restore(); expect(well.children).toEqual([door]); expect(door.children).toEqual([fabric]);
});
