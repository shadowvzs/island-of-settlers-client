import { describe, expect, it, vi } from "vitest";

import { ADVENTURE_THEMES } from "../src/shared/settlement/adventure-themes";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { doorAngleTo, islandCentre } from "../src/shared/settlement/enemy-building-facing";
import { reachableCells } from "../src/shared/settlement/settlement-colony";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { colony, troops } from "./helpers/colony-simulation";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const cases = DIFFICULTIES.flatMap(difficulty => ADVENTURE_THEMES.map(theme => [difficulty, theme] as const));

/** Owner 2026-10-22: every enemy front (door side) faces the colony island's centre. */
describe("colony enemy buildings", () => {
  it.each(cases)("%s %s: fronts face the island centre with reachable approaches", (difficulty, theme) => {
    const offer = colonyIslandOffers(1234).find(entry => entry.difficulty === difficulty)!;
    const island = { ...offer, theme };
    const { simulation, world } = colony(island);
    expect(simulation.startColony({ island, landed: {}, troops: troops(1) })).toEqual({ ok: true });
    const centre = islandCentre(world);
    const forts = simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0);
    expect(forts.length).toBeGreaterThan(0);
    for (const fort of forts) {
      // Candidates are chosen on whole grid points; an odd side shifts the plot half a cell.
      const slack = Math.atan(.75 / Math.hypot(centre.x - fort.x, centre.z - fort.z));
      expect(doorAngleTo(fort.rotation, fort, centre)).toBeLessThanOrEqual(Math.PI / 4 + slack);
    }
    const occupied = Uint8Array.from({ length: world.cellsX * world.cellsZ }, (_, cell) =>
      Number(simulation.isOccupied(cell % world.cellsX, Math.floor(cell / world.cellsX))));
    const reachable = reachableCells({ occupied, options: { world } } as unknown as SettlementContext,
      simulation.headquarters.access);
    expect(forts.every(fort => reachable(fort.access))).toBe(true);
  }, 60000);
});
