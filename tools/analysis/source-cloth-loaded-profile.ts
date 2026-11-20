import assert from "node:assert/strict";
import { type SkinnedMesh, Vector4 } from "three";

interface FrozenSkinGroup { vertices: number[]; joints: number[]; jointNames: string[]; weights: number[] }

/** Reproduce GLTFLoader's one normalization pass after a frozen profile is serialized.
 * Normalizing only the overwritten garment vertices preserves already-loaded anatomy bytes. */
export const applyLoadedSourceClothProfile = (body: SkinnedMesh, groups: readonly FrozenSkinGroup[],
  owned: ReadonlySet<number>, legs: ReadonlySet<number>) => {
  const index = body.geometry.getAttribute("skinIndex"), weights = body.geometry.getAttribute("skinWeight");
  const vector = new Vector4();
  for (const group of groups) {
    assert(group.joints.every((joint, slot) => body.skeleton.bones[joint]?.name === group.jointNames[slot]),
      "Frozen cloth profile must match the exact loaded source rig order");
    for (const vertex of group.vertices) {
      assert(owned.has(vertex) && !legs.has(vertex));
      index.setXYZW(vertex, ...group.joints as [number, number, number, number]);
      weights.setXYZW(vertex, ...group.weights as [number, number, number, number]);
      vector.set(weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex));
      const scale = 1 / vector.manhattanLength();
      if (scale !== Infinity) vector.multiplyScalar(scale); else vector.set(1, 0, 0, 0);
      weights.setXYZW(vertex, vector.x, vector.y, vector.z, vector.w);
    }
  }
};
