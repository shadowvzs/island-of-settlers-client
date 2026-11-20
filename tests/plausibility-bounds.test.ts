import { createEconomyCatalog } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { SAWMILL_TYPE_ID, WOODCUTTER_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { checkPlausibility, playerHoldings, productionRates } from "../src/shared/settlement/plausibility-bounds";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";

const building = (typeId: number, inventory: Record<string, number>, extra = {}) =>
  ({ construction: 1, input: {}, inventory, output: {}, typeId, ...extra });

/** A home island with its headquarters stock and two woodcutters. */
const island = (savedAt: number, logs: number, coins = 0) => ({
  player: undefined, savedAt,
  settlement: { actors: [{ ware: "logs", wareUnits: 2 }], buildings: [building(0, { coins, logs }),
    building(WOODCUTTER_TYPE_ID, {}), building(WOODCUTTER_TYPE_ID, {}),
    building(0, { logs: 999 }, { militaryFaction: 1 })], naval: { ships: [{ cargo: { logs: 3 } }] },
    transfers: [] }
}) as unknown as GameSaveV1;

describe("production plausibility bounds (D4.5)", () => {
  it("counts the player's goods everywhere but hostile buildings", () => {
    expect(playerHoldings(island(0, 10)).logs).toBe(10 + 2 + 3);
    expect(productionRates(island(0, 10)).logs).toBeGreaterThan(0);
  });

  it("leaves a campaign run on screen out of the holdings; its filed home still counts", () => {
    const run = { ...island(0, 500), campaignRun: { mapId: "bay" },
      archipelago: { colonies: [], home: island(0, 10) } } as unknown as GameSaveV1;
    expect(playerHoldings(run).logs).toBe(10 + 2 + 3);
  });

  it("accepts growth within the woodcutters' capacity and flags more", () => {
    const hour = 3_600_000, rate = productionRates(island(0, 10)).logs!;
    const possible = Math.floor(rate * 3600);
    expect(checkPlausibility({ after: island(hour, 10 + possible), before: island(0, 10), credits: {},
      realSeconds: 3600 })).toEqual({ seconds: 3600, violations: [] });
    const forged = checkPlausibility({ after: island(hour, 10 + possible * 3 + 500), before: island(0, 10),
      credits: {}, realSeconds: 3600 });
    expect(forged.violations.map(violation => violation.ware)).toEqual(["logs"]);
  });

  it("bounds time by the server's clock and counts ledger credits", () => {
    const day = 86_400_000;
    // The client claims a day passed; the server saw one minute.
    expect(checkPlausibility({ after: island(day, 10 + 10_000), before: island(0, 10), credits: {},
      realSeconds: 60 }).violations).toHaveLength(1);
    expect(checkPlausibility({ after: island(60_000, 10, 500), before: island(0, 10), credits: {},
      realSeconds: 60 }).violations.map(violation => violation.ware)).toEqual(["coins"]);
    expect(checkPlausibility({ after: island(60_000, 10, 500), before: island(0, 10), credits: { coins: 500 },
      realSeconds: 60 }).violations).toEqual([]);
  });

  it("flags unrecorded adventure loot; the ledger's loot credit allows it", () => {
    const loot = createEconomyCatalog().adventureLoot.medium.coins;
    const won = { after: island(60_000, 10, loot), before: island(0, 10), realSeconds: 60 };
    expect(checkPlausibility({ ...won, credits: {} }).violations.map(violation => violation.ware)).toEqual(["coins"]);
    expect(checkPlausibility({ ...won, credits: { coins: loot } }).violations).toEqual([]);
  });

  it("bounds a single-output chain by the inputs it could have received", () => {
    const hour = 3_600_000;
    const withSawmill = (savedAt: number, logs: number, planks: number) => ({
      ...island(savedAt, logs), savedAt,
      settlement: { ...island(savedAt, logs).settlement, buildings: [building(0, { logs }),
        building(SAWMILL_TYPE_ID, {}), building(SAWMILL_TYPE_ID, { planks })] }
    }) as unknown as GameSaveV1;
    expect(checkPlausibility({ after: withSawmill(hour, 0, 500), before: withSawmill(0, 0, 0), credits: {},
      realSeconds: 3600 }).violations.map(violation => violation.ware)).toContain("planks");
    expect(checkPlausibility({ after: withSawmill(hour, 1_000, 100), before: withSawmill(0, 1_000, 0),
      credits: {}, realSeconds: 3600 }).violations).toEqual([]);
  });

  it("caps logs at the trees the decoded maps lost, per species", () => {
    const hour = 3_600_000;
    const withoutTrees = checkPlausibility({ after: island(hour, 100), before: island(0, 0), credits: {},
      realSeconds: 3600, resources: { felledTrees: { logs: 0 }, minedOre: {} } });
    expect(withoutTrees.violations.map(violation => violation.ware)).toEqual(["logs"]);
    expect(checkPlausibility({ after: island(hour, 100), before: island(0, 0), credits: {}, realSeconds: 3600,
      resources: { felledTrees: { logs: 100 }, minedOre: {} } }).violations).toEqual([]);
    // A specialist tree makes its own logs, never ordinary ones.
    expect(checkPlausibility({ after: island(hour, 100), before: island(0, 0), credits: {}, realSeconds: 3600,
      resources: { felledTrees: { hardwoodLogs: 100 }, minedOre: {} } }).violations
      .map(violation => violation.ware)).toEqual(["logs"]);
  });

  it("caps ore at the surveyed mine decrease and credits colony shipments", () => {
    const hour = 3_600_000;
    const coalIsland = (savedAt: number, coal: number) => ({
      ...island(savedAt, 10),
      settlement: { actors: [], buildings: [building(11, { coal })], naval: { ships: [] } }
    }) as unknown as GameSaveV1;
    const forged = checkPlausibility({ after: coalIsland(hour, 200), before: coalIsland(0, 0), credits: {},
      realSeconds: 3600, resources: { felledTrees: {}, minedOre: { coal: 0 } } });
    expect(forged.violations.map(violation => violation.ware)).toEqual(["coal"]);
    expect(checkPlausibility({ after: coalIsland(hour, 200), before: coalIsland(0, 0), credits: {},
      realSeconds: 3600, resources: { felledTrees: {}, minedOre: { coal: 200 } } }).violations).toEqual([]);
    expect(checkPlausibility({ after: coalIsland(hour, 200), before: coalIsland(0, 0), credits: {},
      realSeconds: 3600, resources: { colonyShipments: { coal: 200 }, felledTrees: {}, minedOre: {} } })
      .violations).toEqual([]);
    // Coal also comes from the charburner, not only from a surveyed mine.
    const charburnerIsland = (savedAt: number, coal: number) => ({
      ...island(savedAt, 10),
      settlement: { actors: [], buildings: [building(27, {}), building(0, { logs: 1_000, coal })],
        naval: { ships: [] } }
    }) as unknown as GameSaveV1;
    expect(checkPlausibility({ after: charburnerIsland(hour, 100), before: charburnerIsland(0, 0), credits: {},
      realSeconds: 3600, resources: { felledTrees: {}, minedOre: { coal: 0 } } }).violations).toEqual([]);
  });

  it("bounds settler births by the island and residence timers", () => {
    const withBirths = (savedAt: number, births: number) => {
      const save = island(savedAt, 10);
      save.settlement.settlerBirths = births;
      return save;
    };
    const hour = 3_600_000;
    expect(checkPlausibility({ after: withBirths(hour, 40), before: withBirths(0, 0), credits: {},
      realSeconds: 3600 }).violations).toEqual([]);
    expect(checkPlausibility({ after: withBirths(hour, 100), before: withBirths(0, 0), credits: {},
      realSeconds: 3600 }).violations.map(violation => violation.ware)).toEqual(["births"]);
  });

  it("counts hand-cart cargo and prepaid goods as holdings", () => {
    const save = island(0, 10);
    save.settlement.actors = [
      ...save.settlement.actors,
      { handcart: { cargo: 4, owner: 0, state: "hitched", trip: {
        delivered: 0, loaded: 2, planned: 6, prepaid: 2, source: 0, ware: "logs"
      } }, ware: null } as unknown as SettlementActor
    ];
    // Storage 10 + carried 2 + ship 3 + cart 4 + prepaid 2.
    expect(playerHoldings(save).logs).toBe(21);
  });

  it("counts trade deliveries and landed expedition goods as holdings", () => {
    const trade = island(0, 0);
    trade.settlement.trade = {
      deliveries: [{ goods: { coins: 500, planks: 3 } }],
      escrow: [{ held: [{ goods: { logs: 4 }, uid: 0 }], staged: { logs: 1 } }]
    } as unknown as NonNullable<GameSaveV1["settlement"]["trade"]>;
    // Carried 2 + ship 3 + escrow 5 + delivery coins/planks.
    expect(playerHoldings(trade)).toMatchObject({ coins: 500, logs: 10, planks: 3 });

    const landed = {
      ...island(0, 0),
      archipelago: { active: null, colonies: [{ expeditionId: 1, island: {}, landing: {
        crew: 2, landed: { planks: 20 }, troops: []
      }, status: "landed" }], version: 1 }
    } as unknown as GameSaveV1;
    expect(playerHoldings(landed).planks).toBe(20);
    // Once the island exists, its save is the authority; the landing record must not double count it.
    const visited = {
      ...landed,
      archipelago: { ...landed.archipelago!, colonies: [{ ...landed.archipelago!.colonies[0]!, save:
        island(0, 0) }] }
    } as unknown as GameSaveV1;
    expect(playerHoldings(visited).planks ?? 0).toBe(0);
  });

  it("accepts a move from storage onto a cart without treating it as new production", () => {
    const before = island(0, 40), after = island(0, 0);
    after.settlement.actors = [
      ...after.settlement.actors,
      { handcart: { cargo: 40, owner: 0, state: "hitched", trip: {
        delivered: 0, loaded: 40, planned: 40, prepaid: 0, source: 0, ware: "logs"
      } }, ware: null } as unknown as SettlementActor
    ];
    expect(checkPlausibility({ after, before, credits: {}, realSeconds: 0 }).violations).toEqual([]);
  });

  it("flags hand-cart or trade-delivery goods that have no production source", () => {
    const after = island(60_000, 0);
    after.settlement.trade = {
      deliveries: [{ goods: { logs: 1_000 } }], escrow: []
    } as unknown as NonNullable<GameSaveV1["settlement"]["trade"]>;
    expect(checkPlausibility({ after, before: island(0, 0), credits: {}, realSeconds: 60 }).violations
      .map(violation => violation.ware)).toContain("logs");
  });

  it("requires a completed building to carry the blueprint's construction receipt", () => {
    const withUpgrade = (savedAt: number, construction: number,
      consumed: Record<string, number> | undefined) => {
      const save = island(savedAt, 0);
      save.settlement.buildings = [building(0, {}), building(WOODCUTTER_TYPE_ID, {}, {
        construction, constructionConsumed: consumed, required: { logs: 2 }
      })] as unknown as GameSaveV1["settlement"]["buildings"];
      return save;
    };
    const hour = 3_600_000;
    expect(checkPlausibility({ after: withUpgrade(hour, 1, { logs: 2 }), before: withUpgrade(0, .5, { logs: 1 }),
      credits: {}, realSeconds: 3600 }).violations).toEqual([]);
    expect(checkPlausibility({ after: withUpgrade(hour, 1, { logs: 1 }), before: withUpgrade(0, .5, { logs: 1 }),
      credits: {}, realSeconds: 3600 }).violations.map(violation => violation.ware)).toContain("construction");
    // A save from before the receipt existed is skipped rather than guessed.
    expect(checkPlausibility({ after: withUpgrade(hour, 1, {}), before: withUpgrade(0, .5, undefined),
      credits: {}, realSeconds: 3600 }).violations).toEqual([]);
  });

});
