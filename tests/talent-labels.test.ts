import { describe, expect, it } from "vitest";

import { productionBlockageHint } from "../src/app/settlement/production-wait-status";
import { colonyOutcomePopup } from "../src/app/settlement-ui/colony-announcements";
import { getIslandCards, type PlannerIsland, selectPlanner } from "../src/app/settlement-ui/expedition-planner/helpers";
import { selectPlayerHud } from "../src/app/settlement-ui/player-hud/helpers";
import type { SettlementPlayerSummary, SettlementUiSnapshot } from "../src/app/settlement-ui/types";
import { SHIP_SAILING_MULTIPLIER } from "../src/shared/balance/colonies";
import type { ColonyIsland } from "../src/shared/settlement/colony-expedition-rules";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { shipTravelSeconds } from "../src/shared/settlement/ship-travel-time";

const island = { difficulty: "easy", id: 1, name: "Isle", ore: "ironOre", seed: 1, taken: false,
  voyageSeconds: 1200 } as unknown as PlannerIsland;

/** Labels read the same talent-adjusted values the rules use (owner 2026-10-20). */
describe("talent-adjusted labels", () => {
  it("shortens voyages by the talent share exactly as the fleet sails", () => {
    expect(shipTravelSeconds(1200)).toBe(1200 / SHIP_SAILING_MULTIPLIER);
    expect(shipTravelSeconds(1200, .25)).toBe(900 / SHIP_SAILING_MULTIPLIER);
  });
  it("shows the planner's sail time with the Shipping talent", () => {
    const [plain] = getIslandCards([island], null, "roman");
    const snapshot = { colonyIslands: [island], player: { talents: { shipping: 5 } } } as unknown as SettlementUiSnapshot;
    const slice = selectPlanner("colony")(snapshot);
    expect(slice.sailing).toEqual({ adventure: 0, colony: .25 });
    const [boosted] = getIslandCards([island], null, "roman", slice.sailing);
    expect(plain!.detail).not.toContain("talent");
    expect(boosted!.detail).toContain("sail (−25% talent)");
    expect(boosted!.detail).not.toBe(plain!.detail);
  });
  it("tells the conquered colony's ore-ship interval with the colony ship talent", () => {
    const colony = island as unknown as ColonyIsland;
    expect(colonyOutcomePopup("conquered", colony, "roman").message).toContain("ore ships home every hour.");
    expect(colonyOutcomePopup("conquered", colony, "roman", { oreShipReduction: .25 }).message)
      .toContain("ore ships home every 45 minutes (−25% talent).");
  });
  it("tells the settler growth interval with the settler growth talent", () => {
    const building = { construction: 1, status: "Waiting for a worker", typeId: 17 } as SettlementBuilding;
    expect(productionBlockageHint(building, "roman", 0)).toContain("every 60 seconds while");
    expect(productionBlockageHint(building, "roman", 0, false, .25)).toContain("every 48 seconds (+25% talent)");
    const player = { level: 5, quests: [], stock: {}, talents: { settlerGrowth: 5 } } as unknown as SettlementPlayerSummary;
    expect(selectPlayerHud({ player, population: 60, populationLimit: 100 })!.populationLabel)
      .toContain("a settler every 48 seconds (+25% talent)");
  });
});
