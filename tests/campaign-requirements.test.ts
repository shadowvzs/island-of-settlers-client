import { describe, expect, it } from "vitest";

import type { CampaignCargo } from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { OPERATION_BLOCK_REASONS } from "../src/shared/campaign/active-operation";
import {
  type CampaignHomeSupply, campaignRequiredLevel, campaignRequirementStatus
} from "../src/shared/campaign/campaign-requirements";
import { translateDomainText } from "../src/shared/i18n/domain";
import { expeditionHarbourFixture, islandOf } from "./helpers/colony-expedition-harbour";
import { createTestI18n } from "./helpers/render-with-i18n";

const cargoOf = (patch: Partial<CampaignCargo>): CampaignCargo => ({ goods: [], settlers: 0, soldiers: [], ...patch });
const supplyOf = (patch: Partial<CampaignHomeSupply> = {}): CampaignHomeSupply => ({
  goods: ware => ({ marble: 40, planks: 12 })[ware] ?? 0, idleShips: 2, settlers: 3,
  soldiers: { archer: 4, heavy: 0, shield: 30 }, ...patch
});
const FREE = { operation: null, playerLevel: 10 };

describe("campaign requirement status", () => {
  it("lists every cargo line with required, available and missing", () => {
    const cargo = cargoOf({ goods: [{ amount: 20, ware: "planks" }, { amount: 30, ware: "marble" }], settlers: 5,
      soldiers: [{ amount: 10, type: "shield" }, { amount: 6, type: "archer" }] });
    const status = campaignRequirementStatus({ cargo }, supplyOf(), FREE);
    expect(status.lines).toEqual([
      { available: 30, item: "shield", kind: "soldiers", missing: 0, required: 10 },
      { available: 4, item: "archer", kind: "soldiers", missing: 2, required: 6 },
      { available: 12, item: "planks", kind: "goods", missing: 8, required: 20 },
      { available: 40, item: "marble", kind: "goods", missing: 0, required: 30 },
      { available: 3, item: "settlers", kind: "settlers", missing: 2, required: 5 }
    ]);
    expect(status).toMatchObject({ idleShips: 2, levelBlock: null, operationBlock: null,
      reason: "Requires 16 eligible soldiers (14 available)" });
  });

  it("reports wares, then settlers, once the soldiers and a ship are ready", () => {
    const cargo = cargoOf({ goods: [{ amount: 20, ware: "planks" }], settlers: 5 });
    expect(campaignRequirementStatus({ cargo }, supplyOf(), FREE).reason)
      .toBe("Not enough free Softwood planks: needs 20, 12 free");
    expect(campaignRequirementStatus({ cargo: cargoOf({ settlers: 5 }) }, supplyOf(), FREE).reason)
      .toBe("Requires 5 idle settlers (3 available)");
    expect(campaignRequirementStatus({ cargo: cargoOf({ settlers: 3 }) }, supplyOf(), FREE).reason).toBeNull();
  });

  it("packs decks like a colony expedition: ships needed beside the idle ships", () => {
    const small = cargoOf({ goods: [{ amount: 10, ware: "planks" }], soldiers: [{ amount: 8, type: "shield" }] });
    expect(campaignRequirementStatus({ cargo: small }, supplyOf(), FREE).shipsNeeded).toBe(1);
    // A deck holds 16 one-slot soldiers: 20 soldiers need two decks, several trips with one idle ship.
    const large = cargoOf({ soldiers: [{ amount: 20, type: "shield" }] });
    const status = campaignRequirementStatus({ cargo: large }, supplyOf({ idleShips: 1 }), FREE);
    expect(status).toMatchObject({ idleShips: 1, reason: null, shipsNeeded: 2 });
  });

  it("puts the operation slot, the level and the harbour before the cargo", () => {
    const cargo = cargoOf({ soldiers: [{ amount: 50, type: "shield" }] });
    const operation = { id: "campaign-first-1", kind: "campaign" as const };
    expect(campaignRequirementStatus({ cargo, requiredLevel: 12 }, supplyOf(), { operation, playerLevel: 3 }))
      .toMatchObject({ levelBlock: "Unlocks at player level 12", operationBlock: OPERATION_BLOCK_REASONS.campaign,
        reason: OPERATION_BLOCK_REASONS.campaign });
    expect(campaignRequirementStatus({ cargo, requiredLevel: 12 }, supplyOf(), { operation: null, playerLevel: 3 })
      .reason).toBe("Unlocks at player level 12");
    expect(campaignRequirementStatus({ cargo }, undefined, FREE))
      .toMatchObject({ idleShips: 0, reason: "Choose a completed harbour" });
    expect(campaignRequiredLevel([{ kind: "previousMapCompleted" }, { kind: "playerLevel", level: 5 },
      { kind: "playerLevel", level: 8 }])).toBe(8);
    expect(campaignRequiredLevel([{ kind: "previousMapCompleted" }])).toBeUndefined();
  });

  it("translates its refusals", () => {
    const i18n = createTestI18n("hu");
    for (const reason of ["Requires 5 idle settlers (3 available)", "Unlocks at player level 12",
      "Not enough free Softwood planks: needs 20, 12 free"])
      expect(translateDomainText(reason, i18n)).not.toBe(reason);
  });
});

describe("campaign requirements against the real colony launch gate", () => {
  const eightShields = { cargo: cargoOf({ soldiers: [{ amount: 8, type: "shield" as const }] }) };
  type Fixture = ReturnType<typeof expeditionHarbourFixture>;
  /** The colony gate for an easy island (8 soldiers required) and the campaign check for 8 shields. */
  const bothGates = ({ harbour, simulation }: Fixture) => ({
    campaign: simulation.campaignRequirements(harbour.uid, eightShields).reason,
    colony: simulation.planColonyExpedition(harbour.uid, islandOf(simulation, "easy"), { shield: 8 }).launchReason
  });

  it("agrees when everything is ready", () => {
    const harbour = expeditionHarbourFixture();
    expect(bothGates(harbour)).toEqual({ campaign: null, colony: null });
    expect(harbour.simulation.campaignRequirements(harbour.harbour.uid, eightShields).lines[0]!.available)
      .toBe(harbour.simulation.colonyTroops(harbour.harbour.uid).shield);
  });

  it("does not count garrisoned soldiers", () => {
    const harbour = expeditionHarbourFixture();
    const shields = new Set(harbour.simulation.militarySoldiers()
      .filter(soldier => soldier.combat?.type === "shield").map(soldier => soldier.actor));
    let keptShields = 0;
    for (const actor of harbour.simulation.frames()) {
      if (actor.phase !== "militaryReserve") continue;
      if (shields.has(actor.uid) && keptShields++ < 5) continue;
      actor.phase = "garrison";
    }
    const reason = "Requires 8 eligible soldiers (5 available)";
    expect(bothGates(harbour)).toEqual({ campaign: reason, colony: reason });
  });

  it("does not count soldiers without a road route to the harbour", () => {
    const harbour = expeditionHarbourFixture({ connectHarbour: false });
    const reason = "Requires 8 eligible soldiers (0 available)";
    expect(bothGates(harbour)).toEqual({ campaign: reason, colony: reason });
  });

  it("refuses without an idle ship", () => {
    const harbour = expeditionHarbourFixture();
    const busy = harbour.simulation.saveState();
    busy.naval.fleet.ships[0]!.phase = "loading";
    expect(harbour.simulation.loadState(busy)).toEqual({ ok: true });
    const reason = "Requires an idle player-owned ship";
    expect(bothGates(harbour)).toEqual({ campaign: reason, colony: reason });
  });
});
