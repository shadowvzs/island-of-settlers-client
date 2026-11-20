import { describe, expect, it } from "vitest";

import type { CampaignCargo } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { expeditionHarbourFixture } from "./helpers/colony-expedition-harbour";

/** C8: the simple departure takes exactly the campaign cargo out of the home island, or nothing. */
const CARGO: CampaignCargo = {
  goods: [{ amount: 12, ware: "planks" }, { amount: 5, ware: "stone" }],
  settlers: 3,
  soldiers: [{ amount: 4, type: "shield" }, { amount: 2, type: "archer" }]
};

const homeState = ({ harbour, simulation }: ReturnType<typeof expeditionHarbourFixture>) => ({
  people: simulation.population().people,
  planks: simulation.buildings().find(building => building.uid === harbour.uid)!.inventory.planks ?? 0,
  troops: simulation.colonyTroops(harbour.uid)
});

describe("campaign departure (C8)", () => {
  it("debits the goods, soldiers and settlers once and returns the soldiers that left", () => {
    const fixture = expeditionHarbourFixture(), before = homeState(fixture);
    const result = fixture.simulation.departCampaign(fixture.harbour.uid, { cargo: CARGO });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.troops.map(troop => troop.type))
      .toEqual(["shield", "shield", "shield", "shield", "archer", "archer"]);
    const after = homeState(fixture);
    expect(before.planks - after.planks).toBe(12);
    expect(before.troops.shield - after.troops.shield).toBe(4);
    expect(before.troops.archer - after.troops.archer).toBe(2);
    expect(before.people - after.people).toBe(9);
  });

  it("refuses with the launch gate's reason and changes nothing", () => {
    const fixture = expeditionHarbourFixture(), before = homeState(fixture);
    const cargo = { ...CARGO, goods: [{ amount: 100_000, ware: "planks" }] };
    const result = fixture.simulation.departCampaign(fixture.harbour.uid, { cargo });
    expect(result).toEqual({ ok: false,
      reason: fixture.simulation.campaignRequirements(fixture.harbour.uid, { cargo }).reason });
    expect(homeState(fixture)).toEqual(before);
    expect(fixture.simulation.departCampaign(-1, { cargo: CARGO })).toEqual({ ok: false,
      reason: "Choose a completed harbour" });
  });

  it("keeps the home save loadable after the departure", () => {
    const fixture = expeditionHarbourFixture();
    expect(fixture.simulation.departCampaign(fixture.harbour.uid, { cargo: CARGO }).ok).toBe(true);
    expect(fixture.simulation.loadState(fixture.simulation.saveState())).toEqual({ ok: true });
  });
});
