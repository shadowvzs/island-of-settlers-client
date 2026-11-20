import assert from "node:assert/strict";
import { type SkinnedMesh, Vector3 } from "three";

import { neckBoneWeights } from "../../../island-of-settlers-worker-generation/src/national-workers/source-skin-streams";

export interface ClothWeightGroup {
  joints: number[];
  members: number[];
  raw: Vector3;
  seed: number[];
  weights: number[];
}

const simplex = (values: number[]) => {
  const sorted = [...values].sort((a, b) => b - a);
  let sum = 0, threshold = 0;
  sorted.forEach((value, index) => {
    sum += value;
    const candidate = (sum - 1) / (index + 1);
    if (value > candidate) threshold = candidate;
  });
  return values.map(value => Math.max(0, value - threshold));
};

/** Shared UV-seam vertices remain one skin variable, so fitting cannot tear a source seam. */
export const createClothWeightGroups = (body: SkinnedMesh, owned: ReadonlySet<number>,
  reference: readonly Vector3[], hipsX: number) => {
  const position = body.geometry.getAttribute("position");
  const skinIndex = body.geometry.getAttribute("skinIndex"), skinWeight = body.geometry.getAttribute("skinWeight");
  let maximum: number | undefined;
  if (skinWeight.normalized && skinWeight.array instanceof Uint8Array) maximum = 255;
  if (skinWeight.normalized && skinWeight.array instanceof Uint16Array) maximum = 65535;
  const quantizeWeight = (value: number) => {
    if (maximum) return Math.round(value * maximum) / maximum;
    return Math.fround(value);
  };
  const bone = new Map(body.skeleton.bones.map((bone, index) => [bone.name, index]));
  const members = new Map<string, number[]>();
  for (const vertex of owned) {
    const existing = new Map<number, number>();
    for (let slot = 0; slot < 4; slot++) {
      const joint = skinIndex.getComponent(vertex, slot), weight = skinWeight.getComponent(vertex, slot);
      if (weight > 1e-8) existing.set(joint, (existing.get(joint) ?? 0) + weight);
    }
    // Coincident source fold layers may intentionally have different skinning. Only actual
    // position+skin duplicates are UV seams; merging unlike layers changes the clean baseline.
    const signature = [...existing].sort((a, b) => a[0] - b[0])
      .map(([joint, weight]) => `${joint}:${Math.round(weight * 1e6)}`).join(",");
    const key = `${reference[vertex]!.toArray().map(value => Math.round(value * 1e6)).join(",")}/${signature}`;
    const vertices = members.get(key) ?? []; vertices.push(vertex); members.set(key, vertices);
  }
  const groups: ClothWeightGroup[] = [...members.values()].map(vertices => {
    const weights = new Map<number, number>();
    for (const vertex of vertices) for (let slot = 0; slot < 4; slot++) {
      const joint = skinIndex.getComponent(vertex, slot), weight = skinWeight.getComponent(vertex, slot);
      if (weight > 1e-8) weights.set(joint, (weights.get(joint) ?? 0) + weight / vertices.length);
    }
    const joints = [...weights].sort((a, b) => b[1] - a[1]).map(([joint]) => joint).slice(0, 4);
    const first = vertices[0]!, side = reference[first]!.x >= hipsX ? "Left" : "Right";
    const raw = new Vector3().fromBufferAttribute(position, first);
    for (const vertex of vertices) assert(raw.distanceTo(new Vector3().fromBufferAttribute(position, vertex)) < .000002,
      "A cloth weld cannot merge different raw source positions");
    for (const name of ["Hips", `${side}UpLeg`, `${side}Leg`, "Spine"]) {
      const joint = bone.get(name); assert(joint !== undefined);
      if (joints.length < 4 && !joints.includes(joint)) joints.push(joint);
    }
    const seed = joints.map(joint => weights.get(joint) ?? 0), total = seed.reduce((sum, weight) => sum + weight, 0);
    assert(total > 0);
    // The fit cache is anchored AFTER write(). Keep the actual Float32 attributes as its
    // seed, rather than the unrounded normalized proposal; otherwise even a no-op projection
    // introduces a fictitious skin delta at numerically delicate source seams.
    seed.forEach((weight, slot) => { seed[slot] = quantizeWeight(weight / total); });
    return { joints, members: vertices, raw, seed, weights: [...seed] };
  });
  const byVertex = new Map<number, number>();
  groups.forEach((group, id) => group.members.forEach(vertex => byVertex.set(vertex, id)));
  const project = (group: ClothWeightGroup) => {
    let next = simplex(group.weights);
    const delta = next.reduce((sum, value, slot) => sum + Math.abs(value - group.seed[slot]!), 0);
    if (delta > .35) next = next.map((value, slot) => group.seed[slot]! + (value - group.seed[slot]!) * .35 / delta);
    const skin = neckBoneWeights(new Map(group.joints.map((joint, slot) => [joint, next[slot]!])), maximum);
    group.weights.fill(0);
    skin.joints.forEach((joint, slot) => {
      if (!skin.weights[slot]) return;
      const target = group.joints.indexOf(joint); assert(target >= 0);
      group.weights[target]! += quantizeWeight(skin.weights[slot]!);
    });
  };
  const write = () => {
    for (const group of groups) for (const vertex of group.members) {
      skinIndex.setXYZW(vertex, ...[0, 1, 2, 3].map(slot => group.joints[slot] ?? 0) as [number, number, number, number]);
      skinWeight.setXYZW(vertex, ...[0, 1, 2, 3].map(slot => group.weights[slot] ?? 0) as [number, number, number, number]);
    }
    skinIndex.needsUpdate = true; skinWeight.needsUpdate = true;
  };
  return { byVertex, groups, project, quantizeWeight, write };
};
