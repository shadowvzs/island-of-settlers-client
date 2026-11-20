import { describe, expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { createMineStones } from "../src/render-common/rocks/mine-stones";
import { ROCK_ROLE } from "../src/render-common/rocks/rock-instances";
import { packTintByte } from "../src/render-common/rocks/rock-mesh";
import { createWorldRockTerrain } from "../src/render-common/rocks/rock-terrain";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { NO_MINE_ZONE, ORE } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const SMALL = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000 };

/** The shader's decode of the packed tint byte (rock-glsl.ts). */
const decode = (byte: number) => {
  const detailed = byte >= 128;
  const stoneByte = byte - 128;
  return detailed
    ? { detailed, ore: Math.floor(stoneByte / 16), tint: (stoneByte % 16) / 15 }
    : { detailed, ore: 0, tint: byte / 127 };
};

describe("packTintByte", () => {
  it("keeps the 7 bit tint of plain rock and packs ore + tint of detailed stones", () => {
    expect(decode(packTintByte(0.5, false)).tint).toBeCloseTo(0.5, 1);
    const stone = decode(packTintByte(1, true, ORE.gold));
    expect(stone).toEqual({ detailed: true, ore: ORE.gold, tint: 1 });
    expect(decode(packTintByte(0, true)).ore).toBe(ORE.none);
  });
});

describe("createMineStones", () => {
  const world = cachedWorld(SMALL);
  const terrain = createWorldRockTerrain(world, createVertexFog(world));
  const cellOf = (x: number, z: number) => Math.floor(z) * world.cellsX + Math.floor(x);

  it("scatters chips over the mine fields only, no ore stones before a survey", () => {
    const stones = createMineStones(world, { seed: world.seed, terrain });
    expect(stones.length).toBeGreaterThan(0);
    for (const { centre, ore, role } of stones) {
      expect(world.mineZone[cellOf(centre[0], centre[2])]).not.toBe(NO_MINE_ZONE);
      expect(role).toBe(ROCK_ROLE.pebble);
      expect(ore ?? ORE.none).toBe(ORE.none);
    }
  });

  it("leaves surveyed fields free of oversized decorative boulders", () => {
    const surveyed = { ...world, mineZones: world.mineZones.map(zone => ({ ...zone, surveyed: true })) };
    const stones = createMineStones(surveyed, { seed: world.seed, terrain });
    expect(stones).toEqual(createMineStones(world, { seed: world.seed, terrain }));
    expect(stones.every(stone => stone.role === ROCK_ROLE.pebble && !stone.ore)).toBe(true);
  });
});
