import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";

import type { ClothControlVertex } from "../tools/analysis/armour-cloth-controls";
import { seedArmourClothWeights } from "../tools/analysis/armour-cloth-seed";

const vertex = (point: number[], weights: number[]): ClothControlVertex => ({ rest: new Vector3(...point),
  weights, bones: ["LeftArm", "Spine2", "Neck"], fixedSlots: [2], aliases: [], movable: true,
  easeDirection: new Vector3(0, 0, 1), localEase: new Vector3(0, 0, 1) });

test("coarse cloth seed remains normalized/nonnegative at a High facet boundary and pins its original neck share", () => {
  const source = { vertices: [vertex([0, 0, 0], [.6, .35, .05]), vertex([.1, 0, 0], [.8, .15, .05]),
    vertex([0, .1, 0], [.4, .55, .05])], indices: [0, 1, 2] };
  const before = JSON.stringify(source), target = [vertex([.05, .05, 0], [.2, .7, .1])];
  const receipt = seedArmourClothWeights(target, source);
  assert.equal(receipt.seeded, 1); assert.equal(receipt.skipped, 0);
  assert.equal(target[0]!.weights[2], .1);
  assert(target[0]!.weights.every(weight => weight >= 0));
  assert(Math.abs(target[0]!.weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
  assert(Math.abs(target[0]!.weights[0]! - .6 / .95 * .9) < 1e-12);
  assert.equal(JSON.stringify(source), before);
});
