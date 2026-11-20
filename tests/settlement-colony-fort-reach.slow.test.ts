import { describe, expect, it, vi } from "vitest";

import { COLONY_DIFFICULTIES } from "../src/shared/balance/colonies";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { reachableCells } from "../src/shared/settlement/settlement-colony";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { colony, troops } from "./helpers/colony-simulation";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

// Split from settlement-colony.test.ts so the 12-island reach sweep runs in its own slow worker.
describe("colony islands", () => {
  it.each([1234, 77])("keeps every fort door and defender on ground the harbour reaches (seed %i)", seed => {
    for (const island of colonyIslandOffers(seed)) {
      const { simulation, world } = colony(island);
      expect(simulation.startColony({ island, landed: {}, troops: troops(1) })).toEqual({ ok: true });
      const occupied = Uint8Array.from({ length: world.cellsX * world.cellsZ }, (_, cell) =>
        Number(simulation.isOccupied(cell % world.cellsX, Math.floor(cell / world.cellsX))));
      const reachable = reachableCells({ occupied, options: { world } } as unknown as SettlementContext,
        simulation.headquarters.access);
      const forts = simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0);
      expect(forts.every(fort => reachable(fort.access))).toBe(true);
      const hostile = simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) > 0);
      const planned = COLONY_DIFFICULTIES[island.difficulty].enemyTroops;
      expect(hostile).toHaveLength(planned);
      expect(hostile.every(soldier => soldier.stationed && forts.some(fort => fort.uid === soldier.building)))
        .toBe(true);
    }
  }, 60000);
});
