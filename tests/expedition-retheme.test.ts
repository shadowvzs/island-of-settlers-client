import { expect, it } from "vitest";

import { rethemeExpedition } from "../src/app/settlement/expedition-retheme";
import { stageGameSession } from "../src/app/settlement/game-session";
import { adventureOffers } from "../src/shared/settlement/adventure-rules";
import { chooseAdventureWorld } from "../src/shared/settlement/colony-world-choice";
import { createGameSave } from "../src/shared/settlement/game-save";
import { discoverIslandClimate, islandDiscoveryError } from "../src/shared/settlement/island-discovery-policy";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";

it("restyles a building-free adventure without losing its units or discovery metadata", async () => {
  const island = { ...adventureOffers(1234)[0]!, difficulty: "easy" as const,
    ...discoverIslandClimate(1234, 90, { month: 7, timeZone: "UTC" }, { theme: "desert" }) };
  const world = chooseAdventureWorld(island), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, homeBuilding: null,
    initialSettlers: 0, initialStock: {} });
  expect(simulation.startAdventure({ island, troops: [{ type: "shield", rank: 0, hp: 100 }] }).ok).toBe(true);
  const source = await createGameSave(world, simulation.saveState(), {
    name: "Theme regression", source: "generated", savedAt: 1_000_000, animals: [] });
  const result = await rethemeExpedition(source, "winter");
  const loaded = await stageGameSession(result);
  expect(loaded.settlement.adventure?.island.theme).toBe("winter");
  expect(islandDiscoveryError(loaded.settlement.adventure!.island)).toBeNull();
  expect(loaded.settlement.actors).toEqual(source.settlement.actors);
  expect(loaded.settlement.military).toEqual(source.settlement.military);
  expect(loaded.settlement.adventure?.status).toBe("contested");
  expect(source.settlement.adventure?.island.theme).toBe("desert");
}, 30000);
