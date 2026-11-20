import { describe, expect, it } from "vitest";

import type { RockTerrain } from "../src/render-common/rocks/rock-terrain";
import {
  buildDepositClusterMesh, depositSizeState, STONE_DEPOSIT_TINTS
} from "../src/render-common/rocks/stone-deposit-cluster";
import type { ColonyStone } from "../src/shared/world/colony-resource-tiers";

const flat: RockTerrain = {
  cellsX: 64, cellsZ: 64, height: () => 0, moisture: () => 0.3, mountain: () => 0, visibility: () => 1
};
const extent = (positions: Float32Array) => {
  let reach = 0;
  for (let at = 0; at < positions.length; at += 3)
    reach = Math.max(reach, Math.hypot(positions[at]! - 10, positions[at + 2]! - 10));
  return reach;
};

describe("stone material deposits as boulder clusters", () => {
  it("reads the amount from the cluster size: full, worked, nearly exhausted", () => {
    expect([48, 30, 10, 1].map(depositSizeState)).toEqual([0, 1, 2, 2]);
    const sizes = [48, 30, 10].map(remaining =>
      extent(buildDepositClusterMesh({ id: 1, remaining, x: 10, z: 10 }, 7, flat, false).positions));
    for (let state = 1; state < sizes.length; state++) expect(sizes[state]).toBeLessThan(sizes[state - 1]!);
  });

  it("is deterministic per deposit and cheaper on Minimal", () => {
    const deposit = { id: 2, remaining: 48, x: 10, z: 10 };
    const high = buildDepositClusterMesh(deposit, 7, flat, false);
    expect(buildDepositClusterMesh(deposit, 7, flat, false).positions).toEqual(high.positions);
    expect(buildDepositClusterMesh(deposit, 7, flat, true).triangles).toBeLessThan(high.triangles);
  });
});

const STONES: readonly ColonyStone[] = ["basalt", "granite", "limestone", "marble"];
const luminance = ([red, green, blue]: readonly [number, number, number]) =>
  0.299 * red + 0.587 * green + 0.114 * blue;
const distance = (left: readonly [number, number, number], right: readonly [number, number, number]) =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);

describe("stone deposit material palettes", () => {
  it("steps from dark basalt to bright marble so the materials read apart at a distance", () => {
    const values = STONES.map(stone => luminance(STONE_DEPOSIT_TINTS[stone]));
    for (let index = 1; index < values.length; index++) expect(values[index]).toBeGreaterThan(values[index - 1]!);
    expect(values[3]! - values[2]!).toBeGreaterThan(0.1);
  });

  it("keeps each material's hue identity", () => {
    const [basaltRed, basaltGreen, basaltBlue] = STONE_DEPOSIT_TINTS.basalt;
    expect(basaltBlue).toBeGreaterThan(basaltGreen);
    expect(basaltGreen).toBeGreaterThan(basaltRed);
    const [graniteRed, graniteGreen, graniteBlue] = STONE_DEPOSIT_TINTS.granite;
    expect(graniteRed).toBeGreaterThan(graniteBlue);
    expect(graniteBlue).toBeGreaterThan(graniteGreen);
    const [limestoneRed, limestoneGreen, limestoneBlue] = STONE_DEPOSIT_TINTS.limestone;
    expect(limestoneRed).toBeGreaterThan(limestoneGreen);
    expect(limestoneGreen).toBeGreaterThan(limestoneBlue);
    expect(limestoneRed - limestoneBlue).toBeGreaterThan(graniteRed - graniteBlue + 0.15);
    const [marbleRed, marbleGreen, marbleBlue] = STONE_DEPOSIT_TINTS.marble;
    expect(marbleBlue).toBeGreaterThan(marbleGreen);
    expect(marbleGreen).toBeGreaterThan(marbleRed);
    expect(luminance(STONE_DEPOSIT_TINTS.marble)).toBeGreaterThan(0.85);
  });

  it("keeps every pair of materials clearly apart", () => {
    for (let left = 0; left < STONES.length; left++) {
      for (let right = left + 1; right < STONES.length; right++) {
        expect(distance(STONE_DEPOSIT_TINTS[STONES[left]!], STONE_DEPOSIT_TINTS[STONES[right]!]))
          .toBeGreaterThan(0.22);
      }
    }
  });
});
