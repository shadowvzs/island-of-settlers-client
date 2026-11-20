import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORLD_OPTIONS,
  generateWorld
} from "../src/shared/world/generation/generate-world";
import type { WorldData } from "../src/shared/world/world-data";

/** A different sea depth profile: every sea vertex this much deeper (the land untouched). */
const seabedChange = vi.hoisted(() => ({ depthScale: 1 }));

vi.mock("../src/shared/world/generation/seabed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/world/generation/seabed")>();
  return {
    ...actual,
    shapeSeabed: (...args: Parameters<typeof actual.shapeSeabed>) => {
      actual.shapeSeabed(...args);
      const { heights, riverMask, seaLevel } = args[2];
      for (let index = 0; index < heights.length; index += 1) {
        const depth = seaLevel - heights[index]!;
        if (depth <= 0 || riverMask[index] === 1) continue;
        heights[index] = seaLevel - depth * seabedChange.depthScale;
      }
    }
  };
});

const OPTIONS = { ...DEFAULT_WORLD_OPTIONS, cellsX: 128, cellsZ: 128, erosionDroplets: 8000 };
/**
 * Land this far (cells) from the water: closer in, the shore slope itself (smooth height
 * samples, ground material) rightly follows the seabed.
 */
const INLAND = 3;
/** Two whole islands: inherently heavy (seconds when the suite runs in parallel). */
const TWO_WORLDS_TIMEOUT = 30_000;

const generateWithSeabed = (depthScale: number) => {
  seabedChange.depthScale = depthScale;
  const world = generateWorld(OPTIONS);
  seabedChange.depthScale = 1;
  return world;
};

/** Every prop on land away from the shore, as comparable records. */
const listLandProps = (world: WorldData) => {
  const { count, form, phase, rotation, scale, types, x, y, z } = world.props;
  const stride = world.cellsX + 1;
  const records: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const vertex = Math.round(z[index]!) * stride + Math.round(x[index]!);
    if (world.coastDistance[vertex]! < INLAND) continue;
    const fields = [types[index], x[index], y[index], z[index], scale[index], rotation[index]];
    records.push([...fields, phase[index], form[index]].join(" "));
  }
  return records;
};

describe("prop placement and the seabed", () => {
  it(
    "leaves every land prop identical when only the seabed changes",
    () => {
      const shallow = generateWithSeabed(1);
      const deep = generateWithSeabed(1.6);
      const isDeeper = deep.waterDepth.some((depth, index) => depth > shallow.waterDepth[index]!);
      expect(isDeeper).toBe(true);
      const before = listLandProps(shallow);
      expect(before.length).toBeGreaterThan(500);
      expect(listLandProps(deep)).toEqual(before);
    },
    TWO_WORLDS_TIMEOUT
  );
});
