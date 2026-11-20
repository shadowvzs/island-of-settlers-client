import { describe, expect, it, vi } from "vitest";

import { DEVELOPMENT_ONLY_MESSAGE } from "../src/app/development-access";
import { createSettlementDebugActions } from "../src/app/settlement/settlement-debug-actions";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";

describe("settlement debug actions", () => {
  it("refuses every state-changing action when the account may not use Development tools", () => {
    const grantCoins = vi.fn();
    const grantDebugTroop = vi.fn();
    const resetCarriers = vi.fn();
    const startDebugExpedition = vi.fn();
    const message = vi.fn();
    const simulation = { buildings: () => [], colony: () => undefined, grantCoins, grantDebugTroop,
      resetCarriers, startDebugExpedition } as unknown as SettlementSimulation;
    const actions = createSettlementDebugActions({ allowed: false, buildingName: () => "building",
      completed: new Set(), message, simulation, updateUi: () => undefined });

    actions.addDebugLevels();
    actions.buildEveryBuilding();
    actions.fillAllOutputs();
    actions.grantCoins(2000);
    actions.grantDebugTroop();
    actions.grantGems(500);
    actions.grantHandcarts(1);
    actions.resetCarriers();
    actions.startDebugExpedition("colony");

    expect(grantCoins).not.toHaveBeenCalled();
    expect(grantDebugTroop).not.toHaveBeenCalled();
    expect(resetCarriers).not.toHaveBeenCalled();
    expect(startDebugExpedition).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalledTimes(9);
    expect(message).toHaveBeenCalledWith(DEVELOPMENT_ONLY_MESSAGE, true);
  });
});
