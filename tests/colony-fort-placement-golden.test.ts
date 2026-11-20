import { describe, expect, it, vi } from "vitest";

import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { colony, troops } from "./helpers/colony-simulation";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

// Golden sites re-captured for terrain-seed-v8: commit 951951899 replaced the three-sine island
// indentation with the seeded coast profile and regenerated the fixed expedition islands.
const islands = colonyIslandOffers(1234);
const placement = (difficulty: "easy" | "medium" | "hard") => {
  const island = islands.find(entry => entry.difficulty === difficulty)!;
  const { simulation } = colony(island);
  expect(simulation.startColony({ island, landed: {}, troops: troops(3) })).toEqual({ ok: true });
  return simulation.buildings().filter(building => building.militaryFaction === 1)
    .map(building => [building.typeId, building.x, building.z, building.rotation]);
};

describe("colony fort placement", () => {
  it("keeps the exact fort sites for the fixed easy island", () => {
    expect(placement("easy")).toEqual([
      [9, 86, 4, 3], [2, 88, 20.5, 3], [2, 72, 2, 0]
    ]);
  }, 60_000);

  it("keeps the exact fort sites for the fixed medium island", () => {
    expect(placement("medium")).toEqual([
      [9, 36, 76, 2], [9, 26, 66, 1], [2, 76, 64.5, 3], [2, 18, 42, 1], [2, 48.5, 66.5, 2]
    ]);
  }, 60_000);

  it("keeps the exact fort sites for the fixed hard island", () => {
    expect(placement("hard")).toEqual([
      [9, 22, 60, 1], [4, 34.5, 28.5, 0], [4, 48, 18, 0], [4, 54, 32.5, 0],
      [2, 34.5, 70, 2], [2, 54, 76, 2], [9, 68, 36, 3]
    ]);
  }, 60_000);
});
