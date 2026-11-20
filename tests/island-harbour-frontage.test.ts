import { expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../src/shared/world/generation/generate-world";

// 2026-10-19: the smooth southern harbour frontage of large islands never met the harbour shore rule,
// so validation depended on random coves (512² similar sizes failed all three attempts). 192² with one
// island (radius 74) is the smallest map that needed a retry; the frontage itself must now hold the harbour.
it("validates the harbour on a large island's frontage on the first attempt", () => {
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 192, cellsZ: 192, erosionDroplets: 100,
    islandCount: 1, landform: "archipelago", rivers: 0, seed: 1234 });
  const site = world.playableIslands!.sites[0]!;
  expect(world.seed).toBe(1234);
  expect(site.radius).toBeGreaterThan(70);
  expect(site.harbour.x).toBe(site.x);
}, 20000);
