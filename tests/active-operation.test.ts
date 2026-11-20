import { describe, expect, it, vi } from "vitest";

import { createSettlementCommandActions } from "../src/app/settlement/settlement-ui-actions";
import { selectPlanner } from "../src/app/settlement-ui/expedition-planner/helpers";
import type { SettlementUiSnapshot } from "../src/app/settlement-ui/types";
import {
  activeOperation, type ActiveOperationKind, colonyContested, OPERATION_BLOCK_REASONS, type OperationArchipelago,
  operationBlockReason, type OperationExpedition
} from "../src/shared/campaign/active-operation";
import { campaignRequirementStatus } from "../src/shared/campaign/campaign-requirements";
import { translateDomainText } from "../src/shared/i18n/domain";
import type { ColonyRecord } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createColonyPlanning } from "../src/shared/settlement/settlement-colony-planning";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { createTestI18n } from "./helpers/render-with-i18n";

const colonyIsland = { difficulty: "easy", id: 3, name: "Gull Rock", ore: "coal", seed: 7, voyageSeconds: 90 };
const adventureIsland = { ...colonyIsland, id: 4, kind: "adventure" };
const expedition = (id: number, status: string, island: unknown = colonyIsland): OperationExpedition =>
  ({ id, island, status });
const archipelago = (patch: Partial<OperationArchipelago> = {}): OperationArchipelago =>
  ({ active: null, colonies: [], ...patch });

/** A filed colony save: its colony status and the enemy soldiers' hit points. */
const filedSave = (status: string, enemyHp: number[]) => ({
  settlement: {
    colony: { status },
    military: { soldiers: [{ combat: { faction: 0, hp: 9 } },
      ...enemyHp.map(hp => ({ combat: { faction: 1, hp } }))] }
  }
}) as unknown as GameSaveV1;
const colonyRecord = (status: ColonyRecord["status"], save?: GameSaveV1): ColonyRecord =>
  ({ expeditionId: 3, island: colonyIsland, status, ...(save ? { save } : {}) } as unknown as ColonyRecord);
const campaign = { attempt: 2, campaignId: "isles", mapId: "first" };
const EIGHT_SHIELDS = { archer: 0, cavalry: 0, heavy: 0, shield: 8 };

describe("the shared operation slot", () => {
  it("names the campaign run first, then an expedition under way, an adventure and a contested colony", () => {
    const busy = [expedition(1, "sailing"), expedition(2, "arrived", adventureIsland)];
    expect(activeOperation(busy, archipelago({ campaign }))).toEqual({ id: "campaign-first-2", kind: "campaign" });
    expect(activeOperation(busy)).toEqual({ id: 1, kind: "expedition" });
    expect(activeOperation([expedition(2, "arrived", adventureIsland)])).toEqual({ id: 2, kind: "adventure" });
    const adventures = [{ expeditionId: 5, island: adventureIsland, status: "contested" }] as never;
    expect(activeOperation([], archipelago({ adventures }))).toEqual({ id: 5, kind: "adventure" });
    expect(activeOperation([], archipelago({ colonies: [colonyRecord("landed")] })))
      .toEqual({ id: 3, kind: "contestedColony" });
    expect(activeOperation([], archipelago())).toBeNull();
  });

  it("never blocks on a conquered or lost colony, a released expedition or an unknown landing", () => {
    expect(activeOperation([], archipelago({ colonies: [colonyRecord("conquered"), colonyRecord("defeated")] })))
      .toBeNull();
    expect(activeOperation([expedition(2, "arrived", adventureIsland)], archipelago({ released: [2] }))).toBeNull();
    // The simulation's own gate cannot see a colony's battle: only the session's archipelago can.
    expect(activeOperation([expedition(3, "arrived")])).toBeNull();
    expect(activeOperation([expedition(6, "arrived")], archipelago()))
      .toEqual({ id: 6, kind: "contestedColony" });
  });

  it("reads 'contested' from the filed save, not the stale record status (R29)", () => {
    const fighting = filedSave("contested", [0, 4]);
    expect(colonyContested(colonyRecord("contested", fighting), null)).toBe(true);
    expect(colonyContested(colonyRecord("contested", filedSave("contested", [0, 0])), null)).toBe(false);
    expect(colonyContested(colonyRecord("contested", filedSave("conquered", [])), null)).toBe(false);
    // The filed save wins over a stale record in both directions.
    expect(colonyContested(colonyRecord("conquered", fighting), null)).toBe(true);
    // The colony on screen keeps its live, synced record.
    expect(colonyContested(colonyRecord("conquered", fighting), 3)).toBe(false);
    expect(colonyContested(colonyRecord("contested", fighting), 3)).toBe(true);
  });

  it("answers once per filed save object (cached per save revision)", () => {
    const save = filedSave("contested", [3]);
    expect(colonyContested(colonyRecord("contested", save), null)).toBe(true);
    (save.settlement.military!.soldiers[1]!.combat as { hp: number }).hp = 0;
    expect(colonyContested(colonyRecord("contested", save), null)).toBe(true);
    expect(colonyContested(colonyRecord("contested", { ...save }), null)).toBe(false);
  });
});

describe("every pair of colony, adventure and campaign launches is exclusive", () => {
  const holders: Record<ActiveOperationKind, () => ReturnType<typeof activeOperation>> = {
    adventure: () => activeOperation([expedition(2, "arrived", adventureIsland)], archipelago()),
    campaign: () => activeOperation([], archipelago({ campaign })),
    contestedColony: () => activeOperation([], archipelago({ colonies: [colonyRecord("landed")] })),
    expedition: () => activeOperation([expedition(1, "preparing")], archipelago())
  };
  const commandActions = (operationBlock: () => string | null) => {
    const simulation = {
      startAdventureExpedition: vi.fn(() => ({ id: 9, ok: true })),
      startColonyExpedition: vi.fn(() => ({ id: 9, ok: true }))
    };
    const actions = createSettlementCommandActions({ message: vi.fn(), onBuildingDemolished: vi.fn(), operationBlock,
      simulation: simulation as unknown as SettlementSimulation, updateUi: vi.fn() });
    return { actions, simulation };
  };

  it.each(Object.keys(holders) as ActiveOperationKind[])("refuses all three launches while %s holds the slot", kind => {
    const reason = operationBlockReason(holders[kind]());
    expect(reason).toBe(OPERATION_BLOCK_REASONS[kind]);
    const { actions, simulation } = commandActions(() => reason);
    expect(actions.onStartColony!(1, 3, EIGHT_SHIELDS)).toBe(reason);
    expect(actions.onStartAdventure!(1, 4, EIGHT_SHIELDS)).toBe(reason);
    expect(simulation.startColonyExpedition).not.toHaveBeenCalled();
    expect(simulation.startAdventureExpedition).not.toHaveBeenCalled();
    const cargo = { goods: [], settlers: 0, soldiers: [] };
    const status = campaignRequirementStatus({ cargo }, undefined, { operation: holders[kind](), playerLevel: 1 });
    expect(status).toMatchObject({ operationBlock: reason, reason });
  });

  it("lets a launch through to the recorded command while the slot is free", () => {
    const { actions, simulation } = commandActions(() => null);
    expect(actions.onStartColony!(1, 3, EIGHT_SHIELDS)).toBe(true);
    expect(simulation.startColonyExpedition).toHaveBeenCalledOnce();
  });

  it("puts the simulation's own slot check first in the colony and adventure launch gate", () => {
    const harbour = { uid: 1 } as SettlementBuilding;
    const planning = createColonyPlanning({ availableTroops: () => ({ archer: 0, cavalry: 0, heavy: 0, shield: 0 }),
      context: {} as SettlementContext, freeShips: () => 1, harbourOf: () => harbour,
      operation: () => ({ id: 2, kind: "adventure" }), talentVoyage: () => 90 });
    expect(planning.launchReason(1, colonyIsland as never, EIGHT_SHIELDS))
      .toBe("Finish the current adventure first");
  });

  it("shows the archipelago half of the slot in both planners", () => {
    const snapshot: SettlementUiSnapshot = { operationBlock: OPERATION_BLOCK_REASONS.contestedColony };
    expect(selectPlanner("colony")(snapshot).blocked).toBe(OPERATION_BLOCK_REASONS.contestedColony);
    expect(selectPlanner("adventure")(snapshot).blocked).toBe(OPERATION_BLOCK_REASONS.contestedColony);
    expect(selectPlanner("colony")({}).blocked).toBeNull();
  });

  it.each(Object.values(OPERATION_BLOCK_REASONS))("translates the reason: %s", reason => {
    const i18n = createTestI18n("hu");
    expect(translateDomainText(reason, i18n)).not.toBe(reason);
  });
});
