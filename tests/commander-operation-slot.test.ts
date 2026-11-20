import { describe, expect, it } from "vitest";

import { translateDomainText } from "../src/shared/i18n/domain";
import {
  campaignOperationId, isCampaignOperationId, isCommanderOperationId
} from "../src/shared/settlement/commander-operation-id";
import {
  commanderMaximumHealth, type CommanderState, isCommanderState
} from "../src/shared/settlement/settlement-commander";
import { commanderManifestError } from "../src/shared/settlement/settlement-commander-transport";
import {
  claimCommanderOperation, commanderManifestOf, releaseCommanderOperation
} from "../src/shared/settlement/settlement-commander-transport-state";
import type { SettlementActor, SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { createTestI18n } from "./helpers/render-with-i18n";

const restingCommander = (): CommanderState => ({ healingSeconds: 0, homeIslandSeed: 1, homeLodgeUid: 2,
  id: "commander-1", level: 1, location: "lodge", name: "Aurelius", nation: "roman", recoverySeconds: 0, xp: 0 });
const FULL_HP = commanderMaximumHealth(1);
const lodge = { doorThreshold: { x: 4, z: 5 }, uid: 2, y: 0 } as SettlementBuilding;
const release = (state: CommanderState) =>
  releaseCommanderOperation({ actor: {} as SettlementActor, lodge, soldier: undefined }, state);

describe("commander operation slot", () => {
  it("names a campaign run operation campaign:<mapId>:<attempt>", () => {
    const id = campaignOperationId("first-landing", 3);
    expect(id).toBe("campaign:first-landing:3");
    expect(isCampaignOperationId(id)).toBe(true);
    expect(isCommanderOperationId(id)).toBe(true);
    expect(isCommanderOperationId(4)).toBe(true);
    for (const invalid of [0, -1, 1.5, "4", "campaign::1", "campaign:map:0", "campaign:map", "colony:map:1"])
      expect(isCommanderOperationId(invalid)).toBe(false);
  });

  it("refuses an expedition claim while the commander is on a campaign", () => {
    const state = restingCommander();
    expect(claimCommanderOperation(state, FULL_HP, FULL_HP, campaignOperationId("first", 1), "First landing"))
      .toEqual({ ok: true });
    expect(isCommanderState(state)).toBe(true);
    expect(claimCommanderOperation(state, FULL_HP, FULL_HP, 7, "Gull Rock"))
      .toEqual({ ok: false, reason: "Commander is already assigned to a campaign" });
    expect(state.transport?.operationId).toBe("campaign:first:1");
    expect(commanderManifestError(commanderManifestOf(state, FULL_HP))).toBeNull();
  });

  it("refuses a campaign claim while the commander is on an expedition", () => {
    const state = restingCommander();
    expect(claimCommanderOperation(state, FULL_HP, FULL_HP, 7, "Gull Rock")).toEqual({ ok: true });
    expect(claimCommanderOperation(state, FULL_HP, FULL_HP, campaignOperationId("first", 1), "First landing"))
      .toEqual({ ok: false, reason: "Commander is already assigned to an expedition" });
    expect(release(state)).toBe(true);
    expect(claimCommanderOperation(state, FULL_HP, FULL_HP, campaignOperationId("first", 1), "First landing"))
      .toEqual({ ok: true });
  });

  it("rejects a malformed operation id in a saved commander", () => {
    const state = { ...restingCommander(), operationId: "campaign:first" } as unknown as CommanderState;
    expect(isCommanderState(state)).toBe(false);
  });

  it("translates the campaign refusal", () => {
    const reason = "Commander is already assigned to a campaign";
    expect(translateDomainText(reason, createTestI18n("hu"))).not.toBe(reason);
  });
});
