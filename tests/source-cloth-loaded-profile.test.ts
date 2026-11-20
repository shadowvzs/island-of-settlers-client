import { Bone, BufferGeometry, Float32BufferAttribute, Skeleton, SkinnedMesh, Uint16BufferAttribute } from "three";
import { expect, it } from "vitest";

import { applyLoadedSourceClothProfile } from "../tools/analysis/source-cloth-loaded-profile";

it("matches Three's loader normalization exactly while preserving noncostume skin", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute([0, 1, 2, 3, 0, 1, 2, 3], 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0, .2, .3, .4, .1], 4));
  const body = new SkinnedMesh(geometry), bones = Array.from({ length: 4 }, (_, at) => {
    const bone = new Bone(); bone.name = `bone${at}`; return bone;
  });
  body.bind(new Skeleton(bones));
  const raw = [.8952980041503906, .09625345468521118, .008448483422398567, 0];
  const expected = new SkinnedMesh(geometry.clone());
  expected.geometry.getAttribute("skinWeight").setXYZW(0, ...raw as [number, number, number, number]);
  expected.normalizeSkinWeights();
  const before = Array.from(body.geometry.getAttribute("skinWeight").array).slice(4);
  applyLoadedSourceClothProfile(body, [{ vertices: [0], joints: [0, 1, 2, 3],
    jointNames: bones.map(bone => bone.name), weights: raw }], new Set([0]), new Set([1]));
  const actual = Array.from(body.geometry.getAttribute("skinWeight").array);
  expect(actual.slice(0, 4)).toEqual(Array.from(expected.geometry.getAttribute("skinWeight").array).slice(0, 4));
  expect(actual.slice(0, 4)).not.toEqual(raw);
  expect(actual.slice(4)).toEqual(before);
});
