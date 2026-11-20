import { describe, expect, it } from "vitest";

import { adventureOffers } from "../src/shared/settlement/adventure-rules";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import {
  expeditionReadinessReason, expeditionRequiredSoldiers, isIdleExpeditionShip
} from "../src/shared/settlement/expedition-launch-rules";

describe("target-based expedition readiness", () => {
  it("uses canonical defender rosters for each target and fits existing difficulty caps", () => {
    for (const [offers, counts] of [[colonyIslandOffers(1234), [8, 14, 21]],
      [adventureOffers(1234), [8, 15, 26]]] as const) {
      for (const [index, difficulty] of ["easy", "medium", "hard"].entries()) {
        const island = offers.find(entry => entry.difficulty === difficulty)!;
        expect(expeditionRequiredSoldiers(island)).toBe(counts[index]);
      }
    }
  });
  it("rejects foreign, working, assigned, occupied and loaded vessels", () => {
    const idle = { cargo: {}, passengers: 0, phase: "idle", visitor: false };
    expect(isIdleExpeditionShip(idle)).toBe(true);
    for (const patch of [{ visitor: true }, { phase: "away" }, { phase: "loading" },
      { phase: "sailing" }, { orderId: 9 }, { passengers: 1 }, { cargo: { wood: 1 } }])
      expect(isIdleExpeditionShip({ ...idle, ...patch })).toBe(false);
  });
  it("explains missing crew, ship or both without counting selected force as available", () => {
    expect(expeditionReadinessReason(8, { shield: 8 }, 1)).toBeNull();
    expect(expeditionReadinessReason(8, { shield: 7 }, 1)).toBe("Requires 8 eligible soldiers (7 available)");
    expect(expeditionReadinessReason(8, { shield: 8 }, 0)).toBe("Requires an idle player-owned ship");
    expect(expeditionReadinessReason(8, {}, 0)).toContain("0 available); Requires an idle");
  });
});

import { getPlannerButtons } from "../src/app/settlement-ui/building-details/harbour-helpers";

it("disables the whole harbor option with target-specific combined shortage tooltips", () => {
  const offers = colonyIslandOffers(1234).map(island => ({ ...island, taken: false }));
  const data = { colonyIslands: offers, adventureIslands: adventureOffers(1234),
    colonyTroops: { archer: 0, cavalry: 0, heavy: 0, shield: 7 }, idleExpeditionShips: 0, level: 1 };
  expect(getPlannerButtons(false, true, true, data)).toMatchObject({
    adventureDisabled: true, colonyDisabled: true,
    colonyTitle: "Requires 8 eligible soldiers (7 available); Requires an idle player-owned ship"
  });
  expect(getPlannerButtons(false, true, true, {
    ...data, colonyTroops: { ...data.colonyTroops, shield: 8 }, idleExpeditionShips: 1
  })).toMatchObject({ adventureDisabled: false, colonyDisabled: false });
  const hardOnly = { ...data, colonyIslands: offers.filter(island => island.difficulty === "hard") };
  expect(getPlannerButtons(false, true, true, hardOnly).colonyTitle).toContain("Requires 21 eligible soldiers");
});
