import { expect, it } from "vitest";

import { clearAdventureDeposits } from "../src/shared/world/generation/adventure-deposits";
import { generateAdventureWorld } from "../src/shared/world/generation/colony-world";
import { applyExpeditionWorldTheme } from "../src/shared/world/generation/expedition-world-themes";
import { MATERIAL, MATERIAL_COUNT, NO_MINE_ZONE, PROP } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

it("ties every desert green patch and palm to a fresh lake, without flooding protected land", () => {
  const world = huntingWorld(); clearAdventureDeposits(world);
  const original = world.heights.slice();
  applyExpeditionWorldTheme(world, "desert", "colony", { contains: (x, z) => x > 45 || z > 45 });
  const water: { x: number; z: number }[] = [];
  for (let vertex = 0; vertex < world.heights.length; vertex++) {
    if (world.waterDepth[vertex]! > .03 && world.waterSurface[vertex]! > world.seaLevel + .3)
      water.push({ x: vertex % 65, z: Math.floor(vertex / 65) });
    if (vertex % 65 > 45 || Math.floor(vertex / 65) > 45) expect(world.heights[vertex]).toBe(original[vertex]);
  }
  expect(water.length).toBeGreaterThan(10);
  const distance = (x: number, z: number) => Math.min(...water.map(p => Math.hypot(x - p.x, z - p.z)));
  for (let vertex = 0; vertex < world.heights.length; vertex++) {
    if (world.splat[vertex * MATERIAL_COUNT + MATERIAL.grass]! > 0)
      expect(distance(vertex % 65, Math.floor(vertex / 65))).toBeLessThan(3.5);
  }
  let palms = 0;
  for (let prop = 0; prop < world.props.count; prop++) if (world.props.types[prop] === PROP.palmTree) {
    palms++; expect(distance(world.props.x[prop]!, world.props.z[prop]!)).toBeLessThanOrEqual(3.5);
  }
  expect(palms).toBeGreaterThanOrEqual(15);
});

it("new adventures have neither deposits nor painted mine areas", () => {
  const world = generateAdventureWorld({ seed: 1234, size: 96, theme: "desert" });
  expect(world.mineZones).toEqual([]);
  expect(world.mineZone.every(zone => zone === NO_MINE_ZONE)).toBe(true);
  expect(world.oreAmount.every(amount => amount === 0)).toBe(true);
  for (let vertex = 0; vertex < world.heights.length; vertex++)
    expect(world.splat[vertex * MATERIAL_COUNT + MATERIAL.mine]).toBe(0);
});
