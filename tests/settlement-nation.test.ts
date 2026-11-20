import { describe, expect, it } from "vitest";

import { NATIONS } from "../../island-of-settlers-shared/src/nations";
import { WORKER_NATIONS } from "../src/render-common/workers/worker-appearance";
import { enemyNationFor } from "../src/shared/settlement/enemy-nation";
import { nationProductionShare } from "../src/shared/settlement/nation-bonuses";
import { buildingNation, nationOf } from "../src/shared/settlement/settlement-nation";
import { productionTalentBonus } from "../src/shared/settlement/settlement-talents";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { workshopCycleFactor } from "../src/shared/settlement/workshop-upgrades";
import { economyScenario } from "./helpers/economy-factions";

const SEED = 4242;
const island = (economyFactions?: readonly number[]) => ({
  options: { world: { scenario: economyScenario(economyFactions), seed: SEED } },
  playerNation: "viking",
  talents: { productionSpeed: 0.2 }
}) as unknown as SettlementContext;

/** EAI1c step c1: rules follow the nation of the building owner's economy. */
describe("settlement nation by owner", () => {
  it("keeps the enemy nation list equal to the worker roster (the simulation reads the shared list)", () => {
    expect(WORKER_NATIONS).toEqual(NATIONS);
  });

  it("gives the player and every faction without an economy the player's nation", () => {
    const context = island();
    expect(nationOf(context, 0)).toBe("viking");
    expect(nationOf(context, 2)).toBe("viking");
    expect(buildingNation(context, { militaryFaction: 2 })).toBe("viking");
    expect(nationOf({ playerNation: "roman" }, 2)).toBe("roman");
  });

  it("gives a computer economy the island's enemy nation", () => {
    const context = island([2]);
    const enemy = enemyNationFor("viking", SEED);
    expect(enemy).not.toBe("viking");
    expect(nationOf(context, 2)).toBe(enemy);
    expect(buildingNation(context, { militaryFaction: 2 })).toBe(enemy);
    expect(buildingNation(context, {})).toBe("viking");
    context.playerNation = enemy;
    expect(nationOf(context, 2)).toBe(enemyNationFor(enemy, SEED));
  });

  it("gives a computer economy neutral talents and its own nation share", () => {
    const context = island([2]);
    const typeId = 3;
    expect(productionTalentBonus(context, typeId)).toBeCloseTo(0.2 + nationProductionShare("viking", typeId));
    expect(productionTalentBonus(context, typeId, 2))
      .toBeCloseTo(nationProductionShare(enemyNationFor("viking", SEED), typeId));
  });

  it("applies work-speed rules to a computer economy's building but keeps hostile sites neutral", () => {
    const woodcutter = { militaryFaction: 2, typeId: 3 };
    expect(workshopCycleFactor(woodcutter, 0.5)).toBe(1);
    expect(workshopCycleFactor(woodcutter, 0.5, island())).toBe(1);
    expect(workshopCycleFactor(woodcutter, 0.5, island([2]))).toBe(1.5);
  });
});
